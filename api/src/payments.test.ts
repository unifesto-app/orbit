import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { runDeletions } from "./auth/deletion.ts";
import { testApp } from "./testkit.ts";
import { auditLog, bookings, events, failedWebhooks, hosts, payoutAccounts, payments, payouts, razorpayEvents, refunds, staffGrants, stationClaims, stations, teamRoles, users } from "./db/schema.ts";
import { galaxyEventsRoutes } from "./events/galaxy.ts";
import { earningsOf, moneyRoutes, venueEarningsOf } from "./payments/galaxy.ts";
import { paymentsRoutes, pollPayments, sendRefund } from "./payments/routes.ts";
import { razorpay, type RzPayment, type RzRefund } from "./payments/razorpay.ts";

// Paying (Money flow; X2): orders, verify, webhook, settle, the poller, and Galaxy's Money routes. Razorpay is a fake
// fetch below: no test reaches the network.

const KEY = { keyId: "rzp_test_abc", keySecret: "key-secret-for-tests", webhookSecret: "hook-secret-for-tests" };
const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

// Razorpay as these tests need it: orders, payments captured on them, refunds (pending until a test processes them).
const rzState = { orders: 0, refunds: [] as RzRefund[], captured: new Map<string, RzPayment[]>(), refundFails: false, ordersDown: false, calls: [] as string[] };
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const path = new URL(String(url)).pathname.replace(/^\/v1/, "");
  const method = init?.method ?? "GET";
  rzState.calls.push(`${method} ${path}`);
  assert.equal((init?.headers as Record<string, string>).authorization, `Basic ${Buffer.from(`${KEY.keyId}:${KEY.keySecret}`).toString("base64")}`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (method === "POST" && path === "/orders") {
    assert.equal(body.payment_capture, 1);
    return json({ id: `order_${++rzState.orders}`, amount: body.amount, receipt: body.receipt });
  }
  let m = path.match(/^\/orders\/([^/]+)\/payments$/);
  if (m && rzState.ordersDown) return json({ error: { code: "SERVER_ERROR" } }, 500);
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
const give = (u: P, feature: "money" | "people" | "hosts") =>
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
// A payout account straight in the table, in `state`.
const account = (hostId: string, state: "checking" | "verified" | "rejected" = "verified") =>
  t.db.insert(payoutAccounts).values({ hostId, kind: "bank", holder: "Riya Kapoor", accountNumber: "123456789012", ifsc: "HDFC0001234", bankName: "HDFC Bank", last4: "9012", state, createdAt: new Date(t.now()), updatedAt: new Date(t.now()) });
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

test("a Galaxy cancel without Razorpay still answers; the refund waits, requested, for the poller", async () => {
  const a = await join(), b = await join(), s = await join();
  await give(s, "hosts");
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  const app = galaxyEventsRoutes({ db: t.db, secret: t.secret, notify: t.notify, now: t.now });
  const res = await app.request(`/galaxy/events/${e.id}/cancel`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.access}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Venue flooded" }),
  });
  assert.equal(res.status, 200);
  const p = await paymentOf(o.orderId);
  assert.equal(p.status, "refundPending");
  const [r] = await t.db.select().from(refunds).where(eq(refunds.paymentId, p.id));
  assert.deepEqual([r!.amountPaise, r!.status], [o.amountPaise, "requested"]);
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
  // The app hears why, from verify or from the order's status: fewLeft is sold out.
  assert.deepEqual((await verify(c, oc.orderId, pc.id)).body, { status: "refundPending", bookingId: null, reason: "fewLeft" });
  assert.equal((await as(c)("GET", `/payments/${oc.orderId}`)).body.reason, "fewLeft");

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
  const [earned] = await earningsOf(t.db, { eventIds: [e.id] }, new Date(t.now()));
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
  // Paid only to a verified account, staff-made payouts too.
  const none = await as(boss)("POST", `/galaxy/money/payouts/${po.body.id}/paid`, { utr: "hdfcn52026112600001" });
  assert.deepEqual([none.status, none.body.error], [409, "accountNotVerified"]);
  await account(e.hostId, "checking");
  assert.equal((await as(boss)("GET", "/galaxy/money/payouts")).body.accounts[e.hostId], "checking");
  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${po.body.id}/paid`, { utr: "hdfcn52026112600001" })).body.error, "accountNotVerified");
  await t.db.update(payoutAccounts).set({ state: "verified" }).where(eq(payoutAccounts.hostId, e.hostId));
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
  // The refund goes after the answer.
  for (let i = 0; i < 100 && (await t.db.select().from(refunds).where(eq(refunds.paymentId, p.id)))[0]?.status !== "sent"; i++) await new Promise((r) => setTimeout(r, 10));
  const [r] = await t.db.select().from(refunds).where(eq(refunds.paymentId, p.id));
  assert.deepEqual([r!.amountPaise, r!.kind, r!.status], [o.amountPaise, "auto", "sent"]);
  const [earned] = await earningsOf(t.db, { eventIds: [e.id] }, new Date(t.now()));
  assert.deepEqual([earned!.refundedPaise, earned!.commissionPaise, earned!.earningsPaise], [120000, 0, 0]);

  // Staff cancelling from Galaxy's Events refunds the same way.
  const s = await join();
  await give(s, "hosts");
  const e2 = await publish(a);
  const o2 = (await pay(b, e2)).body;
  await verify(b, o2.orderId, capture(o2.orderId, o2.amountPaise).id);
  assert.equal((await as(s)("POST", `/galaxy/events/${e2.id}/cancel`, { reason: "Venue flooded" })).status, 200);
  const p2 = await paymentOf(o2.orderId);
  assert.equal(p2.status, "refundPending");
  for (let i = 0; i < 100 && (await t.db.select().from(refunds).where(eq(refunds.paymentId, p2.id)))[0]?.status !== "sent"; i++) await new Promise((r) => setTimeout(r, 10));
  const [r2] = await t.db.select().from(refunds).where(eq(refunds.paymentId, p2.id));
  assert.deepEqual([r2!.amountPaise, r2!.kind, r2!.status], [o2.amountPaise, "auto", "sent"]);
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

// A paid ticket for `u` on a new event of `host`'s, confirmed through verify.
const bought = async (host: P, u: P) => {
  const e = await publish(host);
  const o = (await pay(u, e)).body;
  const p = capture(o.orderId, o.amountPaise);
  assert.equal((await verify(u, o.orderId, p.id)).body.status, "paid");
  return { e, o, p };
};
const posts = (paymentId: string) => rzState.calls.filter((x) => x === `POST /payments/${paymentId}/refund`).length;

test("Razorpay fails a refund, then a Galaxy retry sends a new one; a stale refund.failed is ignored", async () => {
  const a = await join(), b = await join(), boss = await join();
  await give(boss, "money");
  const { o, p } = await bought(a, b);
  const id = (await paymentOf(o.orderId)).id;
  const made = await as(boss)("POST", `/galaxy/money/payments/${id}/refund`, { amountPaise: 500, reason: "Seat was broken" });
  assert.equal(made.body.status, "sent");
  const first = rzState.refunds.find((x) => x.receipt === made.body.id)!;
  first.status = "failed";
  assert.equal(await hook("refund.failed", { refund: { entity: first } }), 200);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.id, made.body.id)))[0]!.status, "failed");
  assert.equal((await as(boss)("POST", `/galaxy/money/refunds/${made.body.id}/retry`, { reason: "Razorpay was down" })).status, 200);
  assert.equal(posts(p.id), 2);
  const row = (await t.db.select().from(refunds).where(eq(refunds.id, made.body.id)))[0]!;
  assert.equal(row.status, "sent");
  assert.notEqual(row.razorpayRefundId, first.id);
  // The first one's failure again (a resend from Razorpay, under a new event id): the new refund stays sent.
  assert.equal(await hook("refund.failed", { refund: { entity: first } }), 200);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.id, made.body.id)))[0]!.status, "sent");
});

test("account deletion refunds an upcoming paid ticket, not one for an event under way", async () => {
  const a = await join(), b = await join();
  const soon = await bought(a, b);
  const now = await bought(a, b);
  // The second event started an hour ago and runs another hour.
  await t.db.update(events).set({ startsAt: new Date(t.now() - HOUR), endsAt: new Date(t.now() + HOUR) }).where(eq(events.id, now.e.id));
  await t.db.update(users).set({ deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, b.me.id));
  assert.equal(await runDeletions(t.db, t.notify, t.now()), 1);
  const ps = await paymentOf(soon.o.orderId), pn = await paymentOf(now.o.orderId);
  assert.equal(ps.status, "refundPending");
  const [r] = await t.db.select().from(refunds).where(eq(refunds.paymentId, ps.id));
  assert.deepEqual([r!.amountPaise, r!.status], [soon.o.amountPaise, "requested"]);
  assert.equal(pn.status, "paid");
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.paymentId, pn.id))).length, 0);
  // The poller sends it once its first 15 minutes are up.
  t.tick(16 * MIN);
  await pollPayments({ db: t.db, rz, notify: t.notify, now: t.now() });
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.id, r!.id)))[0]!.status, "sent");
});

test("pressing Galaxy's retry twice sends one refund", async () => {
  const a = await join(), b = await join(), boss = await join();
  await give(boss, "money");
  const { o, p } = await bought(a, b);
  const id = (await paymentOf(o.orderId)).id;
  rzState.refundFails = true; // the first send fails, as Razorpay being down
  const made = await as(boss)("POST", `/galaxy/money/payments/${id}/refund`, { amountPaise: 700, reason: "Seat was broken" });
  rzState.refundFails = false;
  assert.equal(made.body.status, "failed");
  const before = posts(p.id);
  // Press one's send is still holding the refund (its claim, as if Razorpay were slow), when press two lands.
  await t.db.update(refunds).set({ nextAttemptAt: new Date(t.now() + 5 * MIN) }).where(eq(refunds.id, made.body.id));
  assert.equal((await as(boss)("POST", `/galaxy/money/refunds/${made.body.id}/retry`, { reason: "Again" })).status, 409);
  // Two presses at once once nothing holds it: both may pass the retry, but sendRefund's claim lets one send.
  await t.db.update(refunds).set({ nextAttemptAt: null }).where(eq(refunds.id, made.body.id));
  const both = await Promise.all([
    as(boss)("POST", `/galaxy/money/refunds/${made.body.id}/retry`, { reason: "Again" }),
    as(boss)("POST", `/galaxy/money/refunds/${made.body.id}/retry`, { reason: "Again" }),
  ]);
  assert.ok(both.every((x) => x.status === 200 || x.status === 409));
  assert.equal(posts(p.id) - before, 1);
  // A press after it went: 409, and still one.
  assert.equal((await as(boss)("POST", `/galaxy/money/refunds/${made.body.id}/retry`, { reason: "Again" })).status, 409);
  assert.equal(posts(p.id) - before, 1);
});

// ---------- X3: the app's own reads, Galaxy's Bookings and tickets ----------

const until = async (ok: () => Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 10));
};

test("/me/payments and /me/refunds: only the signed-in person's, only payments that took money", async () => {
  const a = await join(), b = await join(), c = await join(), boss = await join();
  await give(boss, "money");
  const { e, o } = await bought(a, b);
  await pay(c, e); // c only opened an order: not a transaction
  const id = (await paymentOf(o.orderId)).id;
  const r = await as(boss)("POST", `/galaxy/money/payments/${id}/refund`, { amountPaise: 500, reason: "Seat was broken" });
  const rf = rzState.refunds.find((x) => x.receipt === r.body.id)!;
  assert.equal(await hook("refund.processed", { refund: { entity: { ...rf, status: "processed" } } }), 200);

  const mine = await as(b)("GET", "/me/payments");
  assert.equal(mine.status, 200);
  assert.equal(mine.body.length, 1);
  assert.deepEqual(
    [mine.body[0].id, mine.body[0].eventTitle, mine.body[0].pricePaise, mine.body[0].feePaise, mine.body[0].amountPaise, mine.body[0].status, mine.body[0].refundedPaise],
    [id, "Open Mic Night", 120000, 3600, 123600, "paid", 500],
  );
  assert.ok(mine.body[0].refundedAt);
  const back = await as(b)("GET", "/me/refunds");
  assert.deepEqual(back.body.map((x: { id: string; amountPaise: number; status: string }) => [x.id, x.amountPaise, x.status]), [[r.body.id, 500, "processed"]]);
  // Nobody else sees them.
  assert.deepEqual((await as(c)("GET", "/me/payments")).body, []);
  assert.deepEqual((await as(c)("GET", "/me/refunds")).body, []);
  assert.equal((await t.call("GET", "/me/payments")).status, 401);
  assert.equal((await t.call("GET", "/me/refunds")).status, 401);
});

test("Galaxy Bookings: find by person or event; cancel a paid one makes one full refund; non-staff refused", async () => {
  const a = await join(), b = await join(), boss = await join(), people = await join(), till = await join();
  await give(boss, "money");
  await give(boss, "people");
  await give(people, "people");
  await give(till, "money");
  const { e, o, p } = await bought(a, b);
  const booking = (await paymentOf(o.orderId)).bookingId!;

  assert.equal((await as(people)("GET", `/galaxy/bookings?event=${e.id}`)).status, 404);
  assert.equal((await as(b)("POST", `/galaxy/bookings/${booking}/cancel`, { reason: "Mine" })).status, 404);
  assert.equal((await as(boss)("GET", "/galaxy/bookings")).status, 400);

  // By person needs People too; by event, Money is enough. Staff never see the entry code.
  assert.equal((await as(till)("GET", `/galaxy/bookings?person=${b.p}`)).status, 403);
  assert.equal((await as(till)("GET", `/galaxy/bookings?event=${e.id}`)).status, 200);
  const byPhone = await as(boss)("GET", `/galaxy/bookings?person=${b.p}`);
  assert.equal(byPhone.body[0].code, undefined);
  assert.equal(byPhone.status, 200);
  assert.deepEqual(byPhone.body.map((x: { id: string }) => x.id), [booking]);
  assert.deepEqual(byPhone.body[0].payment, { id: (await paymentOf(o.orderId)).id, status: "paid", amountPaise: o.amountPaise });
  assert.equal(byPhone.body[0].ticketTypeName, "General");
  const byEvent = await as(boss)("GET", `/galaxy/bookings?event=${e.id}`);
  assert.deepEqual(byEvent.body.map((x: { id: string }) => x.id), [booking]);
  assert.ok((await t.db.select().from(auditLog).where(eq(auditLog.action, "bookings.search"))).length >= 2);

  const before = posts(p.id);
  const x = await as(boss)("POST", `/galaxy/bookings/${booking}/cancel`, { reason: "Host asked us" });
  assert.equal(x.status, 200, JSON.stringify(x.body));
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.id, booking)))[0]!.status, "cancelled");
  const pay1 = await paymentOf(o.orderId);
  assert.equal(pay1.status, "refundPending");
  await until(async () => (await t.db.select().from(refunds).where(eq(refunds.paymentId, pay1.id)))[0]?.status === "sent");
  const rs = await t.db.select().from(refunds).where(eq(refunds.paymentId, pay1.id));
  assert.deepEqual(rs.map((r) => [r.amountPaise, r.status]), [[o.amountPaise, "sent"]]);
  assert.equal(posts(p.id) - before, 1);
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.action, "bookings.cancel"))).length, 1);
  // Again: already cancelled, no second refund.
  assert.equal((await as(boss)("POST", `/galaxy/bookings/${booking}/cancel`, { reason: "Again" })).status, 409);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.paymentId, pay1.id))).length, 1);

  // A free booking: cancelled, nothing refunded.
  const free = await publish(a, { pricePaise: 0 });
  const tk = await as(b)("POST", `/events/${free.id}/book`, { ticketTypeId: free.tier, quantity: 1 });
  assert.equal(tk.status, 201);
  const f = await as(boss)("POST", `/galaxy/bookings/${tk.body.id}/cancel`, { reason: "Duplicate" });
  assert.deepEqual(f.body, { ok: true, refunded: false });
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.id, tk.body.id)))[0]!.status, "cancelled");
});

test("a full staff refund cancels the booking; a part one keeps it", async () => {
  const a = await join(), b = await join(), boss = await join();
  await give(boss, "money");
  const { o } = await bought(a, b);
  const p = await paymentOf(o.orderId);
  assert.equal((await as(boss)("POST", `/galaxy/money/payments/${p.id}/refund`, { amountPaise: 1000, reason: "Part" })).status, 201);
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.id, p.bookingId!)))[0]!.status, "confirmed");
  assert.equal((await as(boss)("POST", `/galaxy/money/payments/${p.id}/refund`, { amountPaise: o.amountPaise - 1000, reason: "The rest" })).status, 201);
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.id, p.bookingId!)))[0]!.status, "cancelled");
  assert.equal((await paymentOf(o.orderId)).status, "refundPending");
});

test("/me/payments: a paid-twice refund isn't counted as this ticket's refund", async () => {
  const a = await join(), b = await join();
  const { o } = await bought(a, b);
  const p2 = capture(o.orderId, o.amountPaise);
  assert.equal(await hook("payment.captured", { payment: { entity: p2 } }), 200);
  const [twice] = await t.db.select().from(refunds).where(eq(refunds.razorpayPaymentId, p2.id));
  const rf = rzState.refunds.find((x) => x.receipt === twice!.id)!;
  assert.equal(await hook("refund.processed", { refund: { entity: { ...rf, status: "processed" } } }), 200);
  const mine = (await as(b)("GET", "/me/payments")).body;
  assert.deepEqual([mine.length, mine[0].status, mine[0].refundedPaise, mine[0].refundedAt], [1, "paid", 0, null]);
});

test("GET /payments/:orderId: the payer's own order only; asks Razorpay and settles captured money", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  assert.equal((await as(a)("GET", `/payments/${o.orderId}`)).status, 404);
  assert.equal((await t.call("GET", `/payments/${o.orderId}`)).status, 401);
  // Checkout closed with nothing tried: still created.
  assert.deepEqual((await as(b)("GET", `/payments/${o.orderId}`)).body, { status: "created", bookingId: null });
  // Authorized, not captured yet: confirming.
  const auth = capture(o.orderId, o.amountPaise, "authorized");
  assert.equal((await as(b)("GET", `/payments/${o.orderId}`)).body.status, "confirming");
  // Captured: settled here, the ticket given.
  rzState.captured.set(o.orderId, [{ ...auth, status: "captured" }]);
  const got = (await as(b)("GET", `/payments/${o.orderId}`)).body;
  assert.equal(got.status, "paid");
  assert.equal(got.bookingId, (await paymentOf(o.orderId)).bookingId);
  assert.equal((await bookingsOf(b)).length, 1);
  assert.deepEqual((await as(b)("GET", `/payments/${o.orderId}`)).body, { status: "paid", bookingId: got.bookingId });
});

test("Galaxy cancel: after a part refund only what's left goes back; unknown is 404; a host-cancelled one 409", async () => {
  const a = await join(), b = await join(), boss = await join();
  await give(boss, "money");
  const { o } = await bought(a, b);
  const pay1 = await paymentOf(o.orderId);
  assert.equal((await as(boss)("POST", `/galaxy/money/payments/${pay1.id}/refund`, { amountPaise: 1000, reason: "Part" })).status, 201);
  assert.equal((await as(boss)("POST", `/galaxy/bookings/${pay1.bookingId}/cancel`, { reason: "Host asked us" })).status, 200);
  const rs = await t.db.select().from(refunds).where(eq(refunds.paymentId, pay1.id));
  assert.deepEqual(rs.map((r) => r.amountPaise).sort((x, y) => x - y), [1000, o.amountPaise - 1000]);
  assert.equal((await paymentOf(o.orderId)).status, "refundPending");

  assert.equal((await as(boss)("POST", `/galaxy/bookings/${crypto.randomUUID()}/cancel`, { reason: "Nobody" })).status, 404);
  const other = await bought(a, b);
  const bk = (await paymentOf(other.o.orderId)).bookingId!;
  await t.db.update(bookings).set({ status: "cancelledByHost" }).where(eq(bookings.id, bk));
  assert.equal((await as(boss)("POST", `/galaxy/bookings/${bk}/cancel`, { reason: "Again" })).status, 409);
});

test("Galaxy cancel with Razorpay off: a paid booking is refused, a free one still goes", async () => {
  const a = await join(), b = await join(), boss = await join();
  await give(boss, "money");
  const { o } = await bought(a, b);
  const paid = (await paymentOf(o.orderId)).bookingId!;
  const free = await publish(a, { pricePaise: 0 });
  const tk = (await as(b)("POST", `/events/${free.id}/book`, { ticketTypeId: free.tier, quantity: 1 })).body;
  const offApp = moneyRoutes({ db: t.db, secret: t.secret, notify: t.notify, now: t.now } as never);
  const cancel = async (id: string) => {
    const res = await offApp.request(`/galaxy/bookings/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${boss.access}` },
      body: JSON.stringify({ reason: "Razorpay is off" }),
    });
    return { status: res.status, body: (await res.json()) as { error?: string } };
  };
  const r = await cancel(paid);
  assert.deepEqual([r.status, r.body.error], [503, "paymentsOff"]);
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.id, paid)))[0]!.status, "confirmed");
  assert.equal((await cancel(tk.id)).status, 200);
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.id, tk.id)))[0]!.status, "cancelled");
});

test("GET /payments/:orderId: Razorpay down is a 502; open attempts are pending; late money on an expired order settles; a day on, the DB answers; 10 a minute", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  const status = () => as(b)("GET", `/payments/${o.orderId}`);
  rzState.ordersDown = true;
  const down = await status();
  rzState.ordersDown = false;
  assert.deepEqual([down.status, down.body.error], [502, "paymentsDown"]);
  // A UPI request sent, not answered: Razorpay's attempt is still created.
  const open = capture(o.orderId, o.amountPaise, "created");
  assert.deepEqual((await status()).body, { status: "pending", bookingId: null });
  // A failed one beside it: nothing was taken.
  capture(o.orderId, o.amountPaise, "failed");
  assert.equal((await status()).body.status, "created");
  // The order expired, then the money landed late: a seat.
  await t.db.update(payments).set({ status: "expired" }).where(eq(payments.razorpayOrderId, o.orderId));
  rzState.captured.set(o.orderId, [{ ...open, status: "captured" }]);
  const late = await status();
  assert.equal(late.body.status, "paid");
  assert.equal((await bookingsOf(b)).length, 1);

  // An open order over a day old: no call to Razorpay.
  const c = await join();
  const oc = (await pay(c, e)).body;
  t.tick(25 * HOUR);
  const before = rzState.calls.length;
  assert.deepEqual((await as(c)("GET", `/payments/${oc.orderId}`)).body, { status: "created", bookingId: null });
  assert.equal(rzState.calls.length, before);
  // Ten a minute each.
  for (let i = 0; i < 9; i++) assert.equal((await as(c)("GET", `/payments/${oc.orderId}`)).status, 200);
  assert.equal((await as(c)("GET", `/payments/${oc.orderId}`)).status, 429);
  t.tick(MIN);
  assert.equal((await as(c)("GET", `/payments/${oc.orderId}`)).status, 200);
});

// ---------- Paying for a held slot (X8): POST /venues/:hostId/holds/:claimId/pay, settled through confirmHold ----------

// A venue open 11 AM to 2 AM with one priced PC (₹500 an hour), the clock at the next 6:20 PM India time, and a held
// hour at 7 PM. People join after the tick: access tokens last 15 minutes.
const IST = 330 * MIN;
const heldSlot = async () => {
  t.tick(((66_000_000 - ((t.now() + IST) % DAY)) + DAY) % DAY);
  const start = t.now() + 40 * MIN; // 7 PM
  const a = await join(), b = await join();
  const h = (await as(a)("POST", "/hosts", { name: `Slot Club ${++hn}`, kind: "venue", city: "Hyderabad" })).body.id as string;
  const week = Array(7).fill([11, 26]);
  assert.equal((await as(a)("PUT", `/venues/${h}`, { address: "1 Road", area: "Madhapur", lat: 17.4, lng: 78.4, deskPhone: "+914012345678", week })).status, 201);
  const s = await as(a)("POST", `/venues/${h}/stations`, { name: "Gaming PC", unit: "PC", count: 1, pricePaise: 50000, tile: "gaming" });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const hold = await as(b)("POST", `/venues/${h}/holds`, { stationId: s.body.id, start: new Date(start).toISOString(), hours: 1, count: 1 });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  return { a, b, h, stationId: s.body.id as string, claimId: hold.body.id as string, start };
};
const payHold = (u: P, h: string, claimId: string) => as(u)("POST", `/venues/${h}/holds/${claimId}/pay`);
const claimOf = async (id: string) => (await t.db.select().from(stationClaims).where(eq(stationClaims.id, id)))[0]!;

test("slot pay: the server's amount, the same order on a second tap; paid → booked, the team told, the code on confirm", async () => {
  const { b, h, claimId } = await heldSlot();
  // Not paid yet: the free confirm asks for money.
  assert.equal((await as(b)("POST", `/venues/${h}/holds/${claimId}/confirm`)).status, 402);
  const o = await payHold(b, h, claimId);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(o.body.breakdown.pricePaise, 50000);
  assert.equal(o.body.amountPaise, o.body.breakdown.amountPaise);
  assert.equal(o.body.already, false);
  const again = await payHold(b, h, claimId);
  assert.deepEqual([again.status, again.body.orderId, again.body.already], [200, o.body.orderId, true]);
  const notices = t.notices.length;
  const p = capture(o.body.orderId, o.body.amountPaise);
  const v = await verify(b, o.body.orderId, p.id);
  assert.deepEqual([v.status, v.body.status], [200, "paid"]);
  const c = await claimOf(claimId);
  assert.equal(c.status, "paid");
  assert.ok(c.code);
  assert.equal((await paymentOf(o.body.orderId)).status, "paid");
  assert.equal(t.notices.slice(notices).filter((x) => x.kind === "slotBooked").length, 1);
  const done = await as(b)("POST", `/venues/${h}/holds/${claimId}/confirm`);
  assert.deepEqual([done.status, done.body.code], [200, c.code]);
  // Booked: no second order.
  assert.deepEqual([(await payHold(b, h, claimId)).status], [409]);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.paymentId, (await paymentOf(o.body.orderId)).id))).length, 0);
});

test("slot pay: money after the hold lapsed and the station was taken, or after the start: refunded in full, said why", async () => {
  // Taken: the hold ran out, someone else booked the one PC for that hour, then the money landed.
  const x = await heldSlot();
  const o = (await payHold(x.b, x.h, x.claimId)).body;
  t.tick(11 * MIN);
  await t.db.insert(stationClaims).values({ stationId: x.stationId, kind: "booking", status: "paid", count: 1, startsAt: new Date(x.start), endsAt: new Date(x.start + HOUR), userId: x.a.me.id });
  const notices = t.notices.length;
  const p = capture(o.orderId, o.amountPaise);
  const v = await verify(x.b, o.orderId, p.id);
  assert.deepEqual([v.status, v.body.status, v.body.reason], [200, "refundPending", "full"]);
  assert.equal((await claimOf(x.claimId)).status, "held");
  const row = await paymentOf(o.orderId);
  assert.equal(row.status, "refundPending");
  const back = await t.db.select().from(refunds).where(eq(refunds.paymentId, row.id));
  assert.deepEqual(back.map((r) => r.amountPaise), [o.amountPaise]); // in full, fee too
  assert.ok(rzState.refunds.some((r) => r.payment_id === p.id && r.amount === o.amountPaise)); // sent after commit
  const told = t.notices.slice(notices);
  assert.ok(told.some((n) => n.kind === "soldOutWhilePaying" && "userId" in n.to && n.to.userId === x.b.me.id));
  assert.ok(!told.some((n) => n.kind === "slotBooked"));

  // Lapsed past its start: the webhook brings it, the same refund.
  const y = await heldSlot();
  const oy = (await payHold(y.b, y.h, y.claimId)).body;
  t.tick(41 * MIN);
  const py = capture(oy.orderId, oy.amountPaise);
  assert.equal(await hook("payment.captured", { payment: { entity: py } }), 200);
  const ry = await paymentOf(oy.orderId);
  assert.equal(ry.status, "refundPending");
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.paymentId, ry.id))).length, 1);
  assert.equal((await claimOf(y.claimId)).status, "held");
  // A lapsed hold gets no new order.
  assert.equal((await payHold(y.b, y.h, y.claimId)).status, 409);
});

test("slot pay: notFound for a made-up claim or someone else's hold", async () => {
  const { a, b, h, claimId } = await heldSlot();
  assert.equal((await payHold(b, h, "00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await payHold(a, h, claimId)).status, 404); // the venue's own admin can't pay a player's hold
  assert.equal((await payHold(b, "00000000-0000-4000-8000-000000000000", claimId)).status, 404);
});

test("slot pay: a webhook that arrives twice books once, refunds nothing", async () => {
  const { b, h, claimId } = await heldSlot();
  const o = (await payHold(b, h, claimId)).body;
  const p = capture(o.orderId, o.amountPaise);
  const notices = t.notices.length;
  assert.equal(await hook("payment.captured", { payment: { entity: p } }, { id: "evt_slot_dup" }), 200);
  const code = (await claimOf(claimId)).code;
  assert.ok(code);
  assert.equal(await hook("payment.captured", { payment: { entity: p } }, { id: "evt_slot_dup" }), 200);
  // A second event id for the same payment: settled already, nothing more.
  assert.equal(await hook("payment.captured", { payment: { entity: p } }), 200);
  assert.equal((await claimOf(claimId)).code, code);
  assert.equal(t.notices.slice(notices).filter((x) => x.kind === "slotBooked").length, 1);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.paymentId, (await paymentOf(o.orderId)).id))).length, 0);
});

test("slot pay: a paused place or an archived station takes no order", async () => {
  const one = await heldSlot();
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, one.h));
  const r = await payHold(one.b, one.h, one.claimId);
  assert.deepEqual([r.status, r.body.error], [409, "hostClosed"]);
  const two = await heldSlot();
  await t.db.update(stations).set({ archivedAt: new Date(t.now()) }).where(eq(stations.id, two.stationId));
  assert.equal((await payHold(two.b, two.h, two.claimId)).body.error, "hostClosed");
  assert.equal((await t.db.select().from(payments).where(eq(payments.claimId, two.claimId))).length, 0);
});

test("slot pay: deleting the account refunds an upcoming paid slot in full", async () => {
  const { b, h, claimId } = await heldSlot();
  const o = (await payHold(b, h, claimId)).body;
  assert.equal((await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id)).body.status, "paid");
  await t.db.update(users).set({ deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, b.me.id));
  assert.equal(await runDeletions(t.db, t.notify, t.now()), 1);
  const p = await paymentOf(o.orderId);
  assert.equal(p.status, "refundPending");
  const [r] = await t.db.select().from(refunds).where(eq(refunds.paymentId, p.id));
  assert.deepEqual([r!.amountPaise, r!.status], [o.amountPaise, "requested"]);
});

// ---------- A host's own money (X4): GET /hosts/:id/money, POST /hosts/:id/payouts, the payout account ----------

const audits = async (action: string) => JSON.stringify(await t.db.select().from(auditLog).where(eq(auditLog.action, action)));

test("host money: Admins only; the account masked and never logged; an ask waits 3 days, a verified account and what's there", async () => {
  const a = await join(), b = await join(), boss = await join();
  await give(boss, "money");
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  const h = e.hostId;

  // Not an Admin of this host: the same 404 as anything else that isn't there.
  assert.equal((await as(b)("GET", `/hosts/${h}/money`)).status, 404);
  assert.equal((await as(b)("GET", `/hosts/${h}/payout-account`)).status, 404);
  assert.equal((await as(b)("PUT", `/hosts/${h}/payout-account`, { upi: "riya@okhdfc" })).status, 404);
  assert.equal((await as(b)("POST", `/hosts/${h}/payouts`, { eventId: e.id, amountPaise: 100 })).status, 404);

  const m = (await as(a)("GET", `/hosts/${h}/money`)).body;
  assert.deepEqual([m.plan, m.account, m.venue, m.payouts], ["3+2", null, null, []]);
  const earned = m.events.find((x: { eventId: string }) => x.eventId === e.id);
  assert.ok(earned.availablePaise > 0);
  assert.equal(Date.parse(earned.opensAt) - Date.parse(earned.endsAt), 3 * DAY);

  // Too soon: the event hasn't ended 3 days ago.
  const soon = await as(a)("POST", `/hosts/${h}/payouts`, { eventId: e.id, amountPaise: 100 });
  assert.deepEqual([soon.status, soon.body.error], [409, "notYet"]);

  assert.equal((await as(a)("PUT", `/hosts/${h}/payout-account`, { holder: "Riya Kapoor", account: "1234", ifsc: "HDFC0001234" })).status, 400);
  assert.equal((await as(a)("PUT", `/hosts/${h}/payout-account`, { holder: "Riya Kapoor", account: "123456789012", ifsc: "HDFC1001234" })).status, 400);
  const notices = t.notices.length;
  const put = await as(a)("PUT", `/hosts/${h}/payout-account`, { holder: "Riya Kapoor", account: "1234 5678 9012", ifsc: "hdfc0001234" });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(
    [put.body.kind, put.body.bankName, put.body.last4, put.body.holder, put.body.state],
    ["bank", "HDFC Bank", "9012", "Riya Kapoor", "checking"],
  );
  assert.ok(!JSON.stringify(put.body).includes("123456789012") && !JSON.stringify(put.body).includes("HDFC0001234"));
  assert.ok(!(await audits("payouts.account")).includes("123456789012"));
  assert.ok(t.notices.slice(notices).some((x) => x.kind === "bankChanged" && (x.to as any).userId === a.me.id));

  t.tick(DAY + 2 * HOUR + 3 * DAY + MIN);
  const unchecked = await as(a)("POST", `/hosts/${h}/payouts`, { eventId: e.id, amountPaise: 100 });
  assert.deepEqual([unchecked.status, unchecked.body.error], [409, "accountNotVerified"]);

  // Galaxy sees it whole, and verifies only the details it saw.
  const acc = (await as(boss)("GET", "/galaxy/money/payout-accounts")).body.find((x: { hostId: string }) => x.hostId === h);
  assert.deepEqual([acc.accountNumber, acc.ifsc, acc.state], ["123456789012", "HDFC0001234", "checking"]);
  assert.equal((await as(a)("POST", `/galaxy/money/payout-accounts/${h}/verify`, { reason: "Checked", seen: acc.updatedAt })).status, 404);
  const stale = await as(boss)("POST", `/galaxy/money/payout-accounts/${h}/verify`, { reason: "Checked", seen: new Date(0).toISOString() });
  assert.deepEqual([stale.status, stale.body.error], [409, "changed"]);
  assert.equal((await as(boss)("POST", `/galaxy/money/payout-accounts/${h}/verify`, { reason: "Penny drop matched", seen: acc.updatedAt })).status, 200);
  assert.equal((await as(boss)("POST", `/galaxy/money/payout-accounts/${h}/verify`, { reason: "Again", seen: acc.updatedAt })).body.error, "already");
  assert.ok(t.notices.some((x) => x.kind === "bankChecked" && (x.to as any).userId === a.me.id));
  assert.equal((await as(a)("GET", `/hosts/${h}/payout-account`)).body.state, "verified");

  const over = await as(a)("POST", `/hosts/${h}/payouts`, { eventId: e.id, amountPaise: earned.availablePaise + 1 });
  assert.deepEqual([over.status, over.body.error], [400, "tooMuch"]);
  const ask = await as(a)("POST", `/hosts/${h}/payouts`, { eventId: e.id, amountPaise: earned.availablePaise });
  assert.equal(ask.status, 201, JSON.stringify(ask.body));
  const after = (await as(a)("GET", `/hosts/${h}/money`)).body;
  assert.deepEqual([after.payouts[0].status, after.payouts[0].eventTitle], ["requested", "Open Mic Night"]);
  assert.equal(after.events.find((x: { eventId: string }) => x.eventId === e.id).availablePaise, 0);
  assert.ok((await audits("payouts.request")).includes(ask.body.id));
  const listed = (await as(boss)("GET", "/galaxy/money/payouts")).body.payouts.find((x: { id: string }) => x.id === ask.body.id);
  assert.deepEqual([listed.fromHost, listed.askedByName], [true, "Riya Kapoor"]);

  // Replaced with a UPI ID: checked again, the ID itself never goes back. Galaxy rejects it with a reason.
  const upi = await as(a)("PUT", `/hosts/${h}/payout-account`, { upi: "riya.kapoor@okhdfc" });
  assert.deepEqual([upi.body.kind, upi.body.bankName, upi.body.state], ["upi", "UPI · okhdfc", "checking"]);
  assert.ok(!JSON.stringify(upi.body).includes("riya.kapoor@okhdfc"));
  assert.ok(!(await audits("payouts.account")).includes("riya.kapoor"));
  const seen = (await t.db.select().from(payoutAccounts).where(eq(payoutAccounts.hostId, h)))[0]!.updatedAt.toISOString();
  assert.equal((await as(boss)("POST", `/galaxy/money/payout-accounts/${h}/reject`, { reason: "Name doesn't match", seen })).status, 200);
  assert.deepEqual(
    [(await as(a)("GET", `/hosts/${h}/payout-account`)).body.state, (await as(a)("GET", `/hosts/${h}/payout-account`)).body.reason],
    ["rejected", "Name doesn't match"],
  );
});

test("venue payouts: slot money 3 days after the slot ends, one ask a week; Galaxy pays a Venue with no event", async () => {
  const boss = await join();
  await give(boss, "money");
  const { a, b, h, claimId, start } = await heldSlot();
  const o = (await payHold(b, h, claimId)).body;
  assert.equal((await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id)).body.status, "paid");

  const v = (await as(a)("GET", `/hosts/${h}/money`)).body.venue;
  assert.equal(v.bookings, 1);
  assert.ok(v.earningsPaise > 0);
  // Not played yet: earned, waiting till 3 days after it ends, not available.
  assert.deepEqual([v.waitingPaise, v.availablePaise, v.nextAskAt, v.opensAt], [v.earningsPaise, 0, null, new Date(start + HOUR + 3 * DAY).toISOString()]);
  await as(a)("PUT", `/hosts/${h}/payout-account`, { holder: "Riya Kapoor", account: "123456789012", ifsc: "SBIN0001234" });
  await t.db.update(payoutAccounts).set({ state: "verified" }).where(eq(payoutAccounts.hostId, h));
  assert.equal((await as(a)("POST", `/hosts/${h}/payouts`, { amountPaise: 1 })).body.error, "tooMuch");

  t.tick(start + HOUR + MIN - t.now());
  const played = (await as(a)("GET", `/hosts/${h}/money`)).body.venue;
  assert.deepEqual([played.waitingPaise, played.availablePaise, played.opensAt], [v.earningsPaise, 0, new Date(start + HOUR + 3 * DAY).toISOString()]);
  t.tick(3 * DAY);
  const ready = (await as(a)("GET", `/hosts/${h}/money`)).body.venue;
  assert.deepEqual([ready.waitingPaise, ready.availablePaise], [0, v.earningsPaise]);
  assert.equal((await as(a)("POST", `/hosts/${h}/payouts`, { amountPaise: ready.availablePaise - 100 })).status, 201);
  const week = await as(a)("POST", `/hosts/${h}/payouts`, { amountPaise: 100 });
  assert.deepEqual([week.status, week.body.error], [409, "weekly"]);
  assert.ok((await as(a)("GET", `/hosts/${h}/money`)).body.venue.nextAskAt);

  // Galaxy isn't held to the week, and pays a Venue by host with no event.
  assert.equal((await as(boss)("POST", "/galaxy/money/payouts", { hostId: h, amountPaise: 101, reason: "Slots" })).body.error, "tooMuch");
  assert.equal((await as(boss)("POST", "/galaxy/money/payouts", { hostId: h, eventId: claimId, amountPaise: 1, reason: "Both" })).status, 400);
  const staff = await as(boss)("POST", "/galaxy/money/payouts", { hostId: h, amountPaise: 100, reason: "Slots" });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  const g = (await as(boss)("GET", "/galaxy/money/payouts")).body;
  const rows = g.payouts.filter((x: { hostId: string }) => x.hostId === h);
  assert.deepEqual(rows.map((x: { eventId: string | null; fromHost: boolean }) => [x.eventId, x.fromHost]).sort(), [[null, false], [null, true]]);
  assert.equal(g.venues.find((x: { hostId: string }) => x.hostId === h).availablePaise, 0);

  t.tick(8 * DAY);
  assert.equal((await as(a)("GET", `/hosts/${h}/money`)).body.venue.nextAskAt, null);
});

// ---------- X4 review: what a host or staff can't do ----------

const earnedOn = async (boss: P, eventId: string) =>
  (await as(boss)("GET", "/galaxy/money/payouts")).body.earnings.find((x: { eventId: string }) => x.eventId === eventId);

test("host asks: two at once, one wins; Crew, ended seats and other hosts' Admins get 404; an open ask blocks archive; only a cancel's reason shows", async () => {
  const a = await join(), b = await join(), boss = await join(), crew = await join(), gone = await join();
  await give(boss, "money");
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  const h = e.hostId;
  await account(h);
  const other = await publish(b);
  await account(other.hostId);
  const now = new Date(t.now());
  await t.db.insert(teamRoles).values([
    { hostId: h, role: "crew", contact: `+91${crew.p}`, userId: crew.me.id, addedBy: a.me.id, addedAt: now, acceptedAt: now, startedAt: now },
    { hostId: h, role: "admin", contact: `+91${gone.p}`, userId: gone.me.id, addedBy: a.me.id, addedAt: now, acceptedAt: now, startedAt: now, endedAt: now, endedBy: a.me.id, endReason: "removed" },
  ]);
  t.tick(DAY + 2 * HOUR + 3 * DAY + MIN);

  for (const u of [crew, gone]) {
    assert.equal((await as(u)("GET", `/hosts/${h}/money`)).status, 404);
    assert.equal((await as(u)("POST", `/hosts/${h}/payouts`, { eventId: e.id, amountPaise: 100 })).status, 404);
    assert.equal((await as(u)("PUT", `/hosts/${h}/payout-account`, { upi: "crew@okhdfc" })).status, 404);
  }
  // Another host's Admin naming this host's event, through their own host.
  assert.equal((await as(b)("POST", `/hosts/${other.hostId}/payouts`, { eventId: e.id, amountPaise: 100 })).status, 404);

  const [x, y] = await Promise.all([1, 2].map(() => as(a)("POST", `/hosts/${h}/payouts`, { eventId: e.id, amountPaise: 100 })));
  assert.deepEqual([x!.status, y!.status].sort(), [201, 409]);
  const [won, lost] = x!.status === 201 ? [x!, y!] : [y!, x!];
  assert.equal(lost.body.error, "askOpen");

  const busy = await as(a)("POST", `/hosts/${h}/archive`);
  assert.deepEqual([busy.status, busy.body.error], [409, "busy"]);

  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${won.body.id}/cancel`, { reason: "Ask for all of it" })).status, 200);
  const staff = await as(boss)("POST", "/galaxy/money/payouts", { eventId: e.id, amountPaise: 100, reason: "Internal: split payment" });
  assert.equal(staff.status, 201);
  const listed = (await as(a)("GET", `/hosts/${h}/money`)).body.payouts as { id: string; reason: string | null }[];
  assert.equal(listed.find((p) => p.id === won.body.id)!.reason, "Ask for all of it");
  assert.equal(listed.find((p) => p.id === staff.body.id)!.reason, null);
});

