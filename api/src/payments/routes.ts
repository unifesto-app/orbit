import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, max, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { feeTerms, type MyPayment, type MyRefund, type PayOrder, PayRequest, slotPrice, type Verified, VerifyPayment } from "@orbit/contract";
import type { Deps } from "../auth/routes.ts";
import type { Db } from "../db/index.ts";
import { bookings, events, failedWebhooks, hosts, payments, razorpayEvents, refunds, stationClaims, users } from "../db/schema.ts";
import { seatCheck, tokens } from "../bookings.ts";
import { type Env, fail, invalid, isUuid, type Notify, parse, signedIn, taken, type Tx } from "../http.ts";
import { mine } from "../saves.ts";
import { confirmHold, lockHold } from "../slots/hold.ts";
import { stationRow, tellTeam } from "../slots/routes.ts";
import type { Razorpay, RzPayment, RzRefund } from "./razorpay.ts";

// Paying for a ticket (Money flow; Booking flow, "Paying"; X2). The app asks for an order (/pay), Razorpay's checkout
// takes the money, and whichever comes first of the app's /verify, Razorpay's webhook or the 15-minute poller settles
// it, once: a seat if one is still there, else the whole amount back, fee included. No seat is held while paying.
// Payment states only move forward (created → paid → refunded), so events out of order are safe.

const MIN = 60_000;
const HOUR = 60 * MIN;
const ORDER_LIFE = 30 * MIN; // an order nobody paid is expired after this
const POLL_AFTER = 5 * MIN; // the poller asks Razorpay about orders older than this
const RETRY_FOR = 24 * HOUR; // a failed refund retries hourly for this long, then waits for staff in Galaxy
const LATE_FOR = 24 * HOUR; // failed and expired orders are still asked about this long, so late money settles
const FIRST_TRY = 15 * MIN; // a new refund's first try is its sender's; the poller takes over after this
export const CLAIM = 10 * MIN; // a send in flight holds its refund this long

type Pay = typeof payments.$inferSelect;
type Settled = { status: Pay["status"]; bookingId: string | null; refundIds: string[]; reason?: string };

// Why a payment that found no seat went back: seatCheck's code (fewLeft, cancelled, ended, closed, tooMany, booked, …),
// kept in its automatic refund's reason by settle. Undefined for anything else.
export const COULDNT = "Couldn't confirm: ";
const reasonOf = async (q: Db | Tx, paymentId: string) => {
  const [r] = await q
    .select({ reason: refunds.reason })
    .from(refunds)
    .where(and(eq(refunds.paymentId, paymentId), eq(refunds.kind, "auto"), sql`${refunds.reason} like ${COULDNT + "%"}`));
  return r?.reason.slice(COULDNT.length);
};

const off = (c: Context) => fail(c, 503, "paymentsOff", "Paying isn't working right now. Try again later.");
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");

const orderOf = (p: Pay, keyId: string, already: boolean): PayOrder => ({
  orderId: p.razorpayOrderId,
  amountPaise: p.amountPaise,
  keyId,
  already,
  breakdown: { pricePaise: p.unitPricePaise * p.quantity, feePaise: p.feeIncluded ? 0 : p.buyerFeePaise, feeIncluded: p.feeIncluded, amountPaise: p.amountPaise },
});

// An automatic refund row (the whole of one Razorpay payment unless `amount` says less), sent after the transaction
// commits by whoever made it; the poller only takes it after FIRST_TRY.
const autoRefund = async (tx: Tx, p: Pay, razorpayPaymentId: string, reason: string, at: Date, amount = p.amountPaise) => {
  const [r] = await tx
    .insert(refunds)
    .values({ paymentId: p.id, razorpayPaymentId, amountPaise: amount, reason, kind: "auto", nextAttemptAt: new Date(at.getTime() + FIRST_TRY), createdAt: at, updatedAt: at })
    .returning({ id: refunds.id });
  return r!.id;
};

