import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  type EventEarnings, type FailedWebhook, type HostFees, NewPayout, PAYMENT_STATUSES, type PaymentDetail, type PaymentList, type PaymentRow,
  MoneyReason, PayoutPaid, type Payouts, readPhone, type RefundQueue, type RefundRow, SetFees, type StaffBooking, StaffRefund,
} from "@orbit/contract";
import type { Deps } from "../auth/routes.ts";
import type { Db } from "../db/index.ts";
import { auditLog, bookings, events, failedWebhooks, hosts, payments, payouts, refunds, stationClaims, ticketTypes, users } from "../db/schema.ts";
import { fail, invalid, isUuid, listPage, PAGE_SIZE, parse, signedIn, taken, type Tx } from "../http.ts";
import { adminsOf, holdersOf, requireFeature, type StaffEnv, tell } from "../roles/access.ts";
import { holds } from "../roles/rules.ts";
import { lockHold } from "../slots/hold.ts";
import { askedBack, CLAIM, refundPaid, sendRefund } from "./routes.ts";

// Galaxy's Money pages (Money flow, "Galaxy"; X2), for holders of Money: payments with their frozen terms and a refund,
// the refunds queue and the failed ones, payouts with their UTRs, each host's fee plan, and webhooks refused. Every
// change is in the audit log and emailed to every holder of Money.

type Pay = typeof payments.$inferSelect;
type Ref = typeof refunds.$inferSelect;

const halfUp = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

const paymentRow = (p: Pay, names: { userName: string | null; hostName: string; eventTitle: string | null }): PaymentRow => ({
  ...p, ...names, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
});
const refundRow = (r: Ref, byName: string | null): RefundRow => ({
  id: r.id, paymentId: r.paymentId, razorpayPaymentId: r.razorpayPaymentId, amountPaise: r.amountPaise, reason: r.reason, kind: r.kind,
  status: r.status, razorpayRefundId: r.razorpayRefundId, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
  byName, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});
const refundsWhere = async (db: Db, where: SQL) =>
  (await db.select({ r: refunds, by: users.name }).from(refunds).leftJoin(users, eq(users.id, refunds.by)).where(where).orderBy(desc(refunds.createdAt)).limit(200)).map(
    (x) => refundRow(x.r, x.by),
  );