test("marking paid: refused once refunds leave less than the ask; staff never act on a host they're on; the account view is audited", async () => {
  const a = await join(), b = await join(), boss = await join();
  await give(boss, "money");
  const e = await publish(a);
  const o = (await pay(b, e)).body;
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  await account(e.hostId);
  const all = (await earnedOn(boss, e.id)).availablePaise;
  const po = await as(boss)("POST", "/galaxy/money/payouts", { eventId: e.id, amountPaise: all, reason: "Payout" });
  assert.equal(po.status, 201);
  const id = (await paymentOf(o.orderId)).id;
  assert.equal((await as(boss)("POST", `/galaxy/money/payments/${id}/refund`, { amountPaise: 20000, reason: "Seat was broken" })).status, 201);
  assert.ok((await earnedOn(boss, e.id)).availablePaise < 0);
  // The host sees nothing to ask for, not a debt.
  assert.equal((await as(a)("GET", `/hosts/${e.hostId}/money`)).body.events.find((x: { eventId: string }) => x.eventId === e.id).availablePaise, 0);
  const short = await as(boss)("POST", `/galaxy/money/payouts/${po.body.id}/paid`, { utr: "UTR000000000001" });
  assert.deepEqual([short.status, short.body.error], [409, "short"]);
  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${po.body.id}/cancel`, { reason: "Refund since" })).status, 200);
  const left = (await earnedOn(boss, e.id)).availablePaise;
  const po2 = await as(boss)("POST", "/galaxy/money/payouts", { eventId: e.id, amountPaise: left, reason: "Payout" });
  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${po2.body.id}/paid`, { utr: "UTR000000000001" })).status, 200);

  // Staff on a host: no verify, no payout, no paid, whoever made it.
  const mine = await publish(boss);
  await account(mine.hostId, "checking");
  const seen = (await t.db.select().from(payoutAccounts).where(eq(payoutAccounts.hostId, mine.hostId)))[0]!.updatedAt.toISOString();
  assert.equal((await as(boss)("POST", `/galaxy/money/payout-accounts/${mine.hostId}/verify`, { reason: "Mine", seen })).body.error, "ownHost");
  assert.equal((await as(boss)("POST", "/galaxy/money/payouts", { eventId: mine.id, amountPaise: 1, reason: "Mine" })).body.error, "ownHost");
  assert.equal((await as(boss)("POST", "/galaxy/money/payouts", { hostId: mine.hostId, amountPaise: 1, reason: "Mine" })).body.error, "ownHost");
  const [theirs] = await t.db
    .insert(payouts)
    .values({ hostId: mine.hostId, eventId: mine.id, amountPaise: 1, askedBy: a.me.id, fromHost: false, by: a.me.id, at: new Date(t.now()), createdAt: new Date(t.now()) })
    .returning();
  const own = await as(boss)("POST", `/galaxy/money/payouts/${theirs!.id}/paid`, { utr: "UTR000000000002" });
  assert.deepEqual([own.status, own.body.error], [403, "ownHost"]);

  // Every look at the full accounts leaves a row naming whose, never the numbers.
  const views = async () => (await t.db.select().from(auditLog).where(eq(auditLog.action, "money.accounts.view"))).filter((r) => r.actorId === boss.me.id);
  const before = (await views()).length;
  const list = (await as(boss)("GET", "/galaxy/money/payout-accounts")).body as { hostId: string; updatedAt: string }[];
  const rows = await views();
  assert.equal(rows.length, before + 1);
  assert.ok((rows.at(-1)!.data as { hosts: string[] }).hosts.includes(e.hostId));
  assert.ok(!JSON.stringify(rows).includes("123456789012"));

  // Replaced since staff looked: the old details can't be verified.
  const old = list.find((x) => x.hostId === e.hostId)!.updatedAt;
  t.tick(1000);
  assert.equal((await as(a)("PUT", `/hosts/${e.hostId}/payout-account`, { upi: "ab@okhdfc" })).body.last4, "b"); // a short name shows its last letter
  const stale = await as(boss)("POST", `/galaxy/money/payout-accounts/${e.hostId}/verify`, { reason: "Checked", seen: old });
  assert.deepEqual([stale.status, stale.body.error], [409, "changed"]);

  // UPI masking, then 5 changes a day.
  assert.equal((await as(a)("PUT", `/hosts/${e.hostId}/payout-account`, { upi: "abcd@ybl" })).body.last4, "d");
  assert.equal((await as(a)("PUT", `/hosts/${e.hostId}/payout-account`, { upi: "riyak@ybl" })).body.last4, "iyak");
  assert.equal((await as(a)("PUT", `/hosts/${e.hostId}/payout-account`, { upi: "riya.k@ybl" })).status, 200);
  assert.equal((await as(a)("PUT", `/hosts/${e.hostId}/payout-account`, { upi: "riya.kk@ybl" })).status, 200);
  const sixth = await as(a)("PUT", `/hosts/${e.hostId}/payout-account`, { upi: "riya.kkk@ybl" });
  assert.deepEqual([sixth.status, sixth.body.error], [429, "tooMany"]);
});