// Everything asked back on a payment's own Razorpay payment so far, open and failed refunds too. A second payment on the
// same order (paid twice) has refunds of its own, which never count against this one.
export const askedBack = async (q: Db | Tx, p: Pick<Pay, "id" | "razorpayPaymentId">) =>
  p.razorpayPaymentId
    ? (
        await q
          .select({ n: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` })
          .from(refunds)
          .where(and(eq(refunds.paymentId, p.id), eq(refunds.razorpayPaymentId, p.razorpayPaymentId)))
      )[0]!.n
    : 0;

// Every paid payment matching `where` goes back in full (less anything already asked back), inside the caller's
// transaction: an event cancelled, an account deleted. Returns the refund ids to send once it commits.
export async function refundPaid(tx: Tx, where: SQL, reason: string, at: Date) {
  const ids: string[] = [];
  for (const p of await tx.select().from(payments).where(and(eq(payments.status, "paid"), where)).for("update")) {
    await tx.update(payments).set({ status: "refundPending", updatedAt: at }).where(eq(payments.id, p.id));
    const left = p.amountPaise - (await askedBack(tx, p));
    if (left > 0) ids.push(await autoRefund(tx, p, p.razorpayPaymentId!, reason, at, left));
  }
  return ids;
}

// Money landed on `orderId` (Razorpay payment `paid`): one transaction, the payment row locked first, then book()'s
// locks (the person, the event, the ticket type) and its checks again. Null for an order that isn't ours.
// Lock order: payment before person and event. Nothing holding a person or an event waits on an open payment: /pay
// expires an old order only after its own locks are gone; event cancel and account deletion lock only paid payments,
// which settle never waits on the person or event for.
export async function settle(db: Db, notify: Notify, orderId: string, paid: Pick<RzPayment, "id" | "fee" | "tax">, now: number): Promise<Settled | null> {
  const at = new Date(now);
  return db.transaction(async (tx): Promise<Settled | null> => {
    const [p] = await tx.select().from(payments).where(eq(payments.razorpayOrderId, orderId)).for("update");
    if (!p) return null;
    const costs = { razorpayFeePaise: paid.fee ?? p.razorpayFeePaise, razorpayTaxPaise: paid.tax ?? p.razorpayTaxPaise };
    if (p.status === "paid" || p.status === "refundPending" || p.status === "refunded") {
      const same: Settled = { status: p.status, bookingId: p.bookingId, refundIds: [], reason: p.bookingId ? undefined : await reasonOf(tx, p.id) };
      if (p.razorpayPaymentId === paid.id) {
        // The webhook after /verify: nothing to do but keep Razorpay's fee once it reports it.
        if (paid.fee != null && p.razorpayFeePaise == null) await tx.update(payments).set({ ...costs, updatedAt: at }).where(eq(payments.id, p.id));
        return same;
      }
      // A second payment on one order: it goes back whole, once.
      const [had] = await tx.select({ id: refunds.id }).from(refunds).where(eq(refunds.razorpayPaymentId, paid.id));
      if (had) return same;
      const id = await autoRefund(tx, p, paid.id, "Paid twice on one order", at);
      await notify({ to: { userId: p.userId }, kind: "paidTwice", data: { eventId: p.eventId }, key: `refund:${id}` }, tx);
      return { ...same, refundIds: [id] };
    }
    // created, failed or expired: give the seat, or give the money back.
    if (p.kind === "slot") {
      // confirmHold takes the hold's locks (person, host, venue, station, claim) after this payment's: the same order.
      const ok = await confirmHold(tx, p.claimId!, now);
      if (!ok.ok) {
        // Booked already (an older order on this hold paid first): this one is a second payment, not a lost slot.
        const [c] = ok.error === "notHeld" ? await tx.select({ status: stationClaims.status }).from(stationClaims).where(eq(stationClaims.id, p.claimId!)) : [];
        const reason = c?.status === "paid" ? "booked" : ok.error;
        await tx.update(payments).set({ status: "refundPending", razorpayPaymentId: paid.id, ...costs, updatedAt: at }).where(eq(payments.id, p.id));
        const id = await autoRefund(tx, p, paid.id, COULDNT + reason, at);
        const kind = reason === "booked" ? "paidTwice" : "soldOutWhilePaying";
        await notify({ to: { userId: p.userId }, kind, data: { claimId: p.claimId, hostId: p.hostId, reason }, key: `refund:${id}` }, tx);
        return { status: "refundPending", bookingId: null, refundIds: [id], reason };
      }
      await tx.update(payments).set({ status: "paid", razorpayPaymentId: paid.id, ...costs, updatedAt: at }).where(eq(payments.id, p.id));
      await tellTeam(tx, notify, ok.claim);
      return { status: "paid", bookingId: null, refundIds: [] };
    }
    // book()'s locks: the person, then seatCheck's event and ticket type.
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, p.userId), isNull(users.deletedAt))).for("update");
    const ok = u
      ? await seatCheck(tx, { userId: p.userId, eventId: p.eventId!, ticketTypeId: p.ticketTypeId!, quantity: p.quantity, paid: true }, now)
      : ({ error: "signedOut" } as const);
    if ("error" in ok) {
      await tx.update(payments).set({ status: "refundPending", razorpayPaymentId: paid.id, ...costs, updatedAt: at }).where(eq(payments.id, p.id));
      const id = await autoRefund(tx, p, paid.id, COULDNT + ok.error, at);
      const kind = ok.error === "booked" ? "paidTwice" : "soldOutWhilePaying";
      await notify({ to: { userId: p.userId }, kind, data: { eventId: p.eventId, reason: ok.error }, key: `refund:${id}` }, tx);
      return { status: "refundPending", bookingId: null, refundIds: [id], reason: ok.error };
    }
    const [b] = await tx
      .insert(bookings)
      .values({ userId: p.userId, eventId: p.eventId!, ticketTypeId: p.ticketTypeId!, quantity: p.quantity, source: "orbit", ...tokens(), createdAt: at })
      .returning({ id: bookings.id });
    await tx.update(payments).set({ status: "paid", razorpayPaymentId: paid.id, bookingId: b!.id, ...costs, updatedAt: at }).where(eq(payments.id, p.id));
    return { status: "paid", bookingId: b!.id, refundIds: [] };
  });
}

// What Razorpay says about one of our refunds, applied forward only: processed is final, and a payment is refunded once
// its processed refunds cover it. A failure retries hourly for a day from the refund's start. The payer hears once.
export async function markRefund(db: Db, notify: Notify, refundId: string, rz: Pick<RzRefund, "id" | "status">, now: number) {
  const at = new Date(now);
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!r || r.status === "processed") return;
    // A failure of an earlier try, once a newer refund is on the row, says nothing about the newer one.
    if (rz.status === "failed" && r.razorpayRefundId && r.razorpayRefundId !== rz.id) return;
    if (rz.status === "processed") {
      await tx.update(refunds).set({ status: "processed", razorpayRefundId: rz.id, nextAttemptAt: null, updatedAt: at }).where(eq(refunds.id, r.id));
      const [p] = await tx.select().from(payments).where(eq(payments.id, r.paymentId)).for("update");
      // Only refunds of the payment's own Razorpay payment count: a paid-twice refund leaves the ticket's payment paid.
      const [sum] = await tx
        .select({ done: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` })
        .from(refunds)
        .where(and(eq(refunds.paymentId, r.paymentId), eq(refunds.razorpayPaymentId, p?.razorpayPaymentId ?? ""), eq(refunds.status, "processed")));
      if (p && sum!.done >= p.amountPaise && p.status !== "refunded") await tx.update(payments).set({ status: "refunded", updatedAt: at }).where(eq(payments.id, p.id));
      await notify({ to: { userId: p!.userId }, kind: "refundSent", data: { eventId: p!.eventId, amountPaise: r.amountPaise }, key: `refundSent:${r.id}` }, tx);
    } else if (rz.status === "failed") {
      await tx.update(refunds).set({ status: "failed", razorpayRefundId: rz.id, nextAttemptAt: retryAt(r.createdAt, now), updatedAt: at }).where(eq(refunds.id, r.id));
    } else {
      await tx.update(refunds).set({ status: "sent", razorpayRefundId: rz.id, nextAttemptAt: null, updatedAt: at }).where(eq(refunds.id, r.id));
    }
  });
}
// The next hourly try, or null once a day from the start has passed (Galaxy's Refunds shows it then).
const retryAt = (start: Date, now: number) => (now + HOUR <= start.getTime() + RETRY_FOR ? new Date(now + HOUR) : null);

