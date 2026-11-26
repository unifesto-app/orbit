import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { testApp } from "./testkit.ts";
import { activity, activityDays, auditLog, bookings, events, follows, hosts, identities, passkeys, payments, refunds, sessions, staffGrants, ticketTypes, users } from "./db/schema.ts";
import { markActive } from "./activity.ts";
import { sweepActivity } from "./analytics.ts";
import { runDeletions } from "./auth/deletion.ts";

let t: Awaited<ReturnType<typeof testApp>>;
const DAY = 86_400_000, IST = 330 * 60_000;
const ist = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Polls until the fire-and-forget insert shows (or 3s pass); the caller asserts.
const until = async (f: () => Promise<boolean>) => {
  for (let i = 0; i < 60 && !(await f()); i++) await sleep(50);
};
const settle = () => sleep(250); // for "writes nothing": after a control write has landed
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(5_000_000 + ++n * 13).padStart(9, "0")}`;
const join = async () => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return s.body as { access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const get = (path: string, access: string, client?: string) =>
  t.app.request(path, { headers: { authorization: `Bearer ${access}`, ...(client ? { "x-orbit-client": client } : {}) } });
const rows = async (id: string) => (await t.db.select().from(activity).where(eq(activity.userId, id))).sort((a, b) => a.platform.localeCompare(b.platform));
const today = () => ist(t.now());
const dayAgo = (k: number) => ist(t.now() - k * DAY);
const newUser = async (createdAt: Date, extra: Partial<typeof users.$inferInsert> = {}) =>
  (await t.db.insert(users).values({ createdAt, ...extra }).returning({ id: users.id }))[0]!.id;
const at = (k: number) => new Date(t.now() - k * DAY - 60_000 * 5); // k days ago, roughly now
const act = (userId: string, day: string, platform: "ios" | "android" | "web" | "app", version: string | null = null) =>
  t.db.insert(activity).values({ userId, day, platform, version });

test("1 recording", async () => {
  const u = await join();
  assert.equal((await get("/me", u.access, "ios/1.2.3")).status, 200);
  await until(async () => (await rows(u.me.id)).length >= 1);
  let r = await rows(u.me.id);
  assert.deepEqual(r.map((x) => [x.day, x.platform, x.version]), [[today(), "ios", "1.2.3"]]);
  await get("/me", u.access, "ios/1.2.3");
  await settle();
  assert.equal((await rows(u.me.id)).length, 1);
  await get("/me", u.access, "android/1.0.0");
  await until(async () => (await rows(u.me.id)).length >= 2);
  r = await rows(u.me.id);
  assert.deepEqual(r.map((x) => x.platform), ["android", "ios"]);

  const g = await join();
  const l = await join(); // a host app: Orbit Launch, hosts at work
  const h = await join();
  await get("/me", g.access, "galaxy");
  await get("/me", l.access, "launch-ios/1.0.0");
  await get("/me", h.access);
  await until(async () => (await rows(h.me.id)).length >= 1); // the control: its write has landed, so galaxy's would have
  assert.equal((await rows(g.me.id)).length, 0);
  assert.equal((await rows(l.me.id)).length, 0);
  assert.deepEqual((await rows(h.me.id)).map((x) => [x.platform, x.version]), [["app", null]]);

  const j = await join();
  await get("/me", j.access, "ios/1.0.0; drop table");
  await until(async () => (await rows(j.me.id)).length >= 1);
  assert.deepEqual((await rows(j.me.id)).map((x) => [x.platform, x.version]), [["app", null]]);
});

test("2 a failing insert never fails the request", async () => {
  const u = await join();
  await t.db.execute(sql`alter table activity rename to activity_off`);
  try {
    assert.equal((await get("/me", u.access, "ios/1.0.0")).status, 200);
    await settle();
  } finally {
    await t.db.execute(sql`alter table activity_off rename to activity`);
  }
});

let reader: P;
const getReader = async () =>
  (reader ??= await (async () => {
    const u = await join();
    await t.db.insert(staffGrants).values({ userId: u.me.id, feature: "people", addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
    return u;
  })());
const stats = async () => {
  const u = await getReader();
  const r = await get("/galaxy/analytics", u.access, "galaxy"); // galaxy: the reader never counts as active
  assert.equal(r.status, 200);
  return (await r.json()) as any;
};
const tally = (a: { name: string; count: number }[]) => Object.fromEntries(a.map((x) => [x.name, x.count]));
const delta = (a: any[], b: any[]) => {
  const x = tally(a), y = tally(b);
  return Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, (y[k] ?? 0) - (x[k] ?? 0)]));
};

test("3 gates", async () => {
  assert.equal((await t.app.request("/galaxy/analytics")).status, 401);
  const plain = await join();
  assert.equal((await get("/galaxy/analytics", plain.access, "galaxy")).status, 404);
  const other = await join();
  await t.db.insert(staffGrants).values({ userId: other.me.id, feature: "hosts", addedBy: other.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  assert.equal((await get("/galaxy/analytics", other.access, "galaxy")).status, 404);
  const u = await getReader();
  await stats();
  const audits = (await t.db.select().from(auditLog).where(eq(auditLog.actorId, u.me.id))).filter((x) => x.action === "analytics.view");
  assert.ok(audits.length >= 1);
});

test("6 retention", async () => {
  const a = await stats();
  const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const add = (d: string, k: number) => new Date(dayMs(d) + k * DAY).toISOString().slice(0, 10);
  const monday = add(today(), -((new Date(dayMs(today())).getUTCDay() + 6) % 7));
  const wk = add(monday, -21);
  const noon = (d: string) => new Date(dayMs(d) - IST + 12 * 3_600_000);
  const x = await newUser(noon(add(wk, 2))), y = await newUser(noon(add(wk, 3)));
  await act(x, add(wk, 9), "ios", "1.0.0"); // 1st week after
  await act(x, add(wk, 15), "ios", "1.0.0"); // 2nd
  await act(y, add(wk, 16), "ios", "1.0.0"); // 2nd
  await act(y, add(monday, 0), "ios", "1.0.0"); // the current week
  await act(await newUser(new Date()), add(wk, 7), "ios", "1.0.0"); // the log's first day, so week 1 of this cohort isn't before it
  const b = await stats();
  const g = (s: any, w: string) => s.retention.find((r: any) => r.week === w);
  assert.equal(g(b, wk).size - g(a, wk).size, 2);
  assert.equal(g(a, wk).size, 0, "another file's users sit in this week; exact weeks can't be checked");
  assert.deepEqual(g(b, wk).weeks, [0.5, 1, null, null]);
  const empty = add(monday, -35);
  assert.equal(g(b, empty).size, 0);
  assert.deepEqual(g(b, empty).weeks, [null, null, null, null]);
  assert.equal(b.retention.length, 8);
  assert.equal(b.retention[7].week, add(monday, -7));
  assert.equal(b.since, [a.since, add(wk, 7)].filter(Boolean).sort()[0]);
});

test("6b retention: weeks before the log began are null, not 0", async () => {
  const b = await stats();
  const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const add = (d: string, k: number) => new Date(dayMs(d) + k * DAY).toISOString().slice(0, 10);
  let checked = 0;
  for (const r of b.retention) {
    if (!r.size) continue;
    r.weeks.forEach((v: number | null, k: number) => {
      const ended = dayMs(add(r.week, 7 * (k + 2))) - IST <= t.now();
      if (ended && add(r.week, 7 * (k + 1)) < b.since) { assert.equal(v, null, `${r.week} +${k + 1}`); checked++; }
      if (ended && add(r.week, 7 * (k + 1)) >= b.since) assert.notEqual(v, null, `${r.week} +${k + 1}`);
    });
  }
  // `since` is the earliest of every file's rows (activity_days from the sweep test sits ~95 days back), so it may not be
  // controllable here; the cells above are checked against the real `since` either way.
  console.log(`# retention: since=${b.since}, ${checked} null-by-since cell(s) checked`);
});

