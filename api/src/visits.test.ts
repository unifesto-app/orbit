import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { testApp } from "./testkit.ts";
import { auditLog, interest, staffGrants, users, visit } from "./db/schema.ts";
import { pruneVisits } from "./visits.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

// Every time here is pinned: the shared clock is moved (forward only) to fixed UTC instants in 2030, past any real time.
const DAY = 86_400_000;
const at = (iso: string) => new Date(iso).getTime();
const setNow = (iso: string) => {
  const d = at(iso) - t.now();
  assert.ok(d >= 0, `clock can't go back to ${iso}`);
  t.tick(d);
};
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const hit = (ip: string, body: unknown) =>
  t.app.request("/public/visit", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });
const view = async (ip: string, extra: object = {}, id = randomUUID()) => {
  const r = await hit(ip, { kind: "view", id, path: "/", userAgent: UA, ...extra });
  assert.equal(r.status, 204);
  return id;
};
const row = async (id: string) => (await t.db.select().from(visit).where(eq(visit.id, id)))[0];
const total = async () => (await t.db.select().from(visit)).length;
const base = (id: string, atIso: string, o: Partial<typeof visit.$inferInsert> = {}) => ({ id, at: new Date(atIso), visitor: id.slice(0, 8), path: "/", source: "Direct", ...o });

test("a view stores a row with source, app and os, and no address", async () => {
  setNow("2030-06-20T10:00:00Z");
  const id = await view("198.51.100.10", { referrer: "https://t.co/x", country: "IN", region: "MH", city: "Pune", userAgent: UA });
  const r = (await row(id))!;
  assert.deepEqual([r.source, r.app, r.os, r.path, r.city], ["X", "Chrome", "Android", "/", "Pune"]);
  assert.equal(r.visitor.length, 22);
  assert.deepEqual(Object.keys(r).sort(), ["app", "at", "city", "cls", "code", "country", "id", "inp", "joined", "lcp", "ms", "os", "path", "region", "source", "started", "ttfb", "visitor"]);
  const stored = JSON.stringify(r);
  for (const raw of ["198.51.100.10", "Mozilla", "t.co"]) assert.ok(!stored.includes(raw), raw); // no address, raw UA or referrer
  assert.equal(await total(), 1);
});

test("a visitor is the same browser on the same IST day, new after IST midnight or with another browser", async () => {
  setNow("2030-06-20T18:29:00Z"); // 23:59 IST
  const a = await view("198.51.100.11");
  const a2 = await view("198.51.100.11");
  const other = await view("198.51.100.11", { userAgent: UA + " Other" });
  setNow("2030-06-20T18:31:00Z"); // 00:01 IST the next day
  const b = await view("198.51.100.11");
  const [ra, ra2, ro, rb] = await Promise.all([a, a2, other, b].map(row));
  assert.equal(ra!.visitor, ra2!.visitor);
  assert.notEqual(ra!.visitor, ro!.visitor);
  assert.notEqual(ra!.visitor, rb!.visitor);
});

test("bots are answered 204 and not logged; a repeated id is stored once", async () => {
  setNow("2030-06-22T10:00:00Z");
  const n = await total();
  for (const userAgent of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "curl/8.4.0"]) await view("198.51.100.12", { userAgent });
  assert.equal(await total(), n);
  assert.equal((await hit("198.51.100.12", { kind: "view", id: randomUUID(), path: "/" })).status, 204); // a browser always sends a UA
  assert.equal(await total(), n);
  const id = await view("198.51.100.12");
  await view("198.51.100.12", {}, id);
  assert.equal(await total(), n + 1);
});