// Sends one refund to Razorpay, or finds the one it already made under our id (the receipt), then records what Razorpay
// says. A failure is kept for the next try; it never throws.
// The row is claimed first, in one statement: only a send that moves its next try forward goes on, so two senders at
// once (the poller and Galaxy, two pollers) make one refund, whatever Razorpay does with a repeated receipt. `first`:
// the try of whoever just made the row, which waits FIRST_TRY for nobody else.
export async function sendRefund(db: Db, rz: Razorpay, notify: Notify, refundId: string, now: number, first = false) {
  const [r] = await db
    .update(refunds)
    .set({ attempts: sql`${refunds.attempts} + 1`, nextAttemptAt: new Date(now + CLAIM) })
    .where(
      and(
        eq(refunds.id, refundId),
        inArray(refunds.status, ["requested", "sent", "failed"]),
        first ? and(eq(refunds.status, "requested"), eq(refunds.attempts, 0)) : or(isNull(refunds.nextAttemptAt), lte(refunds.nextAttemptAt, new Date(now))),
      ),
    )
    .returning();
  if (!r) return;
  try {
    const ours = (await rz.refundsOf(r.razorpayPaymentId)).filter((x) => x.id === r.razorpayRefundId || x.receipt === r.id || x.notes?.refund_id === r.id);
    const live = ours.find((x) => x.status !== "failed");
    const dead = ours.find((x) => x.id === r.razorpayRefundId) ?? ours[0];
    // One on its way is followed; a failure we haven't recorded yet is recorded (the hourly retry sends anew); else send.
    const sent = live ?? (dead && r.status !== "failed" ? dead : await rz.refund(r.razorpayPaymentId, r.amountPaise, r.id));
    await markRefund(db, notify, r.id, sent, now);
  } catch (e) {
    console.error("[refunds]", r.id, (e as Error).message);
    // A sent one stays sent: an error asking about it says nothing about the refund itself (the claim retries it).
    await db
      .update(refunds)
      .set({ status: "failed", nextAttemptAt: retryAt(r.createdAt, now), updatedAt: new Date(now) })
      .where(and(eq(refunds.id, r.id), inArray(refunds.status, ["requested", "failed"])));
  }
}