test("4 numbers", async () => {
  const a = await stats();
  const onDay = (k: number) => new Date(t.now() - k * DAY);
  const u1 = await newUser(onDay(0)), u2 = await newUser(onDay(10)), u3 = await newUser(onDay(20));
  const u4 = await newUser(onDay(40)), u5 = await newUser(onDay(0), { deletedAt: new Date() }), u6 = await newUser(onDay(3));
  await act(u1, dayAgo(0), "ios", "1.2.3");
  await act(u2, dayAgo(0), "android", "1.0.0");
  await act(u2, dayAgo(3), "ios", "1.2.3");
  await act(u3, dayAgo(6), "web");
  await act(u4, dayAgo(25), "app");
  await act(u4, dayAgo(8), "ios", "0.9.0");
  await act(u5, dayAgo(0), "ios", "1.2.3"); // deleted: never counts
  await act(u6, dayAgo(3), "web");
  const b = await stats();
  assert.deepEqual([b.active.day - a.active.day, b.active.week - a.active.week, b.active.month - a.active.month], [2, 4, 5]);
  assert.equal(b.days.length, 30);
  assert.equal(b.days[0].day, dayAgo(29));
  assert.equal(b.days[29].day, today());
  const d = (k: number) => {
    const x = a.days.find((r: any) => r.day === dayAgo(k)), y = b.days.find((r: any) => r.day === dayAgo(k));
    return [y.active - x.active, y.new - x.new, y.returning - x.returning];
  };
  assert.deepEqual(d(0), [2, 1, 1]);
  assert.deepEqual(d(3), [2, 1, 1]);
  assert.deepEqual(d(6), [1, 0, 1]);
  assert.deepEqual(d(8), [1, 0, 1]);
  assert.deepEqual(d(25), [1, 0, 1]);
  const p = delta(a.platforms, b.platforms);
  assert.deepEqual([p["iOS"], p["Android"], p["Web"], p["App (older build)"]], [3, 1, 2, 1]);
  const v = delta(a.versions, b.versions);
  assert.deepEqual([v["iOS 1.2.3"], v["Android 1.0.0"], v["iOS 0.9.0"] ?? 0], [2, 1, 0]);
  assert.ok(!b.versions.some((x: any) => /web|app/i.test(x.name) && !/^(iOS|Android)/.test(x.name)));
});

