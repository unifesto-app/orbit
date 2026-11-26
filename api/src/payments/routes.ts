import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { feeTerms, type PayOrder, PayRequest, type Verified, VerifyPayment } from "@orbit/contract";
import type { Deps } from "../auth/routes.ts";
import type { Db } from "../db/index.ts";
import { bookings, failedWebhooks, hosts, payments, razorpayEvents, refunds, users } from "../db/schema.ts";
import { seatCheck, tokens } from "../bookings.ts";
import { type Env, fail, invalid, isUuid, type Notify, parse, signedIn, taken, type Tx } from "../http.ts";
import { mine } from "../saves.ts";
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

type Pay = typeof payments.$inferSelect;
type Settled = { status: Pay["status"]; bookingId: string | null; refundIds: string[] };

const off = (c: Context) => fail(c, 503, "paymentsOff", "Paying isn't working right now. Try again later.");
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");

const orderOf = (p: Pay, keyId: string, already: boolean): PayOrder => ({
  orderId: p.razorpayOrderId,
  amountPaise: p.amountPaise,
  keyId,
  already,
  breakdown: { pricePaise: p.unitPricePaise * p.quantity, feePaise: p.feeIncluded ? 0 : p.buyerFeePaise, feeIncluded: p.feeIncluded, amountPaise: p.amountPaise },
});

// A refund row for the whole of one Razorpay payment, sent after the transaction commits.
const autoRefund = async (tx: Tx, p: Pay, razorpayPaymentId: string, reason: string, at: Date) => {
  const [r] = await tx
    .insert(refunds)
    .values({ paymentId: p.id, razorpayPaymentId, amountPaise: p.amountPaise, reason, kind: "auto", nextAttemptAt: at, createdAt: at, updatedAt: at })
    .returning({ id: refunds.id });
  return r!.id;
};