test("leave keeps the larger time, the newest vitals, and ignores views older than a day; start marks started", async () => {
  setNow("2030-06-23T10:00:00Z");
  const id = await view("198.51.100.13");
  const leave = (o: object, i = id) => hit("198.51.100.13", { kind: "leave", id: i, ...o });
  assert.equal((await leave({ ms: 5000, lcp: 1000, cls: 0.1 })).status, 204);
  await leave({ ms: 3000, lcp: 2000 });
  let r = (await row(id))!;
  assert.deepEqual([r.ms, r.lcp, r.cls, r.inp], [5000, 2000, 0.1, null]); // lcp replaced, cls kept
  await leave({ ms: 7000 });
  assert.equal((await row(id))!.ms, 7000);
  assert.equal((await row(id))!.started, false);
  await hit("198.51.100.13", { kind: "start", id });
  assert.equal((await row(id))!.started, true);

  const ghost = randomUUID(); // a view we never logged
  assert.equal((await leave({ ms: 1, lcp: 1 }, ghost)).status, 204);
  assert.equal((await hit("198.51.100.13", { kind: "start", id: ghost })).status, 204);
  assert.equal(await row(ghost), undefined);
  const old = randomUUID();
  await t.db.insert(visit).values(base(old, "2030-06-22T09:00:00Z")); // 25h ago
  await leave({ ms: 4000, lcp: 9 }, old);
  await hit("198.51.100.13", { kind: "start", id: old });
  r = (await row(old))!;
  assert.deepEqual([r.ms, r.lcp, r.started], [null, null, false]);
});

test("invalid bodies are refused and leave no row", async () => {
  const n = await total();
  const id = randomUUID();
  const bad: [unknown, number][] = [
    ["not json", 400],
    [{ kind: "view", id: "nope", path: "/" }, 400],
    [{ kind: "view", id, path: "/admin" }, 400],
    [{ kind: "view", id, path: "/", userAgent: "x\u0000" }, 400],
    [{ kind: "wat", id }, 400],
    [{ kind: "leave", id, ms: -1 }, 400],
    [{ kind: "view", id, path: "/", referrer: "r".repeat(9000) }, 400],
  ];
  for (const [b, status] of bad) assert.equal((await hit("198.51.100.14", b)).status, status, JSON.stringify(b).slice(0, 60));
  assert.equal(await total(), n);
});

test("120 hits a minute per address, then 429", async () => {
  setNow("2030-06-24T10:00:00Z");
  const out: number[] = [];
  for (let i = 0; i < 121; i++) out.push((await hit("198.51.100.15", { kind: "start", id: randomUUID() })).status);
  assert.deepEqual([out.slice(0, 120).every((s) => s === 204), out[120]], [true, 429]);
  assert.equal((await hit("198.51.100.16", { kind: "start", id: randomUUID() })).status, 204); // another address
});

// ---- the waitlist marks steps on the view ----
const sign = { name: "Riya Kapoor", email: "riya@example.com", dob: "2000-05-01", features: [] as string[] };
const wl = async (path: string, ip: string, body: unknown) =>
  (await t.app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) })).status;
const code = async (phone: string, ip: string, extra: object = {}) => {
  t.tick(30_000);
  assert.equal(await wl("/public/interest/code", ip, { phone, ...extra }), 200);
  return t.lastCode(`+91${phone}`)!;
};
const seed = async (iso = new Date(t.now()).toISOString()) => {
  const id = randomUUID();
  await t.db.insert(visit).values(base(id, iso));
  return id;
};
const steps = async (id: string) => {
  await new Promise((r) => setTimeout(r, 100)); // the code mark is not awaited by the send
  const r = (await row(id))!;
  return [r.code, r.joined];
};