test("5 sign-ins, ways, ages, genders, follows, deletions", async () => {
  const a = await stats();
  const Y = Number(today().slice(0, 4));
  const jan = (back: number) => `${Y - back}-01-01`;
  const mk = (o: Partial<typeof users.$inferInsert>) => newUser(new Date(), o);
  const id = randomUUID().slice(0, 8);
  const [d16, d20, d30, d40, d50] = [16, 20, 30, 40, 50].map((x) => jan(x));
  const A = await mk({ dob: d16, gender: "some free text", phone: `+91${phone()}`, email: `a${id}@x.com` });
  const B = await mk({ dob: d20, gender: "Woman", phone: `+91${phone()}` });
  const C = await mk({ dob: d30, email: `c${id}@x.com` });
  const D = await mk({ dob: d40 });
  const E = await mk({ dob: d50 });
  await mk({}); // not given
  await t.db.insert(identities).values([
    { userId: B, provider: "google", subject: `g${id}` },
    { userId: C, provider: "apple", subject: `a${id}` },
  ]);
  await t.db.insert(passkeys).values({ userId: C, credentialId: `cred${id}`, publicKey: "k", name: "x" });
  const sess = (userId: string, via: any, createdAt: Date) =>
    t.db.insert(sessions).values({ userId, deviceHash: randomUUID(), client: "app", name: "x", refreshHash: "x", freshVia: via, createdAt, expiresAt: new Date(t.now() + DAY) });
  await sess(A, "google", at(1));
  await sess(B, "google", at(29));
  await sess(C, "passkey", at(40)); // too old
  await sess(D, null, at(1));
  await t.db.insert(sessions).values({ userId: E, deviceHash: randomUUID(), client: "web", name: "Galaxy · Chrome on macOS", refreshHash: "x", freshVia: "google", createdAt: at(1), expiresAt: new Date(t.now() + DAY) });
  // follows
  const hs = await t.db
    .insert(hosts)
    .values(Array.from({ length: 5 }, () => ({ name: "H", slug: `h-${randomUUID()}`, kind: "venue" as const, city: "Hyderabad", ownerId: E, createdBy: E })))
    .returning({ id: hosts.id });
  const h = hs[0];
  // Live followers follow 1, 1, 2 and 5 hosts: percentile_disc's median is 1, where percentile_cont's 1.5 would cast to 2
  // and counting the deleted account's five would make it 2 as well. p90 is 5.
  const gone = await newUser(at(50), { deletedAt: at(45) }); // outside "deleted, last 30 days"
  await t.db.insert(follows).values([
    { userId: A, hostId: h!.id },
    { userId: B, hostId: h!.id },
    { userId: D, hostId: hs[1]!.id },
    { userId: D, hostId: hs[2]!.id },
    ...hs.flatMap((x) => [{ userId: C, hostId: x.id }, { userId: gone, hostId: x.id }]),
  ]);
  // deletions
  await newUser(at(0), { deletionRequestedAt: new Date(), deletionDueAt: new Date(t.now() + 20 * DAY) });
  await newUser(at(50), { deletedAt: at(2) });
  await newUser(at(50), { deletedAt: at(40) });
  const b = await stats();
  const s = delta(a.signIns, b.signIns);
  assert.equal(s["Google"], 2); // the Galaxy session (also google, in range) isn't counted
  assert.equal(s["Passkey"] ?? 0, 0);
  const w = delta(a.ways, b.ways);
  assert.deepEqual([w["Phone"], w["Email"], w["Google"], w["Apple"], w["Passkey"]], [2, 2, 1, 1, 1]);
  assert.deepEqual(b.ages.map((x: any) => x.name), ["Under 18", "18–24", "25–34", "35–44", "45+", "Not given"]);
  assert.deepEqual(b.ages.map((x: any, i: number) => x.count - a.ages[i].count), [1, 1, 1, 1, 1, 2]); // the pending-deletion user has no dob
  const gd = delta(a.genders, b.genders);
  assert.equal(gd["Woman"], 1);
  assert.equal(gd["Other"], 1);
  assert.equal(gd["Not given"], 5);
  assert.ok(!JSON.stringify(b).includes("some free text"));
  assert.equal(b.follows.people - a.follows.people, 7);
  assert.deepEqual([a.follows.following, a.follows.p50, a.follows.p90], [0, null, null]); // nobody follows yet: a dash, not 0
  assert.equal(b.follows.following - a.follows.following, 4);
  // The shared database has others' follows too, so the expected values come from every live follower's count, sorted.
  const per = ((await t.db.execute(sql`select count(*)::int as n from follows f join users u on u.id = f.user_id where u.deleted_at is null group by f.user_id`)) as any[])
    .map((r) => r.n as number)
    .sort((x, y) => x - y);
  const disc = (p: number) => per[Math.max(0, Math.ceil(p * per.length) - 1)]; // percentile_disc: the first count reaching p
  assert.equal(per.length, b.follows.following);
  assert.equal(b.follows.p50, disc(0.5));
  assert.equal(b.follows.p90, disc(0.9));
  assert.equal(b.deletions.pending - a.deletions.pending, 1);
  assert.equal(b.deletions.month - a.deletions.month, 1);
});

