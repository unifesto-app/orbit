import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { auditLog, bookings, failedWebhooks, hosts, payments, razorpayEvents, refunds, staffGrants } from "./db/schema.ts";
import { earningsOf } from "./payments/galaxy.ts";
import { paymentsRoutes, pollPayments, sendRefund } from "./payments/routes.ts";
import { razorpay, type RzPayment, type RzRefund } from "./payments/razorpay.ts";

// Paying (Money flow; X2): orders, verify, webhook, settle, the poller, and Galaxy's Money routes. Razorpay is a fake
// fetch below: no test reaches the network.

const KEY = { keyId: "rzp_test_abc", keySecret: "key-secret-for-tests", webhookSecret: "hook-secret-for-tests" };
const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

// Razorpay as these tests need it: orders, payments captured on them, refunds (pending until a test processes them).
const rzState = { orders: 0, refunds: [] as RzRefund[], captured: new Map<string, RzPayment[]>(), refundFails: false, calls: [] as string[] };
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const path = new URL(String(url)).pathname.replace(/^\/v1/, "");
  const method = init?.method ?? "GET";
  rzState.calls.push(`${method} ${path}`);
  assert.equal((init?.headers as Record<string, string>).authorization, `Basic ${Buffer.from(`${KEY.keyId}:${KEY.keySecret}`).toString("base64")}`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (method === "POST" && path === "/orders") return json({ id: `order_${++rzState.orders}`, amount: body.amount, receipt: body.receipt });
  if (method === "POST" && path === "/orders") assert.equal(body.payment_capture, 1);
  let m = path.match(/^\/orders\/([^/]+)\/payments$/);
  if (m) return json({ items: rzState.captured.get(m[1]!) ?? [] });
  m = path.match(/^\/payments\/([^/]+)$/);
  if (m) {
    const p = [...rzState.captured.values()].flat().find((x) => x.id === m![1]);
    return p ? json(p) : json({ error: { code: "BAD_REQUEST_ERROR" } }, 400);
  }
  m = path.match(/^\/payments\/([^/]+)\/refunds$/);
  if (m) return json({ items: rzState.refunds.filter((r) => r.payment_id === m![1]) });
  m = path.match(/^\/payments\/([^/]+)\/refund$/);
  if (m) {
    if (rzState.refundFails) return json({ error: { code: "SERVER_ERROR" } }, 500);
    const r: RzRefund = { id: `rfnd_${rzState.refunds.length + 1}`, payment_id: m[1]!, amount: body.amount, status: "pending", receipt: body.receipt, notes: body.notes };
    rzState.refunds.push(r);
    return json(r);
  }
  return json({ error: { code: "NOT_FOUND" } }, 404);
}) as typeof fetch;
const rz = razorpay({ ...KEY, fetch: fakeFetch });

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp({ razorpay: rz })));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(7_000_000 + ++n * 13).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR, MIN = 60_000;

const join = async (p = phone()) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const give = (u: P, feature: "money" | "people") =>
  t.db.insert(staffGrants).values({ userId: u.me.id, feature, addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });

const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
let hn = 0;
// A published event on its own host with one paid ticket type.
const publish = async (u: P, tier: object = {}) => {
  const h = (await as(u)("POST", "/hosts", { name: `Pay Club ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
  const e = (await as(u)("POST", `/hosts/${h.id}/events`, { title: "Open Mic Night" })).body as { id: string };
  const form = new FormData();
  const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer();
  form.set("image", new File([png as BlobPart], "p.png", { type: "image/png" }));
  await t.app.request(`/events/${e.id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  assert.equal((await as(u)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(DAY), endsAt: iso(DAY + 2 * HOUR), place })).status, 200);
  const r = await as(u)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 120000, ...tier });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await as(u)("POST", `/events/${e.id}/publish`)).status, 200);
  return { id: e.id, hostId: h.id, tier: r.body.id as string };
};
type E = Awaited<ReturnType<typeof publish>>;
const pay = (u: P, e: E, quantity = 1) => as(u)("POST", `/events/${e.id}/pay`, { ticketTypeId: e.tier, quantity });
let pn = 0;
// Razorpay takes the money on an order: answers the payment, which the fake then lists on the order.
const capture = (orderId: string, amount: number, status = "captured"): RzPayment => {
  const p = { id: `pay_${++pn}`, order_id: orderId, status, amount, fee: 2832, tax: 432 };
  rzState.captured.set(orderId, [...(rzState.captured.get(orderId) ?? []), p]);
  return p;
};
const verify = (u: P, orderId: string, paymentId: string, sig = sign(KEY.keySecret, `${orderId}|${paymentId}`)) =>
  as(u)("POST", `/payments/${orderId}/verify`, { paymentId, signature: sig });