test("venue asks: two at once take one; a cancel frees the amount and the week; staff payouts don't start it; paid and cancelled", async () => {
  const boss = await join();
  await give(boss, "money");
  const { a, b, h, claimId, start } = await heldSlot();
  const o = (await payHold(b, h, claimId)).body;
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  await account(h);
  t.tick(start + HOUR + 3 * DAY + MIN - t.now());
  const all = (await as(a)("GET", `/hosts/${h}/money`)).body.venue.availablePaise as number;

  const [x, y] = await Promise.all([1, 2].map(() => as(a)("POST", `/hosts/${h}/payouts`, { amountPaise: 100 })));
  assert.deepEqual([x!.status, y!.status].sort(), [201, 409]);
  const [won, lost] = x!.status === 201 ? [x!, y!] : [y!, x!];
  assert.equal(lost.body.error, "weekly");

  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${won.body.id}/cancel`, { reason: "Ask for all of it" })).status, 200);
  const freed = (await as(a)("GET", `/hosts/${h}/money`)).body.venue;
  assert.deepEqual([freed.availablePaise, freed.nextAskAt], [all, null]);

  const staff = await as(boss)("POST", "/galaxy/money/payouts", { hostId: h, amountPaise: 100, reason: "Slots" });
  assert.equal(staff.status, 201);
  assert.equal((await as(a)("GET", `/hosts/${h}/money`)).body.venue.nextAskAt, null);
  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${staff.body.id}/paid`, { utr: "UTR000000000101" })).status, 200);
  const rest = await as(a)("POST", `/hosts/${h}/payouts`, { amountPaise: all - 100 });
  assert.equal(rest.status, 201, JSON.stringify(rest.body));
  assert.equal((await as(boss)("POST", `/galaxy/money/payouts/${rest.body.id}/paid`, { utr: "UTR000000000102" })).status, 200);
  const done = (await as(a)("GET", `/hosts/${h}/money`)).body.venue;
  assert.deepEqual([done.paidOutPaise, done.requestedPaise, done.availablePaise], [all, 0, 0]);
  assert.ok(done.nextAskAt);
});