test("a code send marks code; a new join marks joined; a repeat join does not; bad views never fail", async () => {
  setNow("2030-06-25T10:00:00Z");
  const ip = "198.51.100.20";
  const v1 = await seed();
  const c1 = await code("9900000001", ip, { view: v1 });
  assert.deepEqual(await steps(v1), [true, false]);
  assert.equal(await wl("/public/interest", ip, { ...sign, phone: "9900000001", code: c1, view: v1 }), 204);
  assert.deepEqual(await steps(v1), [true, true]);

  // the same phone again, from another view: sent, joined (nothing new), not marked joined
  const v2 = await seed();
  const c2 = await code("9900000001", ip, { view: v2 });
  assert.equal(await wl("/public/interest", ip, { ...sign, phone: "9900000001", code: c2, view: v2 }), 204);
  assert.deepEqual(await steps(v2), [true, false]);

  // a view older than a day is not marked
  const stale = await seed("2030-06-23T10:00:00Z");
  await code("9900000002", ip, { view: stale });
  assert.deepEqual(await steps(stale), [false, false]);

  // junk, unknown or absent views change nothing and fail nothing
  for (const [i, v] of ["not-a-uuid", randomUUID(), undefined, 42].entries()) {
    const phone = `990000001${i}`;
    const c = await code(phone, ip, { view: v });
    assert.equal(await wl("/public/interest", ip, { ...sign, phone, code: c, view: v }), 204);
    assert.equal((await t.db.select().from(interest).where(eq(interest.phone, `+91${phone}`))).length, 1);
  }
});

test("pruneVisits deletes rows older than 180 days and keeps newer ones", async () => {
  setNow("2030-07-01T10:00:00Z");
  const now = t.now();
  const [gone, kept] = [randomUUID(), randomUUID()];
  await t.db.insert(visit).values([base(gone, new Date(now - 180 * DAY - 60_000).toISOString()), base(kept, new Date(now - 179 * DAY).toISOString())]);
  await pruneVisits(t.db, now);
  assert.equal(await row(gone), undefined);
  assert.ok(await row(kept));
});