let en = 0;
const hook = async (event: string, payload: object, o: { id?: string; sig?: string } = {}) => {
  const body = JSON.stringify({ entity: "event", event, payload });
  const res = await t.app.request("/razorpay/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": o.sig ?? sign(KEY.webhookSecret, body), "x-razorpay-event-id": o.id ?? `evt_${++en}` },
    body,
  });
  return res.status;
};
const paymentOf = async (orderId: string) => (await t.db.select().from(payments).where(eq(payments.razorpayOrderId, orderId)))[0]!;
const bookingsOf = (u: P) => t.db.select().from(bookings).where(eq(bookings.userId, u.me.id));

test("signatures: checkout's over order|payment with the key secret, webhooks over the raw body", () => {
  const good = sign(KEY.keySecret, "order_1|pay_1");
  assert.equal(rz.paymentSigned("order_1", "pay_1", good), true);
  assert.equal(rz.paymentSigned("order_1", "pay_2", good), false);
  assert.equal(rz.paymentSigned("order_1", "pay_1", "nothex"), false);
  assert.equal(rz.paymentSigned("order_1", "pay_1", sign(KEY.webhookSecret, "order_1|pay_1")), false); // the wrong secret
  assert.equal(rz.webhookSigned('{"a":1}', sign(KEY.webhookSecret, '{"a":1}')), true);
  assert.equal(rz.webhookSigned('{"a":1} ', sign(KEY.webhookSecret, '{"a":1}')), false);
});

test("pay: the order on the host's plan, the same order on a second tap, free tiers and book() refused", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, { quantity: 10 });
  const r = await pay(b, e, 2);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // 3+2 on top: ₹1,200 × 2 + 3% fee (₹36 a seat).
  assert.deepEqual(r.body.breakdown, { pricePaise: 240000, feePaise: 7200, feeIncluded: false, amountPaise: 247200 });
  assert.equal(r.body.keyId, KEY.keyId);
  assert.equal(r.body.already, false);
  const row = await paymentOf(r.body.orderId);
  assert.deepEqual(
    [row.status, row.plan, row.buyerFeeBps, row.buyerFeePaise, row.commissionBps, row.commissionPaise, row.gstFeePaise, row.merchant, row.bookingId],
    ["created", "3+2", 300, 7200, 200, 4800, 0, "orbit", null],
  );
  const again = await pay(b, e, 2);
  assert.equal(again.status, 200);
  assert.equal(again.body.orderId, r.body.orderId);
  assert.equal(again.body.already, true);
  // Book() still refuses a paid tier; /pay refuses a free one.
  assert.equal((await as(b)("POST", `/events/${e.id}/book`, { ticketTypeId: e.tier, quantity: 1 })).body.error, "paidLater");
  const free = await publish(a, { pricePaise: 0 });
  const f = await pay(b, free);
  assert.equal(f.status, 400);
  assert.equal(f.body.error, "free");
  // Not signed in.
  assert.equal((await t.call("POST", `/events/${e.id}/pay`, { ticketTypeId: e.tier, quantity: 1 })).status, 401);
  // Fee included on 5+0: the buyer pays the price.
  await t.db.update(hosts).set({ feePlan: "5+0", feeIncluded: true }).where(eq(hosts.id, e.hostId));
  const c = await join();
  const inc = await pay(c, e);
  assert.deepEqual(inc.body.breakdown, { pricePaise: 120000, feePaise: 0, feeIncluded: true, amountPaise: 120000 });
  assert.equal((await paymentOf(inc.body.orderId)).buyerFeePaise, 5714);
});

test("paying is off without Razorpay's keys", async () => {
  const app = paymentsRoutes({ db: t.db, secret: t.secret, notify: t.notify, now: t.now } as never);
  const res = await app.request("/razorpay/webhook", { method: "POST", body: "{}" });
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error: string }).error, "paymentsOff");
});