// Each event's numbers, and each venue's slot money (one pot per venue, `eventId` null), worked out here once (Money
// flow, "Your earnings"). Per sale that gave a ticket or booked a slot: the price, less the commission and any fee the
// host included (both handed back in proportion to the price refunded), less the price refunded. Only refunds of the
// sale's own Razorpay payment count (a paid-twice refund is the buyer's own money). A refund counts against the price
// first; any fee on top it hands back is Orbit's. A player's own cancel of a slot (a "request" refund) undoes the whole
// sale: the fee it kept is Orbit's. Paid out and requested payouts come off what's available, and so does a slot not
// yet played (`at`): its player can still cancel it until it starts, so it isn't paid out before then.
// ponytail: reads every sale asked for; per-event totals kept as rows when there are tens of thousands.
export type Only = { eventIds: string[] } | { venue: string };
export async function earningsOf(db: Db | Tx, only?: Only, at = new Date()): Promise<EventEarnings[]> {
  const scope = !only ? undefined : "eventIds" in only ? inArray(payments.eventId, only.eventIds) : and(eq(payments.kind, "slot"), eq(payments.hostId, only.venue));
  const sold = await db
    .select({ p: payments, title: events.title, hostName: hosts.name, startsAt: stationClaims.startsAt, admitted: stationClaims.admitted })
    .from(payments)
    .leftJoin(events, eq(events.id, payments.eventId))
    .leftJoin(stationClaims, eq(stationClaims.id, payments.claimId))
    .innerJoin(hosts, eq(hosts.id, payments.hostId))
    .where(and(or(isNotNull(payments.bookingId), eq(payments.slotBooked, true)), scope));
  const ids = sold.map((s) => s.p.id);
  const refunded = ids.length
    ? await db
        .select({ id: refunds.paymentId, n: sql<number>`sum(${refunds.amountPaise})::int`, cancel: sql<boolean>`bool_or(${refunds.kind} = 'request')` })
        .from(refunds)
        .innerJoin(payments, and(eq(payments.id, refunds.paymentId), eq(payments.razorpayPaymentId, refunds.razorpayPaymentId)))
        .where(inArray(refunds.paymentId, ids))
        .groupBy(refunds.paymentId)
    : [];
  const back = new Map(refunded.map((r) => [r.id, r]));
  const outs = await db
    .select({ eventId: payouts.eventId, hostId: payouts.hostId, status: payouts.status, n: sql<number>`sum(${payouts.amountPaise})::int` })
    .from(payouts)
    .where(!only ? undefined : "eventIds" in only ? inArray(payouts.eventId, only.eventIds) : and(isNull(payouts.eventId), eq(payouts.hostId, only.venue)))
    .groupBy(payouts.eventId, payouts.hostId, payouts.status);
  const keyOf = (eventId: string | null, hostId: string) => eventId ?? `venue:${hostId}`;
  const by = new Map<string, EventEarnings>();
  const unplayed = new Map<string, number>();
  for (const { p, title, hostName, startsAt, admitted } of sold) {
    const key = keyOf(p.eventId, p.hostId);
    const e = by.get(key) ?? {
      eventId: p.eventId, eventTitle: title, hostId: p.hostId, hostName,
      salesPaise: 0, commissionPaise: 0, includedPaise: 0, refundedPaise: 0, earningsPaise: 0, paidOutPaise: 0, requestedPaise: 0, availablePaise: 0,
    };
    const price = p.unitPricePaise * p.quantity;
    const r = back.get(p.id);
    const undone = r?.cancel ? price : Math.min(r?.n ?? 0, price);
    const commission = p.commissionPaise - halfUp(p.commissionPaise * undone, price);
    const included = p.feeIncluded ? p.buyerFeePaise - halfUp(p.buyerFeePaise * undone, price) : 0;
    e.salesPaise += price;
    e.commissionPaise += commission;
    e.includedPaise += included;
    e.refundedPaise += undone;
    e.earningsPaise += price - commission - included - undone;
    if (p.slotBooked && startsAt && startsAt > at && !admitted) unplayed.set(key, (unplayed.get(key) ?? 0) + price - commission - included - undone);
    by.set(key, e);
  }
  for (const o of outs) {
    const e = by.get(keyOf(o.eventId, o.hostId));
    if (!e) continue;
    if (o.status === "paid") e.paidOutPaise += o.n;
    if (o.status === "requested") e.requestedPaise += o.n;
  }
  for (const [key, e] of by) e.availablePaise = e.earningsPaise - e.paidOutPaise - e.requestedPaise - (unplayed.get(key) ?? 0);
  return [...by.values()];
}