// Money landed on `orderId` (Razorpay payment `paid`): one transaction, the payment row locked first (only settle
// writes a payment's status, so it can't clash with book()'s order), then book()'s locks and checks again. Null for an
// order that isn't ours.
export async function settle(db: Db, notify: Notify, orderId: string, paid: Pick<RzPayment, "id" | "fee" | "tax">, now: number): Promise<Settled | null> {
  const at = new Date(now);
  return db.transaction(async (tx): Promise<Settled | null> => {
    const [p] = await tx.select().from(payments).where(eq(payments.razorpayOrderId, orderId)).for("update");
    if (!p) return null;
    const costs = { razorpayFeePaise: paid.fee ?? p.razorpayFeePaise, razorpayTaxPaise: paid.tax ?? p.razorpayTaxPaise };
    if (p.status === "paid" || p.status === "refundPending" || p.status === "refunded") {
      const same: Settled = { status: p.status, bookingId: p.bookingId, refundIds: [] };
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
      // ponytail: slot payments land once X7's confirmHold(tx, claimId, now) merges (api/src/slots/hold.ts): call it here,
      // "full" → refundPending + autoRefund, "notHeld" → refund unless this payment already paid the claim. No route
      // makes slot payments until then.
      throw new Error(`slot payment ${p.id} has no settle yet`);
    }
    // book()'s locks: the person, then seatCheck's event and ticket type.
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, p.userId), isNull(users.deletedAt))).for("update");
    const ok = u
      ? await seatCheck(tx, { userId: p.userId, eventId: p.eventId!, ticketTypeId: p.ticketTypeId!, quantity: p.quantity, paid: true }, now)
      : ({ error: "signedOut" } as const);
    if ("error" in ok) {
      await tx.update(payments).set({ status: "refundPending", razorpayPaymentId: paid.id, ...costs, updatedAt: at }).where(eq(payments.id, p.id));
      const id = await autoRefund(tx, p, paid.id, `Couldn't confirm: ${ok.error}`, at);
      const kind = ok.error === "booked" ? "paidTwice" : "soldOutWhilePaying";
      await notify({ to: { userId: p.userId }, kind, data: { eventId: p.eventId, reason: ok.error }, key: `refund:${id}` }, tx);
      return { status: "refundPending", bookingId: null, refundIds: [id] };
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
    if (rz.status === "processed") {
      await tx.update(refunds).set({ status: "processed", razorpayRefundId: rz.id, nextAttemptAt: null, updatedAt: at }).where(eq(refunds.id, r.id));
      const [p] = await tx.select().from(payments).where(eq(payments.id, r.paymentId)).for("update");
      const [sum] = await tx
        .select({ done: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` })
        .from(refunds)
        .where(and(eq(refunds.paymentId, r.paymentId), eq(refunds.status, "processed")));
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
export async function sendRefund(db: Db, rz: Razorpay, notify: Notify, refundId: string, now: number) {
  const [r] = await db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!r || r.status === "processed") return;
  try {
    const made = (await rz.refundsOf(r.razorpayPaymentId)).find(
      (x) => x.id === r.razorpayRefundId || ((x.receipt === r.id || x.notes?.refund_id === r.id) && x.status !== "failed"),
    );
    const sent = made && !(made.status === "failed" && r.status === "failed") ? made : await rz.refund(r.razorpayPaymentId, r.amountPaise, r.id);
    await db.update(refunds).set({ attempts: r.attempts + 1 }).where(eq(refunds.id, r.id));
    await markRefund(db, notify, r.id, sent, now);
  } catch (e) {
    console.error("[refunds]", r.id, (e as Error).message);
    await db
      .update(refunds)
      .set({ status: "failed", attempts: r.attempts + 1, nextAttemptAt: retryAt(r.createdAt, now), updatedAt: new Date(now) })
      .where(and(eq(refunds.id, r.id), inArray(refunds.status, ["requested", "sent", "failed"])));
  }
}

const settleAndSend = async (db: Db, rz: Razorpay, notify: Notify, orderId: string, paid: Pick<RzPayment, "id" | "fee" | "tax">, now: number) => {
  const s = await settle(db, notify, orderId, paid, now);
  for (const id of s?.refundIds ?? []) await sendRefund(db, rz, notify, id, now);
  return s;
};

// Every 15 minutes (server.ts): orders over 5 minutes old are asked about and settled if Razorpay captured money on
// them, and expired at 30 minutes; refunds due a try are sent again; sent ones an hour old are asked about, in case a
// webhook was lost.
// ponytail: one Razorpay call per open order and per open refund each pass; batch by time range (GET /payments?from=)
// if there are ever hundreds open at once.
export async function pollPayments({ db, rz, notify, now }: { db: Db; rz: Razorpay; notify: Notify; now: number }) {
  const open = await db
    .select()
    .from(payments)
    .where(and(eq(payments.status, "created"), lte(payments.createdAt, new Date(now - POLL_AFTER))));
  for (const p of open) {
    try {
      const got = (await rz.orderPayments(p.razorpayOrderId)).find((x) => x.status === "captured");
      if (got) await settleAndSend(db, rz, notify, p.razorpayOrderId, got, now);
      else if (p.createdAt.getTime() <= now - ORDER_LIFE)
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

export function paymentsRoutes({ db, secret, notify, razorpay: rz, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);

  // POST /events/:id/pay {ticketTypeId, quantity}: every check book() makes, then an order on the host's fee plan with
  // the terms frozen. The person's open order for this ticket type comes back as it is ("You're already paying").
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
      const open = await openOf(tx, ok.tier.id);
      if (open) return { open };
      const [h] = await tx.select({ plan: hosts.feePlan, included: hosts.feeIncluded }).from(hosts).where(eq(hosts.id, ok.e.hostId));
      return { hostId: ok.e.hostId, tierId: ok.tier.id, terms: feeTerms(ok.tier.pricePaise, b.quantity, h!.plan, h!.included) };
    });
    if (checked instanceof Response) return checked;
    if ("open" in checked) return c.json(orderOf(checked.open!, rz.keyId, true));
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

  // POST /payments/:orderId/verify {paymentId, signature}: checkout's answer, from the payer. Settles at once, so the app
  // can show the ticket without waiting for the webhook.
  app.post("/payments/:orderId/verify", auth, async (c) => {
    if (!rz) return off(c);
    const orderId = c.req.param("orderId");
    const b = await parse(c, VerifyPayment);
    if (!b) return invalid(c);
    const [p] = await db.select({ id: payments.id }).from(payments).where(and(eq(payments.razorpayOrderId, orderId), eq(payments.userId, c.var.user.id)));
    if (!p) return nothing(c);
    if (!rz.paymentSigned(orderId, b.paymentId, b.signature))
      return fail(c, 400, "badSignature", "We couldn't confirm this payment here. If money left your account, we'll confirm or refund it on our own.");
    const s = (await settleAndSend(db, rz, notify, orderId, { id: b.paymentId }, now()))!;
    const out: Verified = { status: s.status, bookingId: s.bookingId };
    return c.json(out);
  });

  // POST /razorpay/webhook: Razorpay's word, the source of truth. Signed over the raw body; each event id is taken once
  // it's handled (a repeat of a handled one is a no-op; an unhandled one, such as a refund we can't match yet, is tried
  // again when Razorpay resends it and by the poller).
  app.post("/razorpay/webhook", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    if (!rz) return off(c);
    const body = await c.req.text();
    const at = new Date(now());
    const refuse = async (reason: string) => {
      await db.insert(failedWebhooks).values({ receivedAt: at, reason, excerpt: excerptOf(body) });
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

  return app;
}