test("settle once: verify then the webhook gives one booking; a bad signature settles nothing", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  const p = capture(o.orderId, o.amountPaise);
  const bad = await verify(b, o.orderId, p.id, sign("wrong", `${o.orderId}|${p.id}`));
  assert.equal(bad.status, 400);
  assert.equal((await paymentOf(o.orderId)).status, "created");
  // Someone else's order is a 404.
  assert.equal((await verify(a, o.orderId, p.id)).status, 404);
  const v = await verify(b, o.orderId, p.id);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.status, "paid");
  assert.ok(v.body.bookingId);
  assert.equal(await hook("payment.captured", { payment: { entity: p } }), 200);
  assert.equal(await hook("order.paid", { payment: { entity: p } }), 200);
  assert.equal((await verify(b, o.orderId, p.id)).body.bookingId, v.body.bookingId);
  const rows = await bookingsOf(b);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "confirmed");
  const row = await paymentOf(o.orderId);
  assert.deepEqual([row.status, row.razorpayPaymentId, row.bookingId, row.razorpayFeePaise], ["paid", p.id, v.body.bookingId, 2832]);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.paymentId, row.id))).length, 0);
  // They hold the ticket now: no second order.
  assert.equal((await pay(b, e)).body.error, "booked");
});

test("sold out while paying: the second payer is refunded in full, fee included, and told", async () => {
  const a = await join(), b = await join(), c = await join();
  const e = await publish(a, { quantity: 1 });
  const ob = (await pay(b, e)).body, oc = (await pay(c, e)).body;
  assert.equal((await verify(b, ob.orderId, capture(ob.orderId, ob.amountPaise).id)).body.status, "paid");
  const pc = capture(oc.orderId, oc.amountPaise);
  const v = await hook("payment.captured", { payment: { entity: pc } });
  assert.equal(v, 200);
  const row = await paymentOf(oc.orderId);
  assert.equal(row.status, "refundPending");
  assert.equal(row.bookingId, null);
  const [r] = await t.db.select().from(refunds).where(eq(refunds.paymentId, row.id));
  assert.deepEqual([r!.amountPaise, r!.kind, r!.status, r!.razorpayPaymentId], [123600, "auto", "sent", pc.id]);
  assert.equal(rzState.refunds.find((x) => x.id === r!.razorpayRefundId)!.receipt, r!.id); // our id goes as the receipt
  assert.ok(t.notices.some((x) => x.kind === "soldOutWhilePaying" && "userId" in x.to && x.to.userId === c.me.id));
  assert.equal((await bookingsOf(c)).length, 0);

  // Razorpay processes it: refunded, and they're told the amount.
  assert.equal(await hook("refund.processed", { refund: { entity: { ...rzState.refunds.find((x) => x.id === r!.razorpayRefundId)!, status: "processed" } } }), 200);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.id, r!.id)))[0]!.status, "processed");
  assert.equal((await paymentOf(oc.orderId)).status, "refunded");
  assert.ok(t.notices.some((x) => x.kind === "refundSent" && x.data?.amountPaise === 123600));
});

test("a duplicate webhook event is a no-op; a bad signature is refused and kept for Galaxy", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  const p = capture(o.orderId, o.amountPaise);
  assert.equal(await hook("payment.captured", { payment: { entity: p } }, { id: "evt_dup" }), 200);
  const before = await t.db.select().from(razorpayEvents).where(eq(razorpayEvents.id, "evt_dup"));
  assert.ok(before[0]!.handledAt);
  // Same id again, even with another payment in it: nothing runs.
  const other = capture(o.orderId, o.amountPaise);
  assert.equal(await hook("payment.captured", { payment: { entity: other } }, { id: "evt_dup" }), 200);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.razorpayPaymentId, other.id))).length, 0);
  assert.equal((await bookingsOf(b)).length, 1);

  const fails = (await t.db.select().from(failedWebhooks)).length;
  assert.equal(await hook("payment.captured", { payment: { entity: p } }, { sig: "00".repeat(32) }), 400);
  const kept = await t.db.select().from(failedWebhooks);
  assert.equal(kept.length, fails + 1);
  assert.equal(kept.at(-1)!.reason, "badSignature");
  assert.ok(!kept.at(-1)!.excerpt.includes("captured\",\"amount")); // ids only, never the body
});