const settleAndSend = async (db: Db, rz: Razorpay, notify: Notify, orderId: string, paid: Pick<RzPayment, "id" | "fee" | "tax">, now: number) => {
  const s = await settle(db, notify, orderId, paid, now);
  for (const id of s?.refundIds ?? []) await sendRefund(db, rz, notify, id, now, true);
  return s;
};

// Every 15 minutes (server.ts): orders over 5 minutes old are asked about and settled if Razorpay captured money on
// them, and expired at 30 minutes; failed and expired ones under a day old are asked too, so late money settles (a seat,
// or the money back); refunds due a try are sent again; sent ones an hour old are asked about, in case a webhook was
// lost; refused webhooks over 30 days old go.
// ponytail: one Razorpay call per open order and per open refund each pass; batch by time range (GET /payments?from=)
// if there are ever hundreds open at once.
export async function pollPayments({ db, rz, notify, now }: { db: Db; rz: Razorpay; notify: Notify; now: number }) {
  const open = await db
    .select()
    .from(payments)
    .where(
      or(
        and(eq(payments.status, "created"), lte(payments.createdAt, new Date(now - POLL_AFTER))),
        and(inArray(payments.status, ["failed", "expired"]), gte(payments.createdAt, new Date(now - LATE_FOR))),
      ),
    );
  for (const p of open) {
    try {
      const got = (await rz.orderPayments(p.razorpayOrderId)).find((x) => x.status === "captured");
      if (got) await settleAndSend(db, rz, notify, p.razorpayOrderId, got, now);
      else if (p.status === "created" && p.createdAt.getTime() <= now - ORDER_LIFE)
        await db.update(payments).set({ status: "expired", updatedAt: new Date(now) }).where(and(eq(payments.id, p.id), eq(payments.status, "created")));
    } catch (e) {
      console.error("[payments]", p.id, (e as Error).message);
    }
  }
  const due = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      or(
        and(inArray(refunds.status, ["requested", "failed"]), lte(refunds.nextAttemptAt, new Date(now))),
        and(eq(refunds.status, "sent"), lte(refunds.updatedAt, new Date(now - HOUR))),
      ),
    );
  for (const r of due) await sendRefund(db, rz, notify, r.id, now);
  await db.delete(failedWebhooks).where(lt(failedWebhooks.receivedAt, new Date(now - 30 * 24 * HOUR)));
}

// A refused webhook's note for Galaxy: the event and its ids, never the body (it carries the payer's contacts).
const excerptOf = (body: string) => {
  try {
    const j = JSON.parse(body) as { event?: string; payload?: Record<string, { entity?: { id?: string } }> };
    return JSON.stringify({ event: j.event, ids: Object.fromEntries(Object.entries(j.payload ?? {}).map(([k, v]) => [k, v?.entity?.id])) }).slice(0, 500);
  } catch {
    return `unreadable, ${body.length} bytes`;
  }
};

type Hook = {
  event: string;
  payload?: { payment?: { entity: RzPayment }; refund?: { entity: RzRefund } };
};

