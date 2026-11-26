import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { testApp } from "./testkit.ts";
import { activity, auditLog, events, follows, hosts, interest, staffGrants, users, visit } from "./db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
const DAY = 86_400_000, HOUR = 3_600_000, IST = 330 * 60_000;
const ist = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
const midnight = (ms: number) => ms - ((ms + IST) % DAY);
// before() ticks to 13:00 IST (never back), so "1 hour ago" is today and rows can sit at known IST days.
before(async () => {
  t = await testApp();
  t.tick(((13 * HOUR - ((t.now() + IST) % DAY)) + DAY) % DAY);
});
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(7_000_000 + ++n * 11).padStart(9, "0")}`;
const e164 = (p: string) => `+91${p}`;
const join = async (p = phone()) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(e164(p)), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body } as { p: string; access: string; refresh: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const makeOwner = async (u: P) => {
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.platformOwner, true));
  await t.db.update(users).set({ platformOwner: true }).where(eq(users.id, u.me.id));
};
const give = async (u: P, ...features: string[]) => {
  for (const feature of features as any[])
    await t.db.insert(staffGrants).values({ userId: u.me.id, feature, addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
};
const dash = async (u: P) => (await as(u)("GET", "/galaxy/dashboard")).body;
// A moment on the IST day `k` days ago (0 = today), 30 minutes past that day's midnight.
const onDay = (k: number) => new Date(midnight(t.now()) - k * DAY + 30 * 60_000);
const byDay = (days: { day: string; count: number }[]) => Object.fromEntries(days.map((d) => [d.day, d.count]));
// after - before, per day
const dayDelta = (a: any, b: any) => {
  const x = byDay(a), y = byDay(b);
  return Object.fromEntries(Object.keys(y).map((d) => [d, (y[d] ?? 0) - (x[d] ?? 0)]));
};
const newUser = async (createdAt: Date, deletedAt?: Date) =>
  (await t.db.insert(users).values({ createdAt, deletedAt: deletedAt ?? null }).returning({ id: users.id }))[0]!.id;
// people.active comes from the activity log: one row per person and IST day, `ago` days back (0 = today).
const session = (userId: string, ago: number) => t.db.insert(activity).values({ userId, day: ist(t.now() - ago * DAY), platform: "app" });

// A reader holding people, hosts and staff, used for the delta tests.
let reader: P;
// Active today before the first read: a signed-in request marks it without waiting (activity.ts), so on a slow
// database the reader's own row could land between a test's two reads.
const getReader = async () => (reader ??= await (async () => {
  const u = await join();
  await give(u, "people", "hosts", "staff");
  await t.db.insert(activity).values({ userId: u.me.id, day: ist(t.now()), platform: "app" }).onConflictDoNothing();
  return u;
})());

test("1 gates: 401, 404, and each feature opens only its blocks, each read audited", async () => {
  assert.equal((await t.call("GET", "/galaxy/dashboard")).status, 401);
  const plain = await join();
  assert.equal((await as(plain)("GET", "/galaxy/dashboard")).status, 404);
  const keys = async (u: P) => {
    const r = await as(u)("GET", "/galaxy/dashboard");
    assert.equal(r.status, 200);
    return Object.keys(r.body).sort();
  };
  const withOnly = async (f: string) => { const u = await join(); await give(u, f); return u; };
  const q = await withOnly("queues");
  assert.deepEqual(await keys(q), []);
  assert.deepEqual(await keys(await withOnly("people")), ["people", "waitlist", "website"]);
  assert.deepEqual(await keys(await withOnly("hosts")), ["events", "hosts"]);
  assert.deepEqual(await keys(await withOnly("staff")), ["staff"]);
  const o = await join();
  await makeOwner(o);
  assert.deepEqual(await keys(o), ["events", "hosts", "people", "staff", "waitlist", "website"]);
  const mine = (await t.db.select().from(auditLog).where(eq(auditLog.actorId, q.me.id))).filter((a) => a.action === "dashboard.view");
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0]!.data, { blocks: [] });
  const owns = (await t.db.select().from(auditLog).where(eq(auditLog.actorId, o.me.id))).filter((a) => a.action === "dashboard.view");
  assert.deepEqual((owns[0]!.data as any).blocks.sort(), ["events", "hosts", "people", "staff", "waitlist", "website"]);
});

test("2 people: totals, windows, 30 days and active", async () => {
  const u = await getReader();
  const a = (await dash(u)).people;
  assert.equal(a.days.length, 30);
  assert.equal(a.days[29].day, ist(t.now()));
  assert.equal(a.days[0].day, ist(t.now() - 29 * DAY));
  const ids = [await newUser(onDay(0)), await newUser(onDay(3)), await newUser(onDay(9))];
  await newUser(onDay(1), new Date(t.now() - HOUR)); // deleted: never counts
  const gone = await newUser(onDay(2), new Date(t.now() - HOUR));
  await session(ids[0]!, 0);
  await session(ids[1]!, 3);
  await session(ids[2]!, 20);
  await session(await newUser(onDay(20)), 40);
  await session(gone, 0); // a deleted user's activity
  const b = (await dash(u)).people;
  assert.equal(b.total - a.total, 4); // the three, plus the 40-day-session user
  assert.equal(b.today - a.today, 1);
  assert.equal(b.week - a.week, 2);
  assert.equal(b.prevWeek - a.prevWeek, 1);
  const d = dayDelta(a.days, b.days);
  assert.equal(d[ist(onDay(0).getTime())], 1);
  assert.equal(d[ist(onDay(3).getTime())], 1);
  assert.equal(d[ist(onDay(1).getTime())], 0);
  assert.equal(b.active.day - a.active.day, 1);
  assert.equal(b.active.week - a.active.week, 2);
  assert.equal(b.active.month - a.active.month, 3);
});

test("3 waitlist: total, windows and days", async () => {
  const u = await getReader();
  const a = (await dash(u)).waitlist;
  for (const k of [0, 0, 3, 9]) await t.db.insert(interest).values({ createdAt: onDay(k) });
  const b = (await dash(u)).waitlist;
  assert.deepEqual([b.total - a.total, b.today - a.today, b.week - a.week, b.prevWeek - a.prevWeek], [4, 2, 3, 1]);
  const d = dayDelta(a.days, b.days);
  assert.equal(d[ist(onDay(0).getTime())], 2);
  assert.equal(d[ist(onDay(3).getTime())], 1);
  assert.equal(d[ist(onDay(9).getTime())], 1);
  assert.equal(Object.values(d).filter((x) => x !== 0).length, 3);
});

test("4 website: visitor-days, views, joins, 7-day limit", async () => {
  const u = await getReader();
  const a = (await dash(u)).website;
  const v = (visitor: string, at: Date, joined = false) =>
    t.db.insert(visit).values({ id: randomUUID(), at, visitor, path: "/", source: "direct", joined });
  const w = randomUUID();
  await v(w, new Date(onDay(0).getTime() + 60_000));
  await v(w, new Date(onDay(0).getTime() + 120_000), true); // same visitor, same day: one visitor, one join
  await v(w, onDay(2)); // another day: a second visitor-day
  await v(randomUUID(), onDay(8)); // older than 7 days: out
  const b = (await dash(u)).website;
  assert.equal(b.visitors - a.visitors, 2);
  assert.equal(b.views - a.views, 3);
  assert.equal(b.joined - a.joined, 1);
});

test("5 hosts and events", async () => {
  const u = await getReader();
  const a = await dash(u);
  const owner = await newUser(onDay(0));
  const host = async (status: "live" | "archived", verified: boolean, createdAt: Date) =>
    (await t.db.insert(hosts).values({ name: "H", slug: `h-${randomUUID()}`, kind: "venue", city: "Hyderabad", status, ownerId: owner, createdBy: owner, verifiedAt: verified ? new Date(t.now()) : null, createdAt }).returning({ id: hosts.id }))[0]!.id;
  const h1 = await host("live", true, onDay(1));
  const h2 = await host("live", false, onDay(10));
  const h3 = await host("archived", true, onDay(1));
  for (const [uid, h] of [[owner, h1], [owner, h3], [await newUser(onDay(0)), h1], [await newUser(onDay(0)), h2]] as const) await t.db.insert(follows).values({ userId: uid, hostId: h });
  const ev = (status: "draft" | "published" | "cancelled", startsAt: Date | null, publishedAt: Date | null = null) =>
    t.db.insert(events).values({ hostId: h1, slug: `e-${randomUUID()}`, title: "E", status, startsAt, publishedAt, createdBy: owner });
  await ev("published", new Date(t.now() + DAY), onDay(1)); // upcoming, this week
  await ev("published", new Date(t.now() - DAY), onDay(20)); // past: not upcoming, not this week
  await ev("draft", null);
  await ev("cancelled", new Date(t.now() + DAY));
  const b = await dash(u);
  assert.deepEqual(
    [b.hosts.total - a.hosts.total, b.hosts.verified - a.hosts.verified, b.hosts.week - a.hosts.week, b.hosts.follows - a.hosts.follows],
    [2, 1, 1, 3],
  );
  assert.deepEqual(
    [b.events.upcoming - a.events.upcoming, b.events.week - a.events.week, b.events.drafts - a.events.drafts, b.events.cancelled - a.events.cancelled],
    [1, 1, 1, 1],
  );
});

test("6 staff: started and unended grants count once, plus the owner", async () => {
  const u = await getReader();
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.platformOwner, true));
  const a = (await dash(u)).staff.active;
  const [p, q, r, s] = [await join(), await join(), await join(), await join()];
  await give(p, "people", "hosts"); // two features, one person
  await give(q, "queues");
  const grant = (user: P, extra: object) => t.db.insert(staffGrants).values({ userId: user.me.id, feature: "money", addedBy: user.me.id, addedAt: new Date(t.now() - 3 * DAY), ...extra });
  await grant(r, { startsAt: new Date(t.now() - 2 * DAY), endedAt: new Date(t.now() - DAY) }); // ended
  await grant(s, { startsAt: null }); // not started
  const o = await join();
  await makeOwner(o); // no grant row
  assert.equal((await dash(u)).staff.active - a, 3);
});