test("a second payment on a settled order goes back whole; refund.processed before payment.captured breaks nothing", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  // A refund event for a refund we don't know yet: taken, left unhandled.
  const early = { id: "rfnd_unknown", payment_id: "pay_x", amount: 100, status: "processed" };
  assert.equal(await hook("refund.processed", { refund: { entity: early } }, { id: "evt_early" }), 200);
  assert.equal((await t.db.select().from(razorpayEvents).where(eq(razorpayEvents.id, "evt_early")))[0]!.handledAt, null);
  // An order we never made, too.
  assert.equal(await hook("payment.captured", { payment: { entity: { id: "pay_zz", order_id: "order_none", status: "captured", amount: 1 } } }), 200);

  const p1 = capture(o.orderId, o.amountPaise);
  assert.equal(await hook("payment.captured", { payment: { entity: p1 } }), 200);
  assert.equal((await paymentOf(o.orderId)).status, "paid");
  const p2 = capture(o.orderId, o.amountPaise);
  assert.equal(await hook("payment.captured", { payment: { entity: p2 } }), 200);
  assert.equal(await hook("payment.captured", { payment: { entity: p2 } }), 200);
  const twice = await t.db.select().from(refunds).where(eq(refunds.razorpayPaymentId, p2.id));
  assert.equal(twice.length, 1);
  assert.equal(twice[0]!.amountPaise, o.amountPaise);
  assert.equal((await paymentOf(o.orderId)).status, "paid"); // the first payment's ticket stands
  assert.ok(t.notices.some((x) => x.kind === "paidTwice"));
  // Razorpay processes the paid-twice refund: the ticket's payment stays paid, the booking stands, earnings don't move.
  const rf = rzState.refunds.find((x) => x.receipt === twice[0]!.id)!;
  assert.equal(await hook("refund.processed", { refund: { entity: { ...rf, status: "processed" } } }), 200);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.id, twice[0]!.id)))[0]!.status, "processed");
  const kept = await paymentOf(o.orderId);
  assert.equal(kept.status, "paid");
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.id, kept.bookingId!)))[0]!.status, "confirmed");
  const [earned] = await earningsOf(t.db, [e.id]);
  assert.deepEqual([earned!.refundedPaise, earned!.earningsPaise], [0, 120000 - 2400]);
  // payment.failed after paid moves nothing back.
  assert.equal(await hook("payment.failed", { payment: { entity: { ...p1, status: "failed" } } }), 200);
  assert.equal((await paymentOf(o.orderId)).status, "paid");
});

test("the poller settles captured orders, expires unpaid ones and retries failed refunds hourly", async () => {
  const a = await join(), b = await join(), c = await join(), d = await join();
  const e = await publish(a, { quantity: 1 });
  const ob = (await pay(b, e)).body, oc = (await pay(c, e)).body, od = (await pay(d, e)).body;
  capture(ob.orderId, ob.amountPaise);
  t.tick(6 * MIN);
  await pollPayments({ db: t.db, rz, notify: t.notify, now: t.now() });
  assert.equal((await paymentOf(ob.orderId)).status, "paid");
  assert.equal((await paymentOf(oc.orderId)).status, "created"); // nothing yet, and not 30 minutes old
  t.tick(25 * MIN);
  // Money on d's order after b took the last seat, while Razorpay is down for refunds.
  capture(od.orderId, od.amountPaise);
  rzState.refundFails = true;
  await pollPayments({ db: t.db, rz, notify: t.notify, now: t.now() });
  assert.equal((await paymentOf(oc.orderId)).status, "expired");
  assert.equal((await paymentOf(od.orderId)).status, "refundPending");
  const [r] = await t.db.select().from(refunds).where(eq(refunds.paymentId, (await paymentOf(od.orderId)).id));
  assert.equal(r!.status, "failed");
  assert.equal(r!.nextAttemptAt!.getTime(), t.now() + HOUR);
  rzState.refundFails = false;
  t.tick(30 * MIN);
  await pollPayments({ db: t.db, rz, notify: t.notify, now: t.now() });
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.id, r!.id)))[0]!.status, "failed"); // not due yet
  t.tick(31 * MIN);
  await pollPayments({ db: t.db, rz, notify: t.notify, now: t.now() });
  const sent = (await t.db.select().from(refunds).where(eq(refunds.id, r!.id)))[0]!;
  assert.equal(sent.status, "sent");
  assert.equal(rzState.refunds.filter((x) => x.receipt === r!.id).length, 1);
  // Polled again later, the sent one is asked about, never sent twice.
  t.tick(2 * HOUR);
  await pollPayments({ db: t.db, rz, notify: t.notify, now: t.now() });
  assert.equal(rzState.refunds.filter((x) => x.receipt === r!.id).length, 1);
});