test("5b cities: top 10 then Others", async () => {
  const rowsIn = Array.from({ length: 11 }, (_, i) => Array.from({ length: 20 - i }, () => ({ city: `ZZ-City-${String(i).padStart(2, "0")}` }))).flat();
  await t.db.insert(users).values(rowsIn);
  const { cities } = await stats();
  assert.equal(cities.length, 11);
  assert.deepEqual(cities.slice(0, 10).map((c: any) => c.name), Array.from({ length: 10 }, (_, i) => `ZZ-City-${String(i).padStart(2, "0")}`));
  assert.equal(cities[0].count, 20);
  assert.equal(cities[10].name, "Others");
  assert.ok(cities[10].count >= 10); // ZZ-City-10's 10, plus any other file's
});

// Percentiles as Postgres takes them: disc the first value reaching p, cont the value between the two around p*(n-1).
const disc = (xs: number[], p: number) => (xs.length ? xs[Math.max(0, Math.ceil(p * xs.length) - 1)]! : null);
const cont = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const i = p * (xs.length - 1), lo = Math.floor(i);
  return xs[lo]! + (xs[Math.min(lo + 1, xs.length - 1)]! - xs[lo]!) * (i - lo);
};
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
const nums = async (q: ReturnType<typeof sql>) => ((await t.db.execute(q)) as any[]).map((r) => Number(r.n)).sort((x, y) => x - y);

