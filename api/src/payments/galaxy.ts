import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  type EventEarnings, type FailedWebhook, type HostFees, NewPayout, PAYMENT_STATUSES, type PaymentDetail, type PaymentList, type PaymentRow,
  MoneyReason, PayoutPaid, type Payouts, type RefundQueue, type RefundRow, SetFees, StaffRefund,
} from "@orbit/contract";
import type { Deps } from "../auth/routes.ts";
import type { Db } from "../db/index.ts";
import { auditLog, events, failedWebhooks, hosts, payments, payouts, refunds, users } from "../db/schema.ts";
import { fail, invalid, isUuid, listPage, PAGE_SIZE, parse, signedIn, taken, type Tx } from "../http.ts";
import { adminsOf, holdersOf, requireFeature, type StaffEnv, tell } from "../roles/access.ts";
import { askedBack, CLAIM, sendRefund } from "./routes.ts";

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

// Each event's numbers, worked out here once (Money flow, "Your earnings"). Per sale that gave a ticket: the price, less
// the commission and any fee the host included (both handed back in proportion to the price refunded), less the price
// refunded. Only refunds of the sale's own Razorpay payment count (a paid-twice refund is the buyer's own money). A refund counts against the price first; any fee on top it hands back is Orbit's. Paid out and requested
// payouts come off what's available.
// ponytail: reads every sale of the events asked; per-event totals kept as rows when there are tens of thousands.
export async function earningsOf(db: Db | Tx, eventIds?: string[]): Promise<EventEarnings[]> {
  const sold = await db
    .select({ p: payments, title: events.title, hostName: hosts.name })
    .from(payments)
    .innerJoin(events, eq(events.id, payments.eventId))
    .innerJoin(hosts, eq(hosts.id, payments.hostId))
    .where(and(isNotNull(payments.bookingId), eventIds ? inArray(payments.eventId, eventIds) : undefined));
  const ids = sold.map((s) => s.p.id);
  const back = new Map(
    (ids.length
      ? await db
          .select({ id: refunds.paymentId, n: sql<number>`sum(${refunds.amountPaise})::int` })
          .from(refunds)
          .innerJoin(payments, and(eq(payments.id, refunds.paymentId), eq(payments.razorpayPaymentId, refunds.razorpayPaymentId)))
          .where(inArray(refunds.paymentId, ids))
          .groupBy(refunds.paymentId)
      : []
    ).map((r) => [r.id, r.n]),
  );
  const outs = await db
    .select({ eventId: payouts.eventId, status: payouts.status, n: sql<number>`sum(${payouts.amountPaise})::int` })
    .from(payouts)
    .where(eventIds ? inArray(payouts.eventId, eventIds) : undefined)
    .groupBy(payouts.eventId, payouts.status);
  const by = new Map<string, EventEarnings>();
  for (const { p, title, hostName } of sold) {
    const e = by.get(p.eventId!) ?? {
      eventId: p.eventId!, eventTitle: title, hostId: p.hostId, hostName,
      salesPaise: 0, commissionPaise: 0, includedPaise: 0, refundedPaise: 0, earningsPaise: 0, paidOutPaise: 0, requestedPaise: 0, availablePaise: 0,
    };
    const price = p.unitPricePaise * p.quantity;
    const refunded = Math.min(back.get(p.id) ?? 0, price);
    const commission = p.commissionPaise - halfUp(p.commissionPaise * refunded, price);
    const included = p.feeIncluded ? p.buyerFeePaise - halfUp(p.buyerFeePaise * refunded, price) : 0;
    e.salesPaise += price;
    e.commissionPaise += commission;
    e.includedPaise += included;
    e.refundedPaise += refunded;
    e.earningsPaise += price - commission - included - refunded;
    by.set(e.eventId, e);
  }
  for (const o of outs) {
    const e = by.get(o.eventId);
    if (!e) continue;
    if (o.status === "paid") e.paidOutPaise += o.n;
    if (o.status === "requested") e.requestedPaise += o.n;
  }
  for (const e of by.values()) e.availablePaise = e.earningsPaise - e.paidOutPaise - e.requestedPaise;
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
  // The booking stays (cancel with a refund comes with Galaxy Bookings, X3).
  app.post("/galaxy/money/payments/:id/refund", cap, ...staff, async (c) => {
    if (!rz) return fail(c, 503, "paymentsOff", "Razorpay isn't set up on this server.");
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, StaffRefund);
    if (!b) return invalid(c);
    const actorId = c.var.actor.id;
    const made = await db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
      if (!p) return fail(c, 404, "notFound", "There's nothing here.");
      if (p.status !== "paid" || !p.razorpayPaymentId) return fail(c, 409, "notPaid", "Only a paid payment can be refunded here.");
      const left = p.amountPaise - (await askedBack(tx, p));
      if (b.amountPaise > left) return fail(c, 400, "tooMuch", `At most ₹${(left / 100).toFixed(2)} can go back on this payment.`, { leftPaise: left });
      const [r] = await tx
        .insert(refunds)
        .values({
          paymentId: p.id, razorpayPaymentId: p.razorpayPaymentId, amountPaise: b.amountPaise, reason: b.reason, kind: "staff", by: actorId,
          nextAttemptAt: new Date(now() + 15 * 60_000), createdAt: at(), updatedAt: at(), // this request sends it; the poller after 15 minutes
        })
        .returning({ id: refunds.id });
      await logged(tx, actorId, "money.refund", b.reason, { paymentId: p.id, refundId: r!.id, amountPaise: b.amountPaise }, p.hostId);
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
      .innerJoin(events, eq(events.id, payouts.eventId))
      .leftJoin(users, eq(users.id, payouts.by))
      .orderBy(desc(payouts.createdAt))
      .limit(500);
    const out: Payouts = {
      payouts: rows.map(({ o, hostName, eventTitle, byName }) => ({
        id: o.id, hostId: o.hostId, hostName, eventId: o.eventId, eventTitle, amountPaise: o.amountPaise, status: o.status, utr: o.utr, reason: o.reason, byName, at: o.at.toISOString(),
      })),
      earnings: await earningsOf(db),
    };
    return c.json(out);
  });

  // POST /galaxy/money/payouts {eventId, amountPaise, reason}: up to what the event has available.
  // ponytail: one payout at a time per event is serialised by the event's row lock; hosts ask from Event Partner later.
  app.post("/galaxy/money/payouts", cap, ...staff, async (c) => {
    const b = await parse(c, NewPayout);
    if (!b) return invalid(c);
    const actorId = c.var.actor.id;
    const done = await db.transaction(async (tx) => {
      const [e] = await tx.select({ id: events.id, hostId: events.hostId }).from(events).where(eq(events.id, b.eventId)).for("update");
      if (!e) return fail(c, 404, "notFound", "There's nothing here.");
      const [mine] = await earningsOf(tx, [e.id]);
      const left = mine?.availablePaise ?? 0;
      if (b.amountPaise > left) return fail(c, 400, "tooMuch", `At most ₹${(left / 100).toFixed(2)} is available for this event.`, { availablePaise: left });
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

  return app;
}