export function paymentsRoutes({ db, store, secret, notify, razorpay: rz, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const refused = { minute: 0, n: 0 }; // refused webhooks kept this minute

  // POST /events/:id/pay {ticketTypeId, quantity}: every check book() makes, then an order on the host's fee plan with
  // the terms frozen. The person's open order for this ticket type comes back as it is ("You're already paying") when
  // it's for the same seats on the same terms; otherwise it's expired and a new one made (money landing on the old one
  // later still settles: a seat if there is one, else it goes back).
  app.post("/events/:id/pay", auth, async (c) => {
    if (!rz) return off(c);
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const b = await parse(c, PayRequest);
    if (!b) return invalid(c);
    const userId = c.var.user.id;
    const openOf = async (q: Db | Tx, tierId: string) =>
      (await q.select().from(payments).where(and(eq(payments.userId, userId), eq(payments.ticketTypeId, tierId), eq(payments.status, "created"))))[0];
    const checked = await mine(db, c, userId, async (tx) => {
      const ok = await seatCheck(tx, { userId, eventId: id, ticketTypeId: b.ticketTypeId, quantity: b.quantity, paid: true }, now());
      if ("error" in ok) return fail(c, ok.status, ok.error, ok.message, ok.extra);
      const [h] = await tx.select({ plan: hosts.feePlan, included: hosts.feeIncluded }).from(hosts).where(eq(hosts.id, ok.e.hostId));
      const terms = feeTerms(ok.tier.pricePaise, b.quantity, h!.plan, h!.included);
      const open = await openOf(tx, ok.tier.id);
      if (open && open.quantity === terms.quantity && open.amountPaise === terms.amountPaise && open.plan === terms.plan && open.feeIncluded === terms.feeIncluded)
        return { open };
      return { hostId: ok.e.hostId, tierId: ok.tier.id, terms, stale: open?.id };
    });
    if (checked instanceof Response) return checked;
    if ("open" in checked) return c.json(orderOf(checked.open!, rz.keyId, true));
    // The old order on other terms goes, in a statement of its own once the person's lock is released (settle locks a
    // payment before the person, so doing it under that lock could deadlock with money landing on it).
    if (checked.stale)
      await db.update(payments).set({ status: "expired", updatedAt: new Date(now()) }).where(and(eq(payments.id, checked.stale), eq(payments.status, "created")));
    // The order is made outside the transaction, so no lock waits on Razorpay.
    const paymentId = randomUUID();
    const { terms } = checked;
    let order: { id: string };
    try {
      order = await rz.createOrder(terms.amountPaise, paymentId);
    } catch (e) {
      console.error("[payments] order", (e as Error).message);
      return fail(c, 502, "paymentsDown", "Paying isn't working right now. Try again in a minute.");
    }
    const at = new Date(now());
    try {
      const [row] = await db
        .insert(payments)
        .values({
          id: paymentId, kind: "ticket", userId, hostId: checked.hostId, eventId: id, ticketTypeId: checked.tierId,
          quantity: terms.quantity, unitPricePaise: terms.unitPricePaise, plan: terms.plan, buyerFeeBps: terms.buyerFeeBps,
          buyerFeePaise: terms.buyerFeePaise, commissionBps: terms.commissionBps, commissionPaise: terms.commissionPaise,
          feeIncluded: terms.feeIncluded, amountPaise: terms.amountPaise, razorpayOrderId: order.id, createdAt: at, updatedAt: at,
        })
        .returning();
      return c.json(orderOf(row!, rz.keyId, false), 201);
    } catch (e) {
      // Two taps at once: the other made the open order first, so this one's order is never used.
      const open = taken(e) ? await openOf(db, checked.tierId) : undefined;
      if (open) return c.json(orderOf(open, rz.keyId, true));
      throw e;
    }
  });

  // POST /venues/:hostId/holds/:claimId/pay: the player's own live hold, priced here from the station and the host's fee
  // plan (never the app's numbers). Their open order for this hold comes back as it is on the same terms; otherwise a new
  // one. Money landing settles it through confirmHold (settle above): the booking, or the whole amount back.
  app.post("/venues/:hostId/holds/:claimId/pay", auth, async (c) => {
    if (!rz) return off(c);
    const hostId = c.req.param("hostId");
    const claimId = c.req.param("claimId");
    if (!isUuid(hostId) || !isUuid(claimId)) return nothing(c);
    const userId = c.var.user.id;
    const openOf = async (q: Db | Tx) =>
      (await q.select().from(payments).where(and(eq(payments.userId, userId), eq(payments.claimId, claimId), eq(payments.status, "created"))))[0];
    // Under the hold's locks: its checks, its price, and the open order.
    const r = await db.transaction(async (tx) => {
        const k = await lockHold(tx, claimId, { userId, hostId });
        if (!k || k.claim.kind !== "booking") return { no: [404, "notFound", "There's nothing here."] as const };
        const h = k.claim;
        if (h.status === "paid") return { no: [409, "booked", "That slot is already booked."] as const };
        if (h.status !== "held" || h.releasedAt || h.holdEndsAt! <= new Date(now()))
          return { no: [409, "notHeld", "That hold can't be booked any more. Hold it again."] as const };
        // confirmHold would refuse these once paid: say so before any money moves.
        if (k.host.status !== "live" || k.station.archivedAt) return { no: [409, "hostClosed", "This place isn't taking bookings right now."] as const };
        const total = slotPrice(stationRow(k.station), h.startsAt.getTime(), (h.endsAt.getTime() - h.startsAt.getTime()) / HOUR, h.count);
        if (total <= 0) return { no: [409, "free", "This slot is free. Confirm it instead."] as const };
        const terms = feeTerms(total, 1, k.host.feePlan, k.host.feeIncluded);
        const open = await openOf(tx);
        if (open && open.amountPaise === terms.amountPaise && open.plan === terms.plan && open.feeIncluded === terms.feeIncluded) return { open };
        return { terms, stale: open?.id };
      });
    if ("no" in r && r.no) return fail(c, r.no[0], r.no[1], r.no[2]);
    if ("open" in r) return c.json(orderOf(r.open!, rz.keyId, true));
    // As /events/:id/pay: the old order goes once the hold's locks are released, and Razorpay is asked outside any.
    if (r.stale) await db.update(payments).set({ status: "expired", updatedAt: new Date(now()) }).where(and(eq(payments.id, r.stale), eq(payments.status, "created")));
    const { terms } = r;
    const paymentId = randomUUID();
    let order: { id: string };
    try {
      order = await rz.createOrder(terms.amountPaise, paymentId);
    } catch (e) {
      console.error("[payments] order", (e as Error).message);
      return fail(c, 502, "paymentsDown", "Paying isn't working right now. Try again in a minute.");
    }
    // The row goes in under the hold's locks again, so two taps at once make one open order (no unique index covers a
    // claim): the second finds the first's and answers it.
    const at = new Date(now());
    const done = await db.transaction(async (tx) => {
      const again = await lockHold(tx, claimId, { userId, hostId });
      const open = again && (await openOf(tx));
      if (open) return { open };
      const c = again?.claim;
      if (!c || c.status !== "held" || c.releasedAt || c.holdEndsAt! <= new Date(now())) return { gone: true };
      const [row] = await tx
        .insert(payments)
        .values({
          id: paymentId, kind: "slot", userId, hostId, claimId, eventId: null, ticketTypeId: null,
          quantity: terms.quantity, unitPricePaise: terms.unitPricePaise, plan: terms.plan, buyerFeeBps: terms.buyerFeeBps,
          buyerFeePaise: terms.buyerFeePaise, commissionBps: terms.commissionBps, commissionPaise: terms.commissionPaise,
          feeIncluded: terms.feeIncluded, amountPaise: terms.amountPaise, razorpayOrderId: order.id, createdAt: at, updatedAt: at,
        })
        .returning();
      return { row: row! };
    });
    if ("open" in done) return c.json(orderOf(done.open!, rz.keyId, true));
    if ("gone" in done) return fail(c, 409, "notHeld", "That hold can't be booked any more. Hold it again.");
    return c.json(orderOf(done.row, rz.keyId, false), 201);
  });

  // POST /payments/:orderId/verify {paymentId, signature}: checkout's answer, from the payer. Settles at once, so the app
  // can show the ticket without waiting for the webhook, but only once Razorpay itself says the money is captured on this
  // order, in full: a signature alone also comes with a payment that's only authorized. Otherwise "confirming", and the
  // webhook or the poller settles it.
  app.post("/payments/:orderId/verify", auth, async (c) => {
    if (!rz) return off(c);
    const orderId = c.req.param("orderId");
    const b = await parse(c, VerifyPayment);
    if (!b) return invalid(c);
    const [p] = await db
      .select({ id: payments.id, amountPaise: payments.amountPaise })
      .from(payments)
      .where(and(eq(payments.razorpayOrderId, orderId), eq(payments.userId, c.var.user.id)));
    if (!p) return nothing(c);
    if (!rz.paymentSigned(orderId, b.paymentId, b.signature))
      return fail(c, 400, "badSignature", "We couldn't confirm this payment here. If money left your account, we'll confirm or refund it on our own.");
    const got = await rz.payment(b.paymentId).catch((e: Error) => (console.error("[payments] verify", e.message), null));
    if (!got || got.status !== "captured" || got.order_id !== orderId || got.amount !== p.amountPaise) {
      const out: Verified = { status: "confirming", bookingId: null };
      return c.json(out);
    }
    const s = (await settleAndSend(db, rz, notify, orderId, got, now()))!;
    const out: Verified = { status: s.status, bookingId: s.bookingId, reason: s.reason };
    return c.json(out);
  });

  // GET /payments/:orderId: where the payer's order stands, for the app when checkout closes without an answer (closed,
  // or failed). Razorpay is asked about an open one under a day old (older ones are the DB's word; the poller stops
  // then too): money captured settles here as the poller would; a payment only authorized is "confirming"; attempts
  // all still open at Razorpay (created, a UPI request unanswered) are "pending"; no answer from Razorpay is a 502. Only
  // created, failed or expired means nothing was taken. 10 a minute a person, so a tapping app can't hammer Razorpay.
  app.get("/payments/:orderId", auth, async (c) => {
    if (!rz) return off(c);
    if ((await store.incr(`paystatus:${c.var.user.id}`, MIN)) > 10) return fail(c, 429, "tooMany", "Too many tries. Wait a minute.");
    const orderId = c.req.param("orderId");
    const [p] = await db.select().from(payments).where(and(eq(payments.razorpayOrderId, orderId), eq(payments.userId, c.var.user.id)));
    if (!p) return nothing(c);
    const said = async (s: Pick<Settled, "status" | "bookingId" | "reason">) => {
      const out: Verified = { status: s.status, bookingId: s.bookingId, reason: s.reason };
      return c.json(out);
    };
    if (p.status === "paid" || p.status === "refundPending" || p.status === "refunded")
      return said({ status: p.status, bookingId: p.bookingId, reason: p.bookingId ? undefined : await reasonOf(db, p.id) });
    if (p.createdAt.getTime() < now() - LATE_FOR) return said({ status: p.status, bookingId: null });
    const tried = await rz.orderPayments(orderId).catch((e: Error) => (console.error("[payments] status", e.message), null));
    if (!tried) return fail(c, 502, "paymentsDown", "We couldn't check that payment right now.");
    const got = tried.find((x) => x.status === "captured");
    if (got) return said((await settleAndSend(db, rz, notify, orderId, got, now()))!);
    if (tried.some((x) => x.status === "authorized")) return c.json({ status: "confirming", bookingId: null } satisfies Verified);
    if (tried.length && tried.every((x) => x.status === "created")) return c.json({ status: "pending", bookingId: null } satisfies Verified);
    return said({ status: p.status, bookingId: null });
  });

  // POST /razorpay/webhook: Razorpay's word, the source of truth. Signed over the raw body; each event id is taken once
  // it's handled (a repeat of a handled one is a no-op). One we can't match is left unhandled and taken again only if
  // Razorpay resends it: our own refunds don't need it (the poller asks about sent ones hourly), and an order that isn't
  // ours has nothing to settle.
  // ponytail: refunds made by hand in Razorpay's dashboard aren't ours, so they're not tracked; import them by payment id
  // if staff ever refund there.
  app.post("/razorpay/webhook", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    if (!rz) return off(c);
    const body = await c.req.text();
    const at = new Date(now());
    const refuse = async (reason: string) => {
      // ponytail: an in-memory count per server, so a flood can't fill the table; one shared counter if there are ever
      // several API servers.
      const minute = Math.floor(at.getTime() / MIN);
      if (refused.minute !== minute) Object.assign(refused, { minute, n: 0 });
      if (++refused.n <= 100) await db.insert(failedWebhooks).values({ receivedAt: at, reason, excerpt: excerptOf(body) });
      return fail(c, 400, "invalid", "Refused.");
    };
    if (!rz.webhookSigned(body, c.req.header("x-razorpay-signature") ?? "")) return refuse("badSignature");
    let hook: Hook;
    try {
      hook = JSON.parse(body) as Hook;
    } catch {
      return refuse("unreadable");
    }
    const eventId = c.req.header("x-razorpay-event-id");
    if (!eventId || typeof hook.event !== "string") return refuse("noEventId");
    await db.insert(razorpayEvents).values({ id: eventId, type: hook.event, receivedAt: at }).onConflictDoNothing();
    const [seen] = await db.select({ handledAt: razorpayEvents.handledAt }).from(razorpayEvents).where(eq(razorpayEvents.id, eventId));
    if (seen?.handledAt) return c.json({ ok: true });

    let handled = true;
    const pay = hook.payload?.payment?.entity;
    const ref = hook.payload?.refund?.entity;
    if ((hook.event === "payment.captured" || hook.event === "order.paid") && pay) {
      handled = !!(await settleAndSend(db, rz, notify, pay.order_id, pay, now()));
    } else if (hook.event === "payment.failed" && pay) {
      await db.update(payments).set({ status: "failed", updatedAt: at }).where(and(eq(payments.razorpayOrderId, pay.order_id), eq(payments.status, "created")));
    } else if ((hook.event === "refund.processed" || hook.event === "refund.failed") && ref) {
      const ours = [ref.receipt, ref.notes?.refund_id].find((x): x is string => !!x && isUuid(x));
      const [r] = await db
        .select({ id: refunds.id })
        .from(refunds)
        .where(ours ? or(eq(refunds.razorpayRefundId, ref.id), eq(refunds.id, ours)) : eq(refunds.razorpayRefundId, ref.id));
      if (r) await markRefund(db, notify, r.id, { id: ref.id, status: hook.event === "refund.processed" ? "processed" : "failed" }, now());
      handled = !!r;
    }
    if (handled) await db.update(razorpayEvents).set({ handledAt: at }).where(eq(razorpayEvents.id, eventId));
    return c.json({ ok: true });
  });

  // GET /me/payments: the signed-in person's payments that took money, newest first, each with what has come back.
  // ponytail: the last 200, no paging; a page when someone has more.
  app.get("/me/payments", auth, async (c) => {
    const rows = await db
      .select({ p: payments, title: events.title })
      .from(payments)
      .leftJoin(events, eq(events.id, payments.eventId))
      .where(and(eq(payments.userId, c.var.user.id), isNotNull(payments.razorpayPaymentId)))
      .orderBy(desc(payments.createdAt))
      .limit(200);
    const ids = rows.map((r) => r.p.id);
    const back = new Map(
      (ids.length
        ? await db
            .select({ id: refunds.paymentId, n: sql<number>`sum(${refunds.amountPaise})::int`, at: max(refunds.updatedAt) })
            .from(refunds)
            // Only the payment's own Razorpay payment, as askedBack: a paid-twice refund is money that never bought this.
            .innerJoin(payments, and(eq(payments.id, refunds.paymentId), eq(payments.razorpayPaymentId, refunds.razorpayPaymentId)))
            .where(and(inArray(refunds.paymentId, ids), eq(refunds.status, "processed")))
            .groupBy(refunds.paymentId)
        : []
      ).map((r) => [r.id, r]),
    );
    const out: MyPayment[] = rows.map(({ p, title }) => ({
      id: p.id, eventId: p.eventId, eventTitle: title, quantity: p.quantity, pricePaise: p.unitPricePaise * p.quantity,
      feePaise: p.feeIncluded ? 0 : p.buyerFeePaise, amountPaise: p.amountPaise, status: p.status, razorpayPaymentId: p.razorpayPaymentId!,
      refundedPaise: back.get(p.id)?.n ?? 0, refundedAt: back.get(p.id)?.at?.toISOString() ?? null, createdAt: p.createdAt.toISOString(),
    }));
    return c.json(out);
  });

  // GET /me/refunds: refunds of the signed-in person's payments, newest first.
  app.get("/me/refunds", auth, async (c) => {
    const rows = await db
      .select({ r: refunds, eventId: payments.eventId, title: events.title })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .leftJoin(events, eq(events.id, payments.eventId))
      .where(eq(payments.userId, c.var.user.id))
      .orderBy(desc(refunds.createdAt))
      .limit(200);
    const out: MyRefund[] = rows.map(({ r, eventId, title }) => ({
      id: r.id, eventId, eventTitle: title, amountPaise: r.amountPaise, status: r.status, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    }));
    return c.json(out);
  });

  return app;
}