test("11 bookings, check-in and revenue; revenue for Money holders only", async () => {
  const people = await stats();
  assert.equal(people.revenue, null); // People without Money: no money read at all
  const banker = await join();
  for (const feature of ["people", "money"] as const)
    await t.db.insert(staffGrants).values({ userId: banker.me.id, feature, addedBy: banker.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  const money = async () => {
    const r = await get("/galaxy/analytics", banker.access, "galaxy");
    assert.equal(r.status, 200);
    return (await r.json()) as any;
  };
  const a = await money();
  assert.ok(a.revenue);

  const owner = await newUser(new Date());
  const [h] = await t.db.insert(hosts).values({ name: "H", slug: `h-${randomUUID()}`, kind: "venue", city: "Hyderabad", ownerId: owner, createdBy: owner }).returning({ id: hosts.id });
  const ev = async (status: "published" | "cancelled", endsAgo: number | null, startsAgo: number) => {
    const [e] = await t.db
      .insert(events)
      .values({ hostId: h!.id, slug: `e-${randomUUID()}`, title: "E", status, startsAt: new Date(t.now() - startsAgo), endsAt: endsAgo === null ? null : new Date(t.now() - endsAgo), createdBy: owner })
      .returning({ id: events.id });
    const [tt] = await t.db.insert(ticketTypes).values({ eventId: e!.id, name: "General", pricePaise: 10_000 }).returning({ id: ticketTypes.id });
    return { id: e!.id, tt: tt!.id };
  };
  const E1 = await ev("published", 2 * DAY, 2 * DAY + 3 * 3_600_000); // ended 2 days ago
  const E2 = await ev("published", null, 5 * DAY); // no end: ended at its start, 5 days ago
  const E3 = await ev("cancelled", 3 * DAY, 3 * DAY + 3_600_000); // cancelled: never counted for check-in
  const E4 = await ev("published", -DAY, -DAY + 3_600_000); // still to come
  const E5 = await ev("published", 40 * DAY, 40 * DAY + 3_600_000); // ended too long ago
  const book = async (e: { id: string; tt: string }, quantity: number, o: Partial<typeof bookings.$inferInsert> = {}) =>
    (await t.db
      .insert(bookings)
      .values({ userId: await newUser(new Date()), eventId: e.id, ticketTypeId: e.tt, quantity, qr: randomUUID(), code: randomUUID(), createdAt: at(3), ...o })
      .returning({ id: bookings.id }))[0]!.id;
  const b1 = await book(E1, 3, { admitted: 3, createdAt: at(3) });
  await book(E1, 1, { source: "host", createdAt: at(3) });
  await book(E1, 2, { status: "cancelled", createdAt: at(4) });
  const b2 = await book(E2, 4, { admitted: 1, source: "other", createdAt: at(6) });
  await book(E3, 2, { admitted: 2, createdAt: at(6) });
  const b4 = await book(E4, 1, { createdAt: at(1) });
  await book(E5, 1, { admitted: 1, createdAt: at(45) }); // made before the window
  const pay = async (e: { id: string; tt: string }, bookingId: string | null, amountPaise: number, status: "paid" | "refunded" | "failed", createdAt: Date) =>
    (await t.db
      .insert(payments)
      .values({ kind: "ticket", userId: owner, hostId: h!.id, eventId: e.id, ticketTypeId: e.tt, quantity: 1, unitPricePaise: amountPaise, plan: "3+2", buyerFeeBps: 300, buyerFeePaise: amountPaise * 0.03, commissionBps: 200, commissionPaise: amountPaise * 0.02, feeIncluded: false, amountPaise, razorpayOrderId: `order_${randomUUID()}`, status, bookingId, createdAt, updatedAt: createdAt })
      .returning({ id: payments.id }))[0]!.id;
  await pay(E1, b1, 30_000, "paid", at(3));
  const refundedPay = await pay(E2, b2, 50_000, "refunded", at(6));
  await pay(E4, b4, 10_000, "failed", at(1)); // never landed: b4 stays free
  await pay(E5, null, 70_000, "paid", at(40)); // too old
  await t.db.update(payments).set({ razorpayPaymentId: "pay_x" }).where(eq(payments.id, refundedPay));
  const refund = (amountPaise: number, status: "processed" | "requested", createdAt: Date, razorpayPaymentId = "pay_x") =>
    t.db.insert(refunds).values({ paymentId: refundedPay, razorpayPaymentId, amountPaise, reason: "Test", kind: "staff", status, createdAt, updatedAt: createdAt });
  await refund(50_000, "processed", at(2));
  await refund(1_000, "requested", at(2)); // not processed yet
  await refund(2_000, "processed", at(40)); // too old
  await refund(4_000, "processed", at(2), "pay_twice"); // a second Razorpay payment on the order: never in gross

  const b = await money();
  const pb = await stats();
  assert.equal(pb.revenue, null);
  assert.deepEqual(pb.bookings, b.bookings); // the same counts for People holders
  const k = (x: any, y: any, keys: string[]) => keys.map((key) => y[key] - x[key]);
  assert.deepEqual(k(a.bookings, b.bookings, ["total", "confirmed", "cancelled", "tickets", "paid", "free"]), [6, 5, 1, 11, 2, 3]);
  const dd = (d: number) => b.bookings.days.find((x: any) => x.day === dayAgo(d)).count - a.bookings.days.find((x: any) => x.day === dayAgo(d)).count;
  assert.deepEqual([dd(1), dd(3), dd(4), dd(6)], [1, 2, 1, 2]);
  assert.equal(b.bookings.days.length, 30);
  const s = delta(a.bookings.sources, b.bookings.sources);
  assert.deepEqual([s["Orbit app"], s["Host"], s["Other"]], [3, 1, 1]);
  const from30 = new Date(Date.parse(`${dayAgo(29)}T00:00:00Z`) - IST).toISOString();
  const q = await nums(sql`select quantity as n from bookings where status = 'confirmed' and created_at >= ${from30}::timestamptz`);
  assert.deepEqual(b.bookings.perBooking, { p50: disc(q, 0.5), p90: disc(q, 0.9) });

  assert.deepEqual(k(a.checkIn, b.checkIn, ["events", "tickets", "admitted"]), [2, 8, 4]);
  const nowTs = new Date(t.now()).toISOString();
  const shares = await nums(
    sql`select sum(b.admitted)::float / sum(b.quantity) as n from events e join bookings b on b.event_id = e.id and b.status = 'confirmed' where e.status = 'published' and coalesce(e.ends_at, e.starts_at) >= ${from30}::timestamptz and coalesce(e.ends_at, e.starts_at) < ${nowTs}::timestamptz group by e.id`,
  );
  assert.ok(shares.includes(0.75) && shares.includes(0.25));
  assert.equal(shares.length, b.checkIn.events);
  assert.equal(b.checkIn.rate, r2(b.checkIn.admitted / b.checkIn.tickets));
  assert.deepEqual([b.checkIn.p50, b.checkIn.p10], [r2(cont(shares, 0.5)), r2(cont(shares, 0.1))]);

  assert.deepEqual(k(a.revenue, b.revenue, ["gross", "orbit", "refunded", "payments"]), [80_000, 1_500, 50_000, 2]);
  const rd = (d: number) => b.revenue.days.find((x: any) => x.day === dayAgo(d)).count - a.revenue.days.find((x: any) => x.day === dayAgo(d)).count;
  assert.deepEqual([rd(3), rd(6), rd(1)], [30_000, 50_000, 0]);
  const kd = delta(a.revenue.kinds, b.revenue.kinds);
  assert.deepEqual([kd["Tickets"], kd["Slots"]], [80_000, 0]);
  const amounts = await nums(sql`select amount_paise as n from payments where status in ('paid', 'refundPending', 'refunded') and created_at >= ${from30}::timestamptz`);
  assert.deepEqual(b.revenue.order, { p50: disc(amounts, 0.5), p90: disc(amounts, 0.9) });
});

test("7 sweep", async () => {
  const day = (k: number) => dayAgo(k);
  const [p, q, r, gone] = [await newUser(new Date()), await newUser(new Date()), await newUser(new Date()), await newUser(new Date(), { deletedAt: new Date() })];
  await t.db.insert(activity).values([
    { userId: p, day: day(91), platform: "ios", version: "1.0.0" },
    { userId: p, day: day(91), platform: "android", version: "1.0.0" },
    { userId: q, day: day(91), platform: "ios", version: "1.0.0" },
    { userId: r, day: day(91), platform: "web", version: null },
    { userId: p, day: day(95), platform: "app", version: null },
    { userId: p, day: day(90), platform: "ios", version: "1.0.0" }, // the oldest day swept
    { userId: q, day: day(89), platform: "ios", version: "1.0.0" }, // the oldest day kept
    { userId: gone, day: day(91), platform: "ios", version: "1.0.0" },
    { userId: gone, day: day(1), platform: "ios", version: "1.0.0" }, // recent, but the account is deleted
  ]);
  const ids = [p, q, r, gone];
  await sweepActivity(t.db, t.now());
  const days = await t.db.select().from(activityDays).where(inArray(activityDays.day, [day(91), day(95), day(90), day(89)]));
  const by = Object.fromEntries(days.map((d) => [d.day, d]));
  assert.deepEqual({ ...by[day(91)] }, { day: day(91), active: 3, ios: 2, android: 1, web: 1, app: 0 }); // not the deleted account
  assert.deepEqual({ ...by[day(95)] }, { day: day(95), active: 1, ios: 0, android: 0, web: 0, app: 1 });
  assert.deepEqual({ ...by[day(90)] }, { day: day(90), active: 1, ios: 1, android: 0, web: 0, app: 0 });
  assert.equal(by[day(89)], undefined);
  const left = await t.db.select().from(activity).where(inArray(activity.userId, ids));
  assert.deepEqual(left.map((x) => x.day), [day(89)]);
  await sweepActivity(t.db, t.now());
  const again = await t.db.select().from(activityDays).where(inArray(activityDays.day, [day(91), day(95), day(90), day(89)]));
  assert.deepEqual(again.sort((a, b) => a.day.localeCompare(b.day)), days.sort((a, b) => a.day.localeCompare(b.day)));
  assert.equal((await t.db.select().from(activity).where(inArray(activity.userId, ids))).length, 1);
});

test("8 deleting an account deletes its activity", async () => {
  const u = await join();
  await get("/me", u.access, "ios/1.0.0");
  await until(async () => (await rows(u.me.id)).length >= 1);
  assert.equal((await rows(u.me.id)).length, 1);
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now() - 31 * DAY), deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, u.me.id));
  await runDeletions(t.db, async (x) => void t.notices.push(x), t.now());
  assert.ok((await t.db.select().from(users).where(eq(users.id, u.me.id)))[0]!.deletedAt);
  assert.equal((await rows(u.me.id)).length, 0);
});