// ---- Galaxy stats ----
test("website stats: People only, audited, summed in IST days", async () => {
  setNow("2030-08-10T10:00:00Z"); // 15:30 IST, 10 Aug
  const P = "/galaxy/website/stats";
  const phone = "9811000001";
  t.tick(30_000);
  await t.call("POST", "/auth/code", { to: phone });
  const v = await t.call("POST", "/auth/code/verify", { to: phone, code: t.lastCode(`+91${phone}`), device: { name: "iPhone", client: "app" } });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device: { name: "iPhone", client: "app" } });
  const { access, me } = s.body as { access: string; me: { id: string } };
  assert.equal((await t.call("GET", P)).status, 401);
  const grant = (feature: "hosts" | "people") =>
    t.db.insert(staffGrants).values({ userId: me.id, feature, addedBy: me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  await grant("hosts");
  assert.equal((await t.call("GET", P, undefined, access)).status, 404);
  await grant("people");

  await t.db.delete(visit);
  const id = () => randomUUID();
  const ig = "Mozilla/5.0 (Linux; Android 13) Chrome/120.0 Mobile Safari/537.36 Instagram 300.0.0";
  const pune = { country: "IN", region: "MH", city: "Pune" };
  await t.db.insert(visit).values([
    // v1: Instagram first, then a Direct view; reached started, code and joined
    base(id(), "2030-08-10T04:00:00Z", { visitor: "v1", source: "Instagram", app: "Instagram", os: "Android", ms: 2000, lcp: 1000, cls: 0.1, started: true, code: true, joined: true, ...pune }),
    base(id(), "2030-08-10T05:00:00Z", { visitor: "v1", source: "Direct", app: "Chrome", os: "Android", ms: 4000, lcp: 2000, cls: 0.2, ...pune }),
    // v2: 18:40Z the day before is 00:10 IST on the 10th
    base(id(), "2030-08-09T18:40:00Z", { visitor: "v2", path: "/terms", source: "Direct", app: "Chrome", os: "iPhone", ms: 10000, lcp: 3000, cls: 0.3, started: true, country: "IN", city: "Mumbai" }),
    // v3: three days back
    base(id(), "2030-08-07T12:00:00Z", { visitor: "v3", source: "X", app: "Chrome", os: "Android", ms: 9000, lcp: 4000, cls: 0.4, ...pune }),
    // outside the 30 days (but the first ever logged), and a path the contract doesn't list
    base(id(), "2030-06-30T03:30:00Z", { visitor: "v4", source: "Direct", ms: 1 }),
    base(id(), "2030-08-10T06:00:00Z", { visitor: "v5", path: "/admin", source: "Direct", ms: 1000 }),
  ]);
  const before = (await t.db.select().from(auditLog).where(eq(auditLog.action, "website.stats"))).length;
  const r = await t.call("GET", P, undefined, access);
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.since, "2030-06-30");
  assert.equal(b.days.length, 30);
  assert.deepEqual([b.days[0].day, b.days.at(-1).day], ["2030-07-12", "2030-08-10"]);
  const day = (d: string) => b.days.find((x: any) => x.day === d);
  assert.deepEqual(day("2030-08-10"), { day: "2030-08-10", visitors: 3, views: 4, joined: 1 }); // v1, v2 (00:10 IST), v5
  assert.deepEqual(day("2030-08-07"), { day: "2030-08-07", visitors: 1, views: 1, joined: 0 });
  assert.equal(b.days.find((x: any) => x.day === "2030-06-30"), undefined);
  assert.deepEqual([b.visitors, b.views], [4, 5]);
  assert.deepEqual(b.today, { visitors: 3, views: 4 });
  assert.deepEqual(b.funnel, { visitors: 4, started: 2, code: 1, joined: 1 });
  const src = Object.fromEntries(b.sources.map((x: any) => [x.name, x]));
  assert.deepEqual(src.Instagram, { name: "Instagram", visitors: 1, joined: 1 }); // v1 once, by its first view
  assert.deepEqual(src.Direct, { name: "Direct", visitors: 2, joined: 0 }); // v2, v5
  assert.deepEqual(src.X, { name: "X", visitors: 1, joined: 0 });
  assert.equal(b.pages.length, 2); // /admin left out
  const pg = Object.fromEntries(b.pages.map((x: any) => [x.name, x]));
  assert.deepEqual(pg["/"], { name: "/", views: 3, visitors: 2, seconds: 4 }); // 2000, 4000, 9000
  assert.deepEqual(pg["/terms"], { name: "/terms", views: 1, visitors: 1, seconds: 10 });
  assert.equal(b.seconds, 4); // median of 1000, 2000, 4000, 9000, 10000 (v5, v4's 1 ms is outside)
  const tl = (l: any[]) => Object.fromEntries(l.map((x) => [x.name, x.count]));
  assert.deepEqual(tl(b.os), { Android: 2, iPhone: 1 }); // v1, v3 (v5 has no os)
  assert.deepEqual(tl(b.apps), { Chrome: 3, Instagram: 1 });
  assert.deepEqual(tl(b.countries), { IN: 3 });
  assert.deepEqual(tl(b.cities), { "Pune, MH": 2, Mumbai: 1 });
  assert.deepEqual(b.vitals, { lcp: 3250, inp: null, cls: 0.325, ttfb: null, samples: 4 });
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.action, "website.stats"))).length, before + 1);

  // top 12 and "Others": 14 sources (one visitor each), cities likewise
  await t.db.delete(visit);
  await t.db.insert(visit).values(
    Array.from({ length: 14 }, (_, i) => base(id(), "2030-08-10T05:00:00Z", { visitor: `s${i}`, source: `site${String(i).padStart(2, "0")}.example`, city: `City${String(i).padStart(2, "0")}`, joined: i === 13 })),
  );
  const m = (await t.call("GET", P, undefined, access)).body;
  assert.equal(m.sources.length, 13);
  assert.deepEqual(m.sources.at(-1), { name: "Others", visitors: 2, joined: 1 });
  assert.equal(m.cities.length, 13);
  assert.deepEqual(m.cities.at(-1), { name: "Others", count: 2 });
});

// Last, so no count above sees its row; it keeps the clock where it is.
test("the waitlist's own page is a page of its own; an unknown one is refused", async () => {
  const id = await view("198.51.100.30", { path: "/waitlist" });
  assert.equal((await row(id))!.path, "/waitlist");
  assert.equal((await hit("198.51.100.30", { kind: "view", id: randomUUID(), path: "/nope", userAgent: UA })).status, 400);
});