test("Galaxy Money: only holders of Money; staff refunds up to what's left; payouts with UTRs; fees", async () => {
  const a = await join(), b = await join(), boss = await join(), people = await join();
  await give(boss, "money");
  await give(people, "people");
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  const id = (await paymentOf(o.orderId)).id;

  for (const path of ["/galaxy/money/payments", "/galaxy/money/refunds", "/galaxy/money/payouts", "/galaxy/money/fees", "/galaxy/money/failed-webhooks"])
    assert.equal((await as(people)("GET", path)).status, 404, path); // as every Galaxy route: not there for them
  assert.equal((await as(people)("POST", `/galaxy/money/payments/${id}/refund`, { amountPaise: 100, reason: "Asked" })).status, 404);

  const list = await as(boss)("GET", `/galaxy/money/payments?q=${o.orderId}`);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.payments[0].userName, "Riya Kapoor");
  const over = await as(boss)("POST", `/galaxy/money/payments/${id}/refund`, { amountPaise: o.amountPaise + 1, reason: "Too much" });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, "tooMuch");
  const part = await as(boss)("POST", `/galaxy/money/payments/${id}/refund`, { amountPaise: 20000, reason: "Seat was broken" });
  assert.equal(part.status, 201, JSON.stringify(part.body));
  assert.equal(part.body.status, "sent");
  assert.equal(part.body.kind, "staff");
  const detail = await as(boss)("GET", `/galaxy/money/payments/${id}`);
  assert.equal(detail.body.refundablePaise, o.amountPaise - 20000);
  assert.equal((await as(boss)("POST", `/galaxy/money/payments/${id}/refund`, { amountPaise: o.amountPaise - 19999, reason: "Again" })).status, 400);
  assert.ok((await t.db.select().from(auditLog).where(eq(auditLog.action, "money.refund"))).length >= 1);

  // Earnings: ₹1,200 less 2% (₹24, ₹4 handed back on ₹200 refunded), less ₹200 refunded = ₹980.
  const money = await as(boss)("GET", "/galaxy/money/payouts");
  const mine = money.body.earnings.find((x: { eventId: string }) => x.eventId === e.id);
  assert.deepEqual([mine.salesPaise, mine.commissionPaise, mine.refundedPaise, mine.earningsPaise, mine.availablePaise], [120000, 2000, 20000, 98000, 98000]);
  assert.equal((await as(boss)("POST", "/galaxy/money/payouts", { eventId: e.id, amountPaise: 98001, reason: "Payout" })).status, 400);
  const po = await as(boss)("POST", "/galaxy/money/payouts", { eventId: e.id, amountPaise: 98000, reason: "Payout" });
  assert.equal(po.status, 201);
  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${po.body.id}/paid`, { utr: "123" })).status, 400);
  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${po.body.id}/paid`, { utr: "hdfcn52026112600001" })).status, 200);
  assert.equal((await as(boss)("GET", "/galaxy/money/payouts")).body.payouts.find((x: { id: string }) => x.id === po.body.id).utr, "HDFCN52026112600001");
  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${po.body.id}/cancel`, { reason: "Oops" })).status, 409);
  const po2 = await as(boss)("POST", "/galaxy/money/payouts", { eventId: e.id, amountPaise: 1, reason: "More" });
  assert.equal(po2.status, 400); // nothing left
  const after = (await as(boss)("GET", "/galaxy/money/payouts")).body.earnings.find((x: { eventId: string }) => x.eventId === e.id);
  assert.deepEqual([after.paidOutPaise, after.availablePaise], [98000, 0]);

  const fees = await as(boss)("PUT", `/galaxy/money/fees/${e.hostId}`, { plan: "5+0", feeIncluded: false, reason: "Host asked" });
  assert.equal(fees.status, 200);
  const c = await join();
  assert.equal((await pay(c, e)).body.breakdown.feePaise, 6000);
  const listed = (await as(boss)("GET", "/galaxy/money/fees")).body.hosts.find((h: { id: string }) => h.id === e.hostId);
  assert.deepEqual([listed.plan, listed.feeIncluded], ["5+0", false]);
  assert.ok(Array.isArray((await as(boss)("GET", "/galaxy/money/failed-webhooks")).body));
});

test("a refund is sent once when two senders race for it", async () => {
  const a = await join(), b = await join(), boss = await join();
  await give(boss, "money");
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  const p = capture(o.orderId, o.amountPaise);
  await verify(b, o.orderId, p.id);
  const pay1 = await paymentOf(o.orderId);
  const [r] = await t.db
    .insert(refunds)
    .values({ paymentId: pay1.id, razorpayPaymentId: p.id, amountPaise: 500, reason: "Test", kind: "staff", nextAttemptAt: new Date(t.now()), createdAt: new Date(t.now()), updatedAt: new Date(t.now()) })
    .returning();
  const before = rzState.calls.filter((x) => x === `POST /payments/${p.id}/refund`).length;
  await Promise.all([sendRefund(t.db, rz, t.notify, r!.id, t.now()), sendRefund(t.db, rz, t.notify, r!.id, t.now()), pollPayments({ db: t.db, rz, notify: t.notify, now: t.now() })]);
  assert.equal(rzState.calls.filter((x) => x === `POST /payments/${p.id}/refund`).length - before, 1);
  // A Galaxy retry of a refund that isn't failed is refused, so it can't send again either.
  assert.equal((await as(boss)("POST", `/galaxy/money/refunds/${r!.id}/retry`, { reason: "Again please" })).status, 409);
});

test("cancelling an event refunds its paid tickets in full; earnings go to 0", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  assert.equal((await as(a)("POST", `/events/${e.id}/cancel`, { reason: "Venue flooded" })).status, 200);
  const p = await paymentOf(o.orderId);
  assert.equal(p.status, "refundPending");
  const [r] = await t.db.select().from(refunds).where(eq(refunds.paymentId, p.id));
  assert.deepEqual([r!.amountPaise, r!.kind, r!.status], [o.amountPaise, "auto", "sent"]);
  const [earned] = await earningsOf(t.db, [e.id]);
  assert.deepEqual([earned!.refundedPaise, earned!.commissionPaise, earned!.earningsPaise], [120000, 0, 0]);
});

test("pay again for other seats: the old order expires and a new one is made", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const one = (await pay(b, e, 1)).body;
  const two = await pay(b, e, 2);
  assert.equal(two.status, 201);
  assert.notEqual(two.body.orderId, one.orderId);
  assert.equal((await paymentOf(one.orderId)).status, "expired");
  // Money on the old order after all: it still settles, for its own one seat.
  const late = capture(one.orderId, one.amountPaise);
  assert.equal(await hook("payment.captured", { payment: { entity: late } }), 200);
  assert.equal((await paymentOf(one.orderId)).status, "paid");
});

test("verify gives no ticket until Razorpay says captured, on this order, in full", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  const auth = capture(o.orderId, o.amountPaise, "authorized");
  assert.deepEqual((await verify(b, o.orderId, auth.id)).body, { status: "confirming", bookingId: null });
  const short = capture(o.orderId, o.amountPaise - 1);
  assert.equal((await verify(b, o.orderId, short.id)).body.status, "confirming");
  assert.equal((await bookingsOf(b)).length, 0);
  assert.equal((await paymentOf(o.orderId)).status, "created");
});

test("the poller settles late money on a failed order, and clears old refused webhooks", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  assert.equal(await hook("payment.failed", { payment: { entity: { id: "pay_f", order_id: o.orderId, status: "failed", amount: o.amountPaise } } }), 200);
  assert.equal((await paymentOf(o.orderId)).status, "failed");
  capture(o.orderId, o.amountPaise);
  await t.db.insert(failedWebhooks).values({ receivedAt: new Date(t.now() - 31 * DAY), reason: "old", excerpt: "x" });
  t.tick(HOUR);
  await pollPayments({ db: t.db, rz, notify: t.notify, now: t.now() });
  assert.equal((await paymentOf(o.orderId)).status, "paid");
  assert.equal((await t.db.select().from(failedWebhooks).where(eq(failedWebhooks.reason, "old"))).length, 0);
});

test("a ticket type someone has paid for (or started to) can't be removed", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const extra = (await as(a)("POST", `/events/${e.id}/tickets`, { name: "VIP", pricePaise: 300000 })).body as { id: string };
  assert.equal((await pay(b, { ...e, tier: extra.id })).status, 201);
  const r = await as(a)("DELETE", `/events/${e.id}/tickets/${extra.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "hasBookings");
});