test("venueEarningsOf: a partly refunded slot and one with the fee in the price", async () => {
  const boss = await join();
  await give(boss, "money");
  const { a, b, h, stationId, claimId, start } = await heldSlot();
  const o = (await payHold(b, h, claimId)).body;
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  const first = await paymentOf(o.orderId);
  assert.equal((await as(boss)("POST", `/galaxy/money/payments/${first.id}/refund`, { amountPaise: 10000, reason: "Lag" })).status, 201);
  assert.equal((await as(boss)("PUT", `/galaxy/money/fees/${h}`, { plan: "3+2", feeIncluded: true, reason: "Host asked" })).status, 200);
  const hold = await as(b)("POST", `/venues/${h}/holds`, { stationId, start: new Date(start + HOUR).toISOString(), hours: 1, count: 1 });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  const o2 = (await payHold(b, h, hold.body.id)).body;
  await verify(b, o2.orderId, capture(o2.orderId, o2.amountPaise).id);
  const second = await paymentOf(o2.orderId);
  assert.ok(!first.feeIncluded && second.feeIncluded);

  t.tick(start + 2 * HOUR + 3 * DAY + MIN - t.now());
  const v = await venueEarningsOf(t.db, h, t.now());
  assert.equal(v.bookings, 2);
  assert.equal(v.refundedPaise, 10000);
  assert.ok(v.includedPaise > 0);
  assert.equal(v.earningsPaise, v.salesPaise - v.commissionPaise - v.includedPaise - v.refundedPaise);
  assert.equal(v.salesPaise, 100000); // two ₹500 hours, whatever the fee
  assert.deepEqual([v.availablePaise, v.waitingPaise], [v.earningsPaise, 0]);
});