test("9 an account already deleted writes no row", async () => {
  const u = await join();
  await t.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, u.me.id));
  const r = await get("/me", u.access, "ios/1.0.0"); // whether signedIn lets it through or not, no row
  console.log(`# deleted account's request: ${r.status}`);
  markActive(t.db, u.me.id, { platform: "ios", version: "1.0.0" } as any, t.now());
  const c = await join();
  await get("/me", c.access, "ios/1.0.0"); // control
  await until(async () => (await rows(c.me.id)).length >= 1);
  await settle();
  assert.equal((await rows(u.me.id)).length, 0);
});

test("10 the in-memory set resets at IST midnight", async () => {
  t.tick(DAY - ((t.now() + IST) % DAY) - 90_000); // 90s before the next IST midnight (18:30 UTC)
  const u = await join(); // ~60s before
  await get("/me", u.access, "ios/1.0.0");
  await until(async () => (await rows(u.me.id)).length >= 1);
  t.tick(120_000);
  await get("/me", u.access, "ios/1.0.0");
  await until(async () => (await rows(u.me.id)).length >= 2);
  const r = await rows(u.me.id);
  assert.equal(r.length, 2);
  assert.equal(new Date(Date.parse(`${r[1]!.day}T00:00:00Z`) - Date.parse(`${r[0]!.day}T00:00:00Z`)).getTime(), DAY);
  assert.equal(r[1]!.day, today());
});