export function moneyRoutes({ db, secret, notify, razorpay: rz, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const staff = [signedIn(db, secret, now), requireFeature(db, now, "money")] as const;
  const cap = bodyLimit({ maxSize: 8 * 1024, onError: (c) => invalid(c) });
  const at = () => new Date(now());
  // The audit row with the change, and the email to every holder of Money after.
  const logged = (tx: Tx, actorId: string, action: string, reason: string, data: Record<string, unknown>, targetHost?: string) =>
    tx.insert(auditLog).values({ actorId, action, reason, data, targetHost, at: at() });
  const tellMoney = async (action: string, reason: string, by: string) =>
    tell(notify, await holdersOf(db, "money", at()), "staffRiskyAction", { action, reason, by });

  const named = (q = db) =>
    q
      .select({ p: payments, userName: users.name, hostName: hosts.name, eventTitle: events.title })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.userId))
      .innerJoin(hosts, eq(hosts.id, payments.hostId))
      .leftJoin(events, eq(events.id, payments.eventId));

  // GET /galaxy/money/payments?status=&host=&event=&q=&page=: newest first. `q`: a Razorpay order or payment id.
  app.get("/galaxy/money/payments", ...staff, async (c) => {
    const { page, limit, offset } = listPage(c);
    const status = c.req.query("status"), host = c.req.query("host"), event = c.req.query("event"), q = c.req.query("q")?.trim();
    const where = and(
      status && (PAYMENT_STATUSES as readonly string[]).includes(status) ? eq(payments.status, status as Pay["status"]) : undefined,
      host && isUuid(host) ? eq(payments.hostId, host) : undefined,
      event && isUuid(event) ? eq(payments.eventId, event) : undefined,
      q ? or(eq(payments.razorpayOrderId, q), eq(payments.razorpayPaymentId, q)) : undefined,
    );
    const rows = await named().where(where).orderBy(desc(payments.createdAt)).limit(limit).offset(offset);
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(payments).where(where)) as [{ n: number }];
    const out: PaymentList = { payments: rows.map((r) => paymentRow(r.p, r)), total: n, page, pageSize: PAGE_SIZE };
    return c.json(out);
  });

  // GET /galaxy/money/payments/:id: one payment, its refunds and what can still go back.
  app.get("/galaxy/money/payments/:id", ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const [r] = await named().where(eq(payments.id, id));
    if (!r) return fail(c, 404, "notFound", "There's nothing here.");
    const rs = await refundsWhere(db, eq(refunds.paymentId, id));
    const out: PaymentDetail = {
      payment: paymentRow(r.p, r),
      refunds: rs,
      refundablePaise: r.p.status === "paid" ? r.p.amountPaise - (await askedBack(db, r.p)) : 0,
    };
    return c.json(out);
  });

  // POST /galaxy/money/payments/:id/refund {amountPaise, reason}: up to what was paid less what's already asked back.
  // A part refund keeps the booking; one that takes back all that's left cancels it (the payment is then refundPending).
  // Locks: the booking, then the payment, as event cancel, account deletion and Galaxy's booking cancel take them (a
  // paid payment's booking never changes, so reading it unlocked first is safe). A slot's payment taken back whole frees
  // its slot (the claim refunded, so it stops counting and the scanner refuses it); the hold's locks (person first) come
  // before the paid payment's, as account deletion takes them. One already checked in stays as it is.
  app.post("/galaxy/money/payments/:id/refund", cap, ...staff, async (c) => {
    if (!rz) return fail(c, 503, "paymentsOff", "Razorpay isn't set up on this server.");
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, StaffRefund);
    if (!b) return invalid(c);
    const actorId = c.var.actor.id;
    const made = await db.transaction(async (tx) => {
      const [seen] = await tx.select({ bookingId: payments.bookingId, claimId: payments.claimId, status: payments.status }).from(payments).where(eq(payments.id, id));
      // Only a paid one is refunded here (settle, on an unpaid one, locks the payment before the hold).
      if (seen?.claimId && seen.status === "paid") await lockHold(tx, seen.claimId);
      if (seen?.bookingId) await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, seen.bookingId)).for("update");
      const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
      if (!p) return fail(c, 404, "notFound", "There's nothing here.");
      if (p.status !== "paid" || !p.razorpayPaymentId) return fail(c, 409, "notPaid", "Only a paid payment can be refunded here.");
      const left = p.amountPaise - (await askedBack(tx, p));
      if (b.amountPaise > left) return fail(c, 400, "tooMuch", `At most ₹${(left / 100).toFixed(2)} can go back on this payment.`, { leftPaise: left });
      if (b.amountPaise === left) {
        await tx.update(payments).set({ status: "refundPending", updatedAt: at() }).where(eq(payments.id, p.id));
        if (p.bookingId)
          await tx.update(bookings).set({ status: "cancelled", cancelledAt: at(), link: null }).where(and(eq(bookings.id, p.bookingId), eq(bookings.status, "confirmed")));
        if (p.claimId)
          await tx.update(stationClaims).set({ status: "refunded", updatedAt: at() }).where(and(eq(stationClaims.id, p.claimId), eq(stationClaims.status, "paid")));
      }
      const [r] = await tx
        .insert(refunds)
        .values({
          paymentId: p.id, razorpayPaymentId: p.razorpayPaymentId, amountPaise: b.amountPaise, reason: b.reason, kind: "staff", by: actorId,
          nextAttemptAt: new Date(now() + 15 * 60_000), createdAt: at(), updatedAt: at(), // this request sends it; the poller after 15 minutes
        })
        .returning({ id: refunds.id });
      await logged(tx, actorId, "money.refund", b.reason, { paymentId: p.id, refundId: r!.id, amountPaise: b.amountPaise, cancelled: b.amountPaise === left ? (p.bookingId ?? p.claimId) : null }, p.hostId);
      return r!.id;
    });
    if (made instanceof Response) return made;
    await sendRefund(db, rz, notify, made, now(), true);
    await tellMoney("money.refund", b.reason, actorId);
    const [r] = await refundsWhere(db, eq(refunds.id, made));
    return c.json(r, 201);
  });

  // GET /galaxy/money/refunds: still on their way (asked or sent), and failed ones; failed ones out of retries wait here.
  app.get("/galaxy/money/refunds", ...staff, async (c) => {
    const out: RefundQueue = {
      open: await refundsWhere(db, inArray(refunds.status, ["requested", "sent"])),
      failed: await refundsWhere(db, eq(refunds.status, "failed")),
    };
    return c.json(out);
  });

  // POST /galaxy/money/refunds/:id/retry {reason}: a failed refund, sent again now (found again if Razorpay has it).
  app.post("/galaxy/money/refunds/:id/retry", cap, ...staff, async (c) => {
    if (!rz) return fail(c, 503, "paymentsOff", "Razorpay isn't set up on this server.");
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, MoneyReason);
    if (!b) return invalid(c);
    // Still failed, only due now: sendRefund's claim takes it, and seeing Razorpay's failed one sends anew. Not while a
    // send holds it (its claim puts the next try at most CLAIM ahead), so a second press is a 409, not a second refund;
    // an hourly retry further off is brought forward.
    const r = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(refunds)
        .set({ nextAttemptAt: at(), updatedAt: at() })
        .where(
          and(
            eq(refunds.id, id),
            eq(refunds.status, "failed"),
            or(isNull(refunds.nextAttemptAt), lte(refunds.nextAttemptAt, at()), gt(refunds.nextAttemptAt, new Date(now() + CLAIM))),
          ),
        )
        .returning({ id: refunds.id });
      if (r) await logged(tx, c.var.actor.id, "money.refund.retry", b.reason, { refundId: id });
      return r;
    });
    if (!r) {
      const [had] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.id, id));
      return had ? fail(c, 409, "notFailed", "Only a failed refund not being sent right now can be sent again.") : fail(c, 404, "notFound", "There's nothing here.");
    }
    await sendRefund(db, rz, notify, id, now());
    await tellMoney("money.refund.retry", b.reason, c.var.actor.id);
    return c.json((await refundsWhere(db, eq(refunds.id, id)))[0]);
  });

  // GET /galaxy/money/payouts: every payout, newest first, and each event's earnings.
  app.get("/galaxy/money/payouts", ...staff, async (c) => {
    const rows = await db
      .select({ o: payouts, hostName: hosts.name, eventTitle: events.title, byName: users.name })
      .from(payouts)
      .innerJoin(hosts, eq(hosts.id, payouts.hostId))
      .leftJoin(events, eq(events.id, payouts.eventId))
      .leftJoin(users, eq(users.id, payouts.by))
      .orderBy(desc(payouts.createdAt))
      .limit(500);
    const out: Payouts = {
      payouts: rows.map(({ o, hostName, eventTitle, byName }) => ({
        id: o.id, hostId: o.hostId, hostName, eventId: o.eventId, eventTitle, amountPaise: o.amountPaise, status: o.status, utr: o.utr, reason: o.reason, byName, at: o.at.toISOString(),
      })),
      earnings: await earningsOf(db, undefined, new Date(now())),
    };
    return c.json(out);
  });

  // POST /galaxy/money/payouts {eventId | hostId, amountPaise, reason}: up to what the event (or the venue's slot money,
  // by hostId) has available.
  // ponytail: one payout at a time per event or venue is serialised by its row lock; hosts ask from the partner apps later.
  app.post("/galaxy/money/payouts", cap, ...staff, async (c) => {
    const b = await parse(c, NewPayout);
    if (!b) return invalid(c);
    const actorId = c.var.actor.id;
    const done = await db.transaction(async (tx) => {
      const [e] = b.eventId
        ? await tx.select({ id: events.id, hostId: events.hostId }).from(events).where(eq(events.id, b.eventId)).for("update")
        : await tx.select({ id: sql<null>`null`, hostId: hosts.id }).from(hosts).where(eq(hosts.id, b.hostId!)).for("update");
      if (!e) return fail(c, 404, "notFound", "There's nothing here.");
      const [mine] = await earningsOf(tx, e.id ? { eventIds: [e.id] } : { venue: e.hostId }, new Date(now()));
      const left = mine?.availablePaise ?? 0;
      if (b.amountPaise > left) return fail(c, 400, "tooMuch", `At most ₹${(left / 100).toFixed(2)} is available for this ${e.id ? "event" : "venue"}.`, { availablePaise: left });
      const [o] = await tx.insert(payouts).values({ hostId: e.hostId, eventId: e.id, amountPaise: b.amountPaise, reason: b.reason, by: actorId, at: at(), createdAt: at() }).returning();
      await logged(tx, actorId, "money.payout.create", b.reason, { payoutId: o!.id, eventId: e.id, amountPaise: b.amountPaise }, e.hostId);
      return o!;
    });
    if (done instanceof Response) return done;
    await tellMoney("money.payout.create", b.reason, actorId);
    return c.json({ id: done.id }, 201);
  });

  // A requested payout, locked, moved on by `change`; the host's Admins hear `kind`.
  const settlePayout = (id: string, actorId: string, action: string, reason: string, set: Partial<typeof payouts.$inferInsert>) =>
    db.transaction(async (tx) => {
      const [o] = await tx.select().from(payouts).where(eq(payouts.id, id)).for("update");
      if (!o) return "notFound" as const;
      if (o.status !== "requested") return "notOpen" as const;
      await tx.update(payouts).set({ ...set, by: actorId, at: at() }).where(eq(payouts.id, id));
      await logged(tx, actorId, action, reason, { payoutId: id, ...set }, o.hostId);
      return o;
    });

  // POST /galaxy/money/payouts/:id/paid {utr, reason?}: transferred; the UTR is never reused.
  app.post("/galaxy/money/payouts/:id/paid", cap, ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, PayoutPaid);
    if (!b) return fail(c, 400, "invalid", "A UTR is 6 to 40 letters and digits.");
    const reason = b.reason || `UTR ${b.utr}`;
    let o;
    try {
      o = await settlePayout(id, c.var.actor.id, "money.payout.paid", reason, { status: "paid", utr: b.utr.toUpperCase() }); // one UTR, however it's typed
    } catch (e) {
      if (taken(e)) return fail(c, 409, "utrUsed", "That UTR is already on another payout.");
      throw e;
    }
    if (o === "notFound") return fail(c, 404, "notFound", "There's nothing here.");
    if (o === "notOpen") return fail(c, 409, "notOpen", "Only a requested payout can be marked paid.");
    await tell(notify, await adminsOf(db, o.hostId), "payoutPaid", { hostId: o.hostId, amountPaise: o.amountPaise, utr: b.utr.toUpperCase() });
    await tellMoney("money.payout.paid", reason, c.var.actor.id);
    return c.json({ ok: true });
  });

  // POST /galaxy/money/payouts/:id/cancel {reason}: the host's Admins see the reason.
  app.post("/galaxy/money/payouts/:id/cancel", cap, ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, MoneyReason);
    if (!b) return invalid(c);
    const o = await settlePayout(id, c.var.actor.id, "money.payout.cancel", b.reason, { status: "cancelled", reason: b.reason });
    if (o === "notFound") return fail(c, 404, "notFound", "There's nothing here.");
    if (o === "notOpen") return fail(c, 409, "notOpen", "Only a requested payout can be cancelled.");
    await tell(notify, await adminsOf(db, o.hostId), "payoutCancelled", { hostId: o.hostId, amountPaise: o.amountPaise, reason: b.reason });
    await tellMoney("money.payout.cancel", b.reason, c.var.actor.id);
    return c.json({ ok: true });
  });

  // GET /galaxy/money/fees?q=&page=: hosts by name with their fee plan.
  app.get("/galaxy/money/fees", ...staff, async (c) => {
    const { page, limit, offset } = listPage(c);
    const q = c.req.query("q")?.trim();
    const where = q ? ilike(hosts.name, `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`) : undefined;
    const rows = await db.select({ id: hosts.id, name: hosts.name, plan: hosts.feePlan, feeIncluded: hosts.feeIncluded }).from(hosts).where(where).orderBy(hosts.name).limit(limit).offset(offset);
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(hosts).where(where)) as [{ n: number }];
    const out: HostFees = { hosts: rows, total: n, page, pageSize: PAGE_SIZE };
    return c.json(out);
  });

  // PUT /galaxy/money/fees/:hostId {plan, feeIncluded, reason}: for sales from now on; past payments keep their terms.
  app.put("/galaxy/money/fees/:hostId", cap, ...staff, async (c) => {
    const id = c.req.param("hostId");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, SetFees);
    if (!b) return invalid(c);
    const actorId = c.var.actor.id;
    const h = await db.transaction(async (tx) => {
      const [h] = await tx.update(hosts).set({ feePlan: b.plan, feeIncluded: b.feeIncluded, updatedAt: at() }).where(eq(hosts.id, id)).returning({ id: hosts.id, name: hosts.name });
      if (h) await logged(tx, actorId, "money.fees", b.reason, { plan: b.plan, feeIncluded: b.feeIncluded }, h.id);
      return h;
    });
    if (!h) return fail(c, 404, "notFound", "There's nothing here.");
    await tell(notify, await adminsOf(db, h.id), "feeChange", { hostId: h.id, hostName: h.name, plan: b.plan, feeIncluded: b.feeIncluded });
    await tellMoney("money.fees", b.reason, actorId);
    return c.json({ ok: true });
  });

  // GET /galaxy/money/failed-webhooks: the last 200 refused.
  app.get("/galaxy/money/failed-webhooks", ...staff, async (c) => {
    const rows = await db.select().from(failedWebhooks).orderBy(desc(failedWebhooks.receivedAt)).limit(200);
    const out: FailedWebhook[] = rows.map((r) => ({ id: r.id, receivedAt: r.receivedAt.toISOString(), reason: r.reason, excerpt: r.excerpt }));
    return c.json(out);
  });

  // ---------- Bookings and tickets (X3), for holders of Money too: a cancel can send money back ----------
  const like = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

  // GET /galaxy/bookings?person=&event=: bookings of a person (exact phone or email, else by name; 3 characters at
  // least) and/or of an event (its id, or by title), newest first, each with its ticket and payment. Logged by ids only.
  // Finding a person also needs People, as People's own search does; by event, Money is enough. No entry code: staff
  // never need the gate's credential.
  app.get("/galaxy/bookings", ...staff, async (c) => {
    const person = c.req.query("person")?.trim() ?? "", event = c.req.query("event")?.trim() ?? "";
    if ((person && person.length < 3) || (event && event.length < 3) || (!person && !event)) return fail(c, 400, "invalid", "Type at least 3 characters of a person or an event.");
    if (person && !holds(c.var.actor, "people")) return fail(c, 403, "needsPeople", "Finding bookings by person needs People. Search by event instead.");
    const phone = person ? readPhone(person) : null;
    const by = !person ? null : typeof phone === "string" && phone !== "abroad" ? "phone" : person.includes("@") ? "email" : "name";
    const who =
      by === "phone" ? eq(users.phone, phone as string) : by === "email" ? eq(users.email, person.toLowerCase()) : by === "name" ? ilike(users.name, like(person)) : undefined;
    const what = !event ? undefined : isUuid(event) ? eq(bookings.eventId, event) : ilike(events.title, like(event));
    const rows = await db
      .select({
        b: bookings, userName: users.name, eventTitle: events.title, hostId: hosts.id, hostName: hosts.name, ticketTypeName: ticketTypes.name,
        pricePaise: ticketTypes.pricePaise, pay: { id: payments.id, status: payments.status, amountPaise: payments.amountPaise },
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.userId))
      .innerJoin(events, eq(events.id, bookings.eventId))
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .innerJoin(ticketTypes, eq(ticketTypes.id, bookings.ticketTypeId))
      .leftJoin(payments, eq(payments.bookingId, bookings.id))
      .where(and(who, what))
      .orderBy(desc(bookings.createdAt))
      .limit(100);
    await db.insert(auditLog).values({ actorId: c.var.actor.id, action: "bookings.search", data: { by, event: !!event, results: rows.map((r) => r.b.id) }, at: at() });
    const out: StaffBooking[] = rows.map(({ b, pay, ...r }) => ({
      id: b.id, status: b.status, quantity: b.quantity, createdAt: b.createdAt.toISOString(), cancelledAt: b.cancelledAt?.toISOString() ?? null,
      userId: b.userId, eventId: b.eventId, ...r, payment: pay?.id ? pay : null,
    }));
    return c.json(out);
  });

  // POST /galaxy/bookings/:id/cancel {reason}: a confirmed booking is cancelled, its seats free; a paid one goes back in
  // full, fee included, through refundPaid in the same transaction, sent once it commits (the poller sends any that
  // didn't go). Locks: the holder, then the booking, then its payment (refundPaid), as mine() and account deletion take
  // them (a booking's holder never changes, so reading it unlocked first is safe). Razorpay off: a free one still goes.
  // ponytail: no notice to the holder yet (bookingCancelled has no wording); they hear of the refund when it lands.
  // ponytail: a second payment landing on this booking's order at the same moment (paid twice: settle locks the payment,
  // then nothing else) can deadlock with this, as with a holder's cancel or account deletion; Postgres aborts one with
  // 40P01, no money moves wrongly, and pressing Cancel again works. Lock the payment first everywhere if it's ever seen.
  app.post("/galaxy/bookings/:id/cancel", cap, ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, MoneyReason);
    if (!b) return invalid(c);
    const actorId = c.var.actor.id;
    const done = await db.transaction(async (tx) => {
      const [seen] = await tx.select({ userId: bookings.userId }).from(bookings).where(eq(bookings.id, id));
      if (!seen) return fail(c, 404, "notFound", "There's nothing here.");
      await tx.select({ id: users.id }).from(users).where(eq(users.id, seen.userId)).for("update");
      const [bk] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
      if (!bk) return fail(c, 404, "notFound", "There's nothing here.");
      if (bk.status !== "confirmed") return fail(c, 409, "notConfirmed", "This booking is already cancelled.");
      if (!rz) {
        const [paid] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.bookingId, id), eq(payments.status, "paid")));
        if (paid) return fail(c, 503, "paymentsOff", "Razorpay isn't set up on this server, so a paid booking can't be refunded.");
      }
      await tx.update(bookings).set({ status: "cancelled", cancelledAt: at(), link: null }).where(eq(bookings.id, id));
      const back = await refundPaid(tx, eq(payments.bookingId, id), b.reason, at());
      const [e] = await tx.select({ hostId: events.hostId }).from(events).where(eq(events.id, bk.eventId));
      await tx.insert(auditLog).values({ actorId, action: "bookings.cancel", reason: b.reason, targetUser: bk.userId, targetHost: e!.hostId, data: { bookingId: id, refundIds: back }, at: at() });
      return back;
    });
    if (done instanceof Response) return done;
    // After the answer; a refund that doesn't go is the poller's after 15 minutes.
    if (rz && done.length)
      void Promise.all(done.map((r) => sendRefund(db, rz, notify, r, now(), true))).catch(() => console.error("[refunds] after booking cancel", done.join(",")));
    await tellMoney("bookings.cancel", b.reason, actorId);
    return c.json({ ok: true, refunded: done.length > 0 });
  });

  return app;
}