test("once someone has paid, or is paying, an event's end only moves later", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const end = (await t.db.select().from(events).where(eq(events.id, e.id)))[0]!.endsAt!.getTime();
  const move = (ms: number) => as(a)("PATCH", `/events/${e.id}`, { endsAt: new Date(ms).toISOString() });
  assert.equal((await move(end - 30 * MIN)).status, 200); // nobody has paid
  const o = (await pay(b, e)).body;
  const open = await move(end - HOUR);
  assert.deepEqual([open.status, open.body.error], [409, "endLocked"]);
  await verify(b, o.orderId, capture(o.orderId, o.amountPaise).id);
  assert.equal((await move(end - HOUR)).body.error, "endLocked");
  assert.equal((await move(end + HOUR)).status, 200);
});

// A held slot, paid and settled: the player, the payment row.
const paidSlot = async () => {
  const x = await heldSlot();
  const o = (await payHold(x.b, x.h, x.claimId)).body;
  assert.equal((await verify(x.b, o.orderId, capture(o.orderId, o.amountPaise).id)).body.status, "paid");
  return { ...x, o, p: await paymentOf(o.orderId) };
};

test("slot pay: settled, the player gets slotConfirmed with the code; the payment counts as booked; names on the player's lists", async () => {
  const notices = t.notices.length;
  const { b, h, claimId, p } = await paidSlot();
  assert.equal(p.slotBooked, true);
  const mine = t.notices.slice(notices).filter((n) => n.kind === "slotConfirmed");
  assert.equal(mine.length, 1);
  assert.ok("userId" in mine[0]!.to && mine[0]!.to.userId === b.me.id);
  assert.equal((mine[0]!.data as { code?: string }).code, (await claimOf(claimId)).code);
  const [host] = await t.db.select().from(hosts).where(eq(hosts.id, h));
  const pays = (await as(b)("GET", "/me/payments")).body as { eventTitle: string | null; hostName: string }[];
  assert.deepEqual(pays.map((x) => [x.eventTitle, x.hostName]), [[null, host!.name]]);
});

test("slot pay: staff taking it all back frees the slot; a part refund keeps it", async () => {
  const boss = await join();
  await give(boss, "money");
  const { claimId, p } = await paidSlot();
  assert.equal((await as(boss)("POST", `/galaxy/money/payments/${p.id}/refund`, { amountPaise: 100, reason: "Part" })).status, 201);
  assert.equal((await claimOf(claimId)).status, "paid");
  const all = await as(boss)("POST", `/galaxy/money/payments/${p.id}/refund`, { amountPaise: p.amountPaise - 100, reason: "Rest" });
  assert.equal(all.status, 201, JSON.stringify(all.body));
  assert.equal((await claimOf(claimId)).status, "refunded");
  assert.equal((await paymentOf(p.razorpayOrderId)).status, "refundPending");
});

test("slot pay: the venue's earnings and a venue payout; a player's cancel undoes the sale, Orbit's fee stays", async () => {
  const boss = await join();
  await give(boss, "money");
  const one = await paidSlot();
  const [e] = await earningsOf(t.db, { venue: one.h }, new Date(t.now()));
  assert.equal(e!.eventId, null);
  assert.equal(e!.salesPaise, 50000);
  assert.ok(e!.earningsPaise > 0 && e!.earningsPaise <= 50000);
  // Not played yet: the player can still cancel, so none of it is available.
  assert.equal(e!.availablePaise, 0);
  assert.equal((await as(boss)("POST", "/galaxy/money/payouts", { hostId: one.h, amountPaise: 1, reason: "Early" })).status, 400);
  // Played, but slot money waits 3 days after the slot ends.
  t.tick(41 * MIN);
  assert.equal((await earningsOf(t.db, { venue: one.h }, new Date(t.now())))[0]!.availablePaise, 0);
  t.tick(one.start + HOUR + 3 * DAY - t.now());
  assert.equal((await earningsOf(t.db, { venue: one.h }, new Date(t.now())))[0]!.availablePaise, e!.earningsPaise);
  const g = (await as(boss)("GET", "/galaxy/money/payouts")).body;
  assert.ok(!g.earnings.some((x: { eventId: string | null }) => !x.eventId)); // venues show once, under venues
  assert.equal(g.venues.find((x: { hostId: string }) => x.hostId === one.h).availablePaise, e!.earningsPaise);
  assert.equal((await as(boss)("POST", "/galaxy/money/payouts", { hostId: one.h, eventId: "00000000-0000-4000-8000-000000000000", amountPaise: 1, reason: "Both" })).status, 400);
  assert.equal((await as(boss)("POST", "/galaxy/money/payouts", { hostId: one.h, amountPaise: e!.earningsPaise + 1, reason: "Payout" })).status, 400);
  const po = await as(boss)("POST", "/galaxy/money/payouts", { hostId: one.h, amountPaise: e!.earningsPaise, reason: "Payout" });
  assert.equal(po.status, 201, JSON.stringify(po.body));
  assert.equal((await earningsOf(t.db, { venue: one.h }, new Date(t.now())))[0]!.availablePaise, 0);

  // Cancel: someone else can't; the player gets the price back, the fee stays; the venue earns nothing from it.
  const two = await paidSlot();
  const cancel = (u: P) => as(u)("POST", `/venues/${two.h}/holds/${two.claimId}/cancel`);
  assert.equal((await cancel(two.a)).status, 404);
  const r = await cancel(two.b);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.refundPaise, two.p.amountPaise - two.p.buyerFeePaise);
  assert.equal((await claimOf(two.claimId)).status, "refunded");
  assert.equal((await paymentOf(two.o.orderId)).status, "refundPending");
  const [rf] = await t.db.select().from(refunds).where(eq(refunds.paymentId, two.p.id));
  assert.deepEqual([rf!.kind, rf!.amountPaise], ["request", r.body.refundPaise]);
  assert.equal((await earningsOf(t.db, { venue: two.h }, new Date(t.now())))[0]!.earningsPaise, 0);
  const again = await cancel(two.b); // a retry: the same answer, nothing more sent
  assert.deepEqual([again.status, again.body.refundPaise], [200, r.body.refundPaise]);
  assert.equal((await t.db.select().from(refunds).where(eq(refunds.paymentId, two.p.id))).length, 1);
  // Processed: the payment is refunded though the fee never went back.
  const sent = rzState.refunds.find((x) => x.payment_id === two.p.razorpayPaymentId)!;
  assert.equal(await hook("refund.processed", { refund: { entity: { ...sent, status: "processed" } } }), 200);
  assert.equal((await paymentOf(two.o.orderId)).status, "refunded");
  const back = (await as(two.b)("GET", "/me/refunds")).body as { hostName: string }[];
  assert.equal(back.length, 1);
  assert.ok(back[0]!.hostName);

  // After the start: too late.
  const three = await paidSlot();
  t.tick(41 * MIN);
  assert.equal((await as(three.b)("POST", `/venues/${three.h}/holds/${three.claimId}/cancel`)).body.error, "cantCancel");
});

test("venueEarningsOf: slot money waits 3 days after the slot ends; a player's cancel undoes the whole sale", async () => {
  const one = await paidSlot();
  const earned = (await venueEarningsOf(t.db, one.h, t.now())).earningsPaise;
  t.tick(one.start + HOUR + DAY - t.now()); // played a day ago
  const day = await venueEarningsOf(t.db, one.h, t.now());
  assert.deepEqual([day.waitingPaise, day.availablePaise], [earned, 0]);
  t.tick(3 * DAY); // played 4 days ago
  const four = await venueEarningsOf(t.db, one.h, t.now());
  assert.deepEqual([four.waitingPaise, four.availablePaise], [0, earned]);
  assert.equal(four.availablePaise, (await earningsOf(t.db, { venue: one.h }, new Date(t.now())))[0]!.availablePaise);

  const two = await paidSlot();
  assert.equal((await as(two.b)("POST", `/venues/${two.h}/holds/${two.claimId}/cancel`)).status, 200);
  const v = await venueEarningsOf(t.db, two.h, t.now());
  assert.deepEqual([v.bookings, v.refundedPaise, v.commissionPaise, v.includedPaise, v.earningsPaise, v.waitingPaise], [1, 50000, 0, 0, 0, 0]);
});

test("venue payout: refunded in full after the ask, marking it paid is refused as short", async () => {
  const boss = await join();
  await give(boss, "money");
  const one = await paidSlot();
  await account(one.h);
  t.tick(one.start + HOUR + 3 * DAY + MIN - t.now());
  const all = (await venueEarningsOf(t.db, one.h, t.now())).availablePaise;
  assert.ok(all > 0);
  const ask = await as(one.a)("POST", `/hosts/${one.h}/payouts`, { amountPaise: all });
  assert.equal(ask.status, 201, JSON.stringify(ask.body));
  assert.equal((await as(boss)("POST", `/galaxy/money/payments/${one.p.id}/refund`, { amountPaise: one.p.amountPaise, reason: "Venue closed" })).status, 201);
  const short = await as(boss)("POST", `/galaxy/money/payouts/${ask.body.id}/paid`, { utr: "UTR000000000201" });
  assert.deepEqual([short.status, short.body.error], [409, "short"]);
});
