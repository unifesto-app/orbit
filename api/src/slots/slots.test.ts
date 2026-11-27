import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { testApp } from "../testkit.ts";
import { auditLog, hosts, slotAlerts, staffGrants, stationClaims, stations, users, venues } from "../db/schema.ts";
import { runDeletions } from "../auth/deletion.ts";
import { sweepSlotAlerts } from "./alerts.ts";
import { confirmHold, hold } from "./hold.ts";

// The slots API against a real database. Every test starts a fresh world and moves the clock to 6:20 PM India time.
const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(5_000_000 + ++n * 13).padStart(9, "0")}`;
const e164 = (p: string) => `+91${p}`;
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, IST = 330 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const ist = (ms: number) => { const d = new Date(ms + IST); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

type T = Awaited<ReturnType<typeof testApp>>;
type U = { p: string; access: string; refresh: string; me: { id: string }; name: string };

async function world(opts: { hostC?: boolean } = {}) {
  const t = await testApp();
  const verify = async (to: string) => {
    t.tick(30_000);
    assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
    return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(e164(to)), device });
  };
  const join = async (name: string): Promise<U> => {
    const p = phone();
    const v = await verify(p);
    const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name, dob: "2000-05-01", device });
    assert.equal(s.body.step, "signedIn");
    return { p, name, ...s.body };
  };
  // Access tokens last 15 minutes and the clock moves a lot: renew on a 401, one at a time per person.
  const locks = new Map<U, Promise<void>>();
  const renew = (u: U) => {
    if (!locks.has(u)) locks.set(u, (async () => {
      const r = await t.call("POST", "/auth/refresh", { refresh: u.refresh });
      assert.equal(r.status, 200);
      u.access = r.body.access; u.refresh = r.body.refresh;
      locks.delete(u);
    })());
    return locks.get(u)!;
  };
  const as = (u: U) => async (m: string, path: string, body?: unknown) => {
    let r = await t.call(m, path, body, u.access);
    if (r.status === 401) { await renew(u); r = await t.call(m, path, body, u.access); }
    return r;
  };

  const admin = await join("Asha Rao");
  const desk = await join("Dev Nair");
  const stranger = await join("Sam Stranger");
  const booker = await join("Meera Pillai");
  const booker2 = await join("Kabir Shah");
  const mk = async (name: string, kind: string) => {
    const r = await as(admin)("POST", "/hosts", { name, kind, city: "Hyderabad" });
    assert.equal(r.status, 201);
    return r.body.id as string;
  };
  const A = await mk("Pixel Lounge", "venue");
  const B = await mk("Turf Park", "venue");
  const C = await mk("Plain Club", "other");
  // The Desk seat, through the real flow.
  const inv = await as(admin)("POST", `/hosts/${A}/team`, { to: desk.p, role: "desk" });
  assert.equal(inv.status, 201);
  const acc = await as(desk)("POST", `/invites/${inv.body.id}/accept`);
  assert.equal(acc.status, 200);
  // Fixed India time: the next 6:20 PM.
  t.tick(((66_000_000 - ((t.now() + IST) % DAY)) + DAY) % DAY);
  assert.equal(ist(t.now()), "18:20");

  const base = t.now();
  const setup = (h: string, week: unknown) =>
    as(admin)("PUT", `/venues/${h}`, { address: "1 Road", area: "Madhapur", lat: 17.4, lng: 78.4, deskPhone: "+914012345678", week });
  const everyDay = (h: [number, number]) => Array(7).fill(h);
  const station = async (h: string, body: object) => {
    const r = await as(admin)("POST", `/venues/${h}/stations`, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body as { id: string };
  };
  const pc = (count = 12, name = "Gaming PC") => ({ name, unit: "PC", count, pricePaise: 10000, tile: "gaming", coopPaise: 15000 });
  const claim = async (stationId: string, userId: string | null, startMs: number, endMs: number, count: number) =>
    (await t.db.insert(stationClaims).values({ stationId, kind: "booking", status: "paid", count, startsAt: new Date(startMs), endsAt: new Date(endMs), userId }).returning())[0]!;
  const day = async (u: U, h: string) => {
    const r = await as(u)("GET", `/venues/${h}/day`);
    assert.equal(r.status, 200);
    return r.body as { claims: any[]; free: Record<string, { at: string; free: number }[]>; stations: any[] };
  };
  const freeAt = (d: Awaited<ReturnType<typeof day>>, sid: string, ms: number) => d.free[sid]!.find((f) => f.at === iso(ms))!.free;
  // booked + walk-in + block never above count at any step, from the stored claims.
  const invariant = async (sid: string, cnt: number) => {
    const rows = await t.db.select().from(stationClaims).where(eq(stationClaims.stationId, sid));
    const live = rows.filter((r) => ["paid", "checked_in", "freed", "ended"].includes(r.status) || (r.status === "held" && r.holdEndsAt! > new Date(t.now())));
    for (let at = base - DAY; at < base + 2 * DAY; at += 30 * MIN)
      assert.ok(live.filter((r) => r.startsAt.getTime() <= at && at < r.endsAt.getTime()).reduce((s, r) => s + r.count, 0) <= cnt, `over capacity at ${iso(at)}`);
  };
  const wi = (u: U, h: string, stationId: string, hours: number, count: number) => as(u)("POST", `/venues/${h}/walk-ins`, { stationId, hours, count });
  return { t, as, admin, desk, stranger, booker, booker2, A, B, C, base, setup, everyDay, station, pc, claim, day, freeAt, invariant, wi };
}

test("setting up a venue and its stations", async () => {
  const w = await world();
  const { t, as, admin, A, B, C } = w;
  try {
    // A host that isn't a venue has nothing here.
    assert.equal((await w.setup(C, w.everyDay([11, 26]))).status, 404);
    // Stations need the venue first.
    const early = await as(admin)("POST", `/venues/${A}/stations`, w.pc());
    assert.equal(early.status, 409);
    assert.equal(early.body.error, "noVenue");
    assert.equal((await w.setup(A, w.everyDay([11, 26]))).status, 201);
    assert.equal((await w.setup(A, w.everyDay([11, 26]))).status, 200);
    assert.equal((await w.setup(B, w.everyDay([6, 24]))).status, 201);

    const g = await w.station(A, w.pc());
    assert.equal((g as any).step, 30);
    assert.equal((g as any).whole, false);
    const sp = (await as(admin)("POST", `/venues/${B}/stations`, { name: "Turf", unit: "pitch", count: 1, pricePaise: 80000, tile: "sports", coopPaise: 5000, games: "football" })).body;
    assert.equal(sp.step, 60);
    assert.equal(sp.whole, true);
    assert.equal(sp.coopPaise, null);
    assert.equal(sp.games, null);

    // Off-peak must be cheaper.
    const dear = { from: 6, to: 10, weekdays: true, pricePaise: 10000 };
    assert.equal((await as(admin)("POST", `/venues/${A}/stations`, { ...w.pc(), offPeak: dear })).status, 400);
    assert.equal((await as(admin)("PATCH", `/venues/${A}/stations/${g.id}`, { offPeak: dear })).status, 400);

    const got = await as(admin)("GET", `/venues/${A}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.stations[0].pricePaise, 10000);
    assert.equal(got.body.stations[0].coopPaise, 15000);
  } finally {
    await t.close();
  }
});

test("desk runs the counter but sees no setup or price", async () => {
  const w = await world();
  const { t, as, admin, desk, stranger, booker, A, C } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc());
    const solo = await w.station(A, w.pc(1, "Solo"));
    const d = as(desk);

    assert.equal((await d("GET", `/venues/${A}/day`)).status, 200);
    // A walk-in, freed again.
    assert.equal((await d("POST", `/venues/${A}/walk-ins`, { stationId: s.id, hours: 1, count: 1 })).status, 201);
    assert.equal((await d("POST", `/venues/${A}/walk-ins/free`, { stationId: s.id })).status, 200);
    // A block, added then removed.
    const blk = await d("POST", `/venues/${A}/blocks`, { stationId: solo.id, hours: 1, count: 1, why: "Cleaning" });
    assert.equal(blk.status, 201);
    assert.equal((await d("DELETE", `/venues/${A}/blocks/${blk.body.id}`)).status, 204);
    // Admit and release.
    const soon = await w.claim(s.id, booker.me.id, w.base + 10 * MIN, w.base + 70 * MIN, 2);
    assert.equal((await d("POST", `/venues/${A}/claims/${soon.id}/admit`, { total: 2 })).status, 200);
    const late = await w.claim(s.id, booker.me.id, w.base - 20 * MIN, w.base + 40 * MIN, 2);
    assert.equal((await d("POST", `/venues/${A}/claims/${late.id}/release`)).status, 200);

    // Setup and prices are the Admin's.
    assert.equal((await d("GET", `/venues/${A}`)).status, 404);
    assert.equal((await d("PUT", `/venues/${A}`, { address: "1 Road", area: "X", lat: 17.4, lng: 78.4, deskPhone: "+914012345678", week: w.everyDay([11, 26]) })).status, 404);
    assert.equal((await d("POST", `/venues/${A}/stations`, w.pc())).status, 404);
    assert.equal((await d("PATCH", `/venues/${A}/stations/${s.id}`, { count: 5 })).status, 404);

    // No price anywhere in the day.
    const body = (await d("GET", `/venues/${A}/day`)).body;
    const keys: string[] = [];
    const walk = (x: unknown) => { if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { keys.push(k); walk(v); } };
    walk(body);
    assert.ok(keys.length > 10);
    assert.deepEqual(keys.filter((k) => /price|coop|offpeak/i.test(k)), []);

    // Strangers and followers with no seat get nothing, anywhere.
    await as(stranger)("POST", `/hosts/${A}/follow`);
    const claimId = soon.id;
    for (const u of [stranger, booker]) {
      const x = as(u);
      const calls: [string, string, unknown?][] = [
        ["GET", `/venues/${A}`],
        ["PUT", `/venues/${A}`, { address: "1 Road", area: "X", lat: 17.4, lng: 78.4, deskPhone: "+914012345678", week: w.everyDay([11, 26]) }],
        ["POST", `/venues/${A}/stations`, w.pc()],
        ["PATCH", `/venues/${A}/stations/${s.id}`, { count: 5 }],
        ["GET", `/venues/${A}/day`],
        ["POST", `/venues/${A}/walk-ins`, { stationId: s.id, hours: 1, count: 1 }],
        ["POST", `/venues/${A}/walk-ins/free`, { stationId: s.id }],
        ["POST", `/venues/${A}/blocks`, { stationId: s.id, hours: 1, count: 1, why: "x" }],
        ["DELETE", `/venues/${A}/blocks/${blk.body.id}`],
        ["POST", `/venues/${A}/claims/${claimId}/admit`, { total: 1 }],
        ["POST", `/venues/${A}/claims/${claimId}/release`],
      ];
      for (const [m, p, b] of calls) assert.equal((await x(m, p, b)).status, 404, `${u.name} ${m} ${p}`);
    }

    assert.deepEqual((await as(desk)("GET", "/me")).body.teams, [{ hostId: A, kind: "venue", name: "Pixel Lounge", owner: false, admin: false, desk: true, events: {} }]);
    const bad = await as(admin)("POST", `/hosts/${C}/team`, { to: phone(), role: "desk" });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "notVenue");
  } finally {
    await t.close();
  }
});

test("the last station goes to exactly one of several at once", async () => {
  const w = await world();
  const { t, admin, desk, stranger, booker, booker2, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const solo = await w.station(A, w.pc(1, "Solo"));
    const duo = await w.station(A, w.pc(2, "Duo"));
    // Fresh tokens so no renewals race inside the burst.
    for (const u of [admin, desk, stranger, booker, booker2]) await w.as(u)("GET", "/me");

    const rs = await Promise.all(Array.from({ length: 6 }, () => w.wi(admin, A, solo.id, 1, 1)));
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    const lost = rs.filter((r) => r.status !== 201);
    assert.equal(lost.length, 5);
    for (const r of lost) { assert.equal(r.status, 409); assert.equal(r.body.error, "noRoom"); }

    // Walk-ins and holds meeting on a station of two.
    const users = [admin, desk, stranger, booker, booker2];
    const mixed = await Promise.all([
      ...Array.from({ length: 4 }, () => w.wi(admin, A, duo.id, 1, 1)),
      ...users.slice(0, 4).map((u) => hold(t.db, { hostId: A, stationId: duo.id, userId: u.me.id, start: w.base + 10 * MIN, hours: 1, count: 1 }, t.now())),
    ]);
    const wins = mixed.filter((r: any) => r.status === 201 || r.ok === true).length;
    assert.ok(wins >= 1 && wins <= 2, `${wins} won on a station of 2`);

    const d = await w.day(admin, A);
    for (const sid of [solo.id, duo.id]) for (const f of d.free[sid]!) assert.ok(f.free >= 0);
    await w.invariant(solo.id, 1);
    await w.invariant(duo.id, 2);
  } finally {
    await t.close();
  }
});

test("a hold counts for ten minutes and then lapses by itself", async () => {
  const w = await world();
  const { t, admin, booker, booker2, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc());
    const seven = w.base + 40 * MIN;
    const h1 = await hold(t.db, { hostId: A, stationId: s.id, userId: booker.me.id, start: seven, hours: 1, count: 5 }, t.now());
    assert.equal(h1.ok, true);

    let d = await w.day(admin, A);
    assert.equal(w.freeAt(d, s.id, seven), 7);
    assert.equal(d.claims.find((c) => c.kind === "booking")?.status, "held");
    // Something that needs those seats is refused while the hold stands.
    const wiNo = await w.wi(admin, A, s.id, 2, 8);
    assert.equal(wiNo.status, 409);
    assert.equal(wiNo.body.error, "noRoom");
    const blockNo = await w.as(admin)("POST", `/venues/${A}/blocks`, { stationId: s.id, hours: 2, count: 8, why: "Event" });
    assert.equal(blockNo.status, 409);

    // Ten minutes on, the hold is nobody's.
    t.tick(10 * MIN);
    d = await w.day(admin, A);
    assert.equal(w.freeAt(d, s.id, seven), 12);
    assert.equal(d.claims.length, 0);

    // One hold at a time per person at a venue: the second lapses the first.
    const eight = w.base + 100 * MIN;
    const a = await hold(t.db, { hostId: A, stationId: s.id, userId: booker.me.id, start: eight, hours: 1, count: 12 }, t.now());
    const b = await hold(t.db, { hostId: A, stationId: s.id, userId: booker.me.id, start: eight, hours: 1, count: 12 }, t.now());
    assert.equal(a.ok && b.ok, true);
    const first = (await t.db.select().from(stationClaims).where(eq(stationClaims.id, (a as any).claim.id)))[0]!;
    assert.ok(first.holdEndsAt!.getTime() <= t.now());
    d = await w.day(admin, A);
    assert.deepEqual(d.claims.map((c) => c.id), [(b as any).claim.id]);
    // Someone else finds it full.
    const other = await hold(t.db, { hostId: A, stationId: s.id, userId: booker2.me.id, start: eight, hours: 1, count: 1 }, t.now());
    assert.deepEqual(other, { ok: false, error: "full" });

    // Refusals.
    const tryHold = (start: number, hours: number, count: number) =>
      hold(t.db, { hostId: A, stationId: s.id, userId: booker2.me.id, start, hours, count }, t.now());
    const bad = { ok: false, error: "badTime" };
    assert.deepEqual(await tryHold(w.base + 7 * MIN + 30 * MIN, 1, 1), bad); // 7:07 PM: off the grid
    assert.deepEqual(await tryHold(w.base - 30 * MIN, 1, 1), bad); // 5:50 PM... in the past
    assert.deepEqual(await tryHold(w.base - 20 * MIN - 30 * MIN + 30 * MIN, 1, 1), bad); // 6:00 PM, already gone
    assert.deepEqual(await tryHold(w.base + 14 * DAY + 10 * MIN, 1, 1), bad); // beyond 14 days
    assert.deepEqual(await tryHold(w.base - 20 * MIN + DAY + 7 * HOUR + 30 * MIN, 2, 1), bad); // 1:30 AM + 2 hours: past 2 AM
    assert.deepEqual(await tryHold(w.base + 10 * HOUR, 1, 13), { ok: false, error: "tooMany" });
  } finally {
    await t.close();
  }
});

test("walk-ins are refused with the time the desk can offer", async () => {
  const w = await world();
  const { t, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc());
    await w.claim(s.id, w.booker.me.id, w.base + 40 * MIN, w.base + 160 * MIN, 10); // 7 to 9 PM, 10 of 12
    const r1 = await w.wi(w.admin, A, s.id, 2, 3);
    assert.equal(r1.status, 409);
    assert.equal(r1.body.message, "3 free only until 7:00 PM");
    t.tick(50 * MIN); // 7:10 PM
    const r2 = await w.wi(w.admin, A, s.id, 1, 3);
    assert.equal(r2.status, 409);
    assert.equal(r2.body.message, "Only 2 free until 9:00 PM");
    // Before opening: 10 AM the next morning.
    t.tick(((10 * HOUR - ((t.now() + IST) % DAY)) + DAY) % DAY);
    const r3 = await w.wi(w.admin, A, s.id, 1, 1);
    assert.equal(r3.status, 409);
    assert.equal(r3.body.message, "Opens at 11:00 AM");
  } finally {
    await t.close();
  }
});

test("a walk-in starts at the step, and a freed one leaves its station free", async () => {
  const w = await world();
  const { t, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const solo = await w.station(A, w.pc(1, "Solo"));
    const trio = await w.station(A, w.pc(12, "Trio"));
    const first = await w.wi(w.admin, A, solo.id, 1, 1);
    assert.equal(first.status, 201);
    assert.equal(first.body.start, iso(w.base - 20 * MIN)); // 6:00 PM at 6:20 PM
    // Taken now; freed early, the same step is free again and starts at the current time.
    assert.equal((await w.wi(w.admin, A, solo.id, 1, 1)).status, 409);
    const freed = await w.as(w.desk)("POST", `/venues/${A}/walk-ins/free`, { stationId: solo.id });
    assert.equal(freed.status, 200);
    assert.equal(freed.body.status, "freed");
    const again = await w.wi(w.admin, A, solo.id, 1, 1);
    assert.equal(again.status, 201);
    assert.equal(again.body.start, iso(t.now()));

    // Freeing one of three leaves two.
    const three = await w.wi(w.admin, A, trio.id, 1, 3);
    assert.equal(three.status, 201);
    assert.equal((await w.as(w.admin)("POST", `/venues/${A}/walk-ins/free`, { stationId: trio.id })).status, 200);
    const d = await w.day(w.admin, A);
    const on = d.claims.filter((c) => c.stationId === trio.id && c.status === "checked_in");
    assert.equal(on.reduce((s, c) => s + c.count, 0), 2);
    assert.equal(w.freeAt(d, trio.id, w.base - 20 * MIN + 30 * MIN), 10);

    // Nothing on, nothing to free.
    const idle = await w.station(A, w.pc(2, "Idle"));
    const none = await w.as(w.admin)("POST", `/venues/${A}/walk-ins/free`, { stationId: idle.id });
    assert.equal(none.status, 409);
    assert.equal(none.body.error, "nothingToFree");
  } finally {
    await t.close();
  }
});

test("blocks are checked like walk-ins and can be lifted", async () => {
  const w = await world();
  const { t, as, admin, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc());
    const solo = await w.station(A, w.pc(1, "Solo"));
    await w.claim(s.id, w.booker.me.id, w.base + 40 * MIN, w.base + 160 * MIN, 10);
    const no = await as(admin)("POST", `/venues/${A}/blocks`, { stationId: s.id, hours: 2, count: 3, why: "Party" });
    assert.equal(no.status, 409);
    assert.equal(no.body.message, "3 free only until 7:00 PM");

    // A future block starts on the grid.
    const post = (start: number) => as(admin)("POST", `/venues/${A}/blocks`, { stationId: solo.id, hours: 1, count: 1, why: "Cleaning", start: iso(start) });
    assert.equal((await post(w.base + 115 * MIN)).status, 400); // 8:15 PM
    assert.equal((await post(w.base - 20 * MIN)).status, 400); // 6:00 PM, past
    const future = await post(w.base + 100 * MIN); // 8:00 PM
    assert.equal(future.status, 201);
    assert.equal(future.body.kind, "block");
    assert.equal(future.body.why, "Cleaning");
    assert.equal((await as(admin)("DELETE", `/venues/${A}/blocks/${future.body.id}`)).status, 204);
    assert.equal((await w.day(admin, A)).claims.some((c) => c.id === future.body.id), false);

    // A started block ends now; its station is free from now.
    const started = await as(admin)("POST", `/venues/${A}/blocks`, { stationId: solo.id, hours: 2, count: 1, why: "Repairs" });
    assert.equal(started.status, 201);
    assert.equal(w.freeAt(await w.day(admin, A), solo.id, w.base + 10 * MIN), 0);
    assert.equal((await as(admin)("DELETE", `/venues/${A}/blocks/${started.body.id}`)).status, 204);
    const row = (await t.db.select().from(stationClaims).where(eq(stationClaims.id, started.body.id)))[0]!;
    assert.equal(row.status, "ended");
    assert.equal(row.endsAt.getTime(), t.now());
    const d = await w.day(admin, A);
    assert.equal(w.freeAt(d, solo.id, w.base + 10 * MIN), 1);
    assert.equal(w.freeAt(d, solo.id, w.base + 40 * MIN), 1);
  } finally {
    await t.close();
  }
});

test("setup changes that strand bookings name them", async () => {
  const w = await world();
  const { t, as, admin, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc());
    const bk = await w.claim(s.id, w.booker.me.id, w.base + 40 * MIN, w.base + 160 * MIN, 10); // 7 to 9 PM
    const dow = new Date(w.base + IST).getUTCDay();
    const closedToday = w.everyDay([11, 26]).map((h, i) => (i === dow ? null : h));
    const early = w.everyDay([11, 20]);

    const few = await as(admin)("PATCH", `/venues/${A}/stations/${s.id}`, { count: 8 });
    assert.equal(few.status, 409);
    assert.equal(few.body.error, "inTheWay");
    assert.match(few.body.message, /Meera P\./);
    assert.match(few.body.message, /10 × Gaming PC/);
    assert.match(few.body.message, /7:00 PM to 9:00 PM/);
    assert.deepEqual(few.body.bookings.map((b: any) => b.id), [bk.id]);

    assert.equal((await as(admin)("PATCH", `/venues/${A}/stations/${s.id}`, { archived: true })).status, 409);
    for (const week of [closedToday, early]) {
      const r = await w.setup(A, week);
      assert.equal(r.status, 409);
      assert.equal(r.body.error, "inTheWay");
      assert.deepEqual(r.body.bookings.map((b: any) => b.id), [bk.id]);
    }

    // Once the booking is over, the same changes go through.
    t.tick(3 * HOUR);
    assert.equal((await w.setup(A, closedToday)).status, 200);
    assert.equal((await w.setup(A, early)).status, 200);
    assert.equal((await as(admin)("PATCH", `/venues/${A}/stations/${s.id}`, { count: 8 })).status, 200);
    assert.equal((await as(admin)("PATCH", `/venues/${A}/stations/${s.id}`, { archived: true })).status, 200);
  } finally {
    await t.close();
  }
});

test("walk-ins don't stand in the way of setup changes", async () => {
  const w = await world();
  const { t, as, admin, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc());
    assert.equal((await w.wi(admin, A, s.id, 3, 10)).status, 201);
    const dow = new Date(w.base + IST).getUTCDay();
    assert.equal((await as(admin)("PATCH", `/venues/${A}/stations/${s.id}`, { count: 5 })).status, 200);
    assert.equal((await w.setup(A, w.everyDay([11, 20]))).status, 200);
    assert.equal((await w.setup(A, w.everyDay([11, 26]).map((h, i) => (i === dow ? null : h)))).status, 200);
    assert.equal((await as(admin)("PATCH", `/venues/${A}/stations/${s.id}`, { archived: true })).status, 200);
  } finally {
    await t.close();
  }
});

test("admit lets people in at the start and release frees a no-show", async () => {
  const w = await world();
  const { t, as, admin, desk, booker, booker2, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc());
    const start = w.base + 40 * MIN; // 7:00 PM
    const here = await w.claim(s.id, booker.me.id, start, start + HOUR, 3);
    const gone = await w.claim(s.id, booker2.me.id, start, start + HOUR, 3);
    const admit = (u: typeof admin, id: string, total: number) => as(u)("POST", `/venues/${A}/claims/${id}/admit`, { total });
    const release = (id: string) => as(desk)("POST", `/venues/${A}/claims/${id}/release`);

    const early = await admit(admin, here.id, 2);
    assert.equal(early.status, 409);
    assert.equal(early.body.error, "early");

    t.tick(40 * MIN); // 7:00 PM
    const ok = await admit(admin, here.id, 2);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.admitted, 2);
    assert.equal(ok.body.status, "checked_in");
    assert.equal(ok.body.checkedInBy, "Asha Rao");
    const again = await admit(desk, here.id, 2);
    assert.equal(again.body.admitted, 2);
    assert.equal(again.body.checkedInAt, ok.body.checkedInAt);
    assert.equal(again.body.checkedInBy, "Asha Rao");
    assert.equal((await admit(desk, here.id, 1)).body.admitted, 2);

    const soon = await release(gone.id);
    assert.equal(soon.status, 409);
    assert.equal(soon.body.error, "tooEarly");
    assert.equal((await release(here.id)).status, 409); // they're in

    t.tick(15 * MIN);
    const done = await release(gone.id);
    assert.equal(done.status, 200);
    assert.equal(done.body.status, "released");
    assert.ok(t.notices.some((x) => x.kind === "slotReleased" && (x.to as any).userId === booker2.me.id));
    const after = await admit(admin, gone.id, 1);
    assert.equal(after.status, 409);
    assert.equal(after.body.error, "released");
    assert.equal((await t.db.select().from(stationClaims).where(and(eq(stationClaims.id, gone.id))))[0]!.status, "released");
  } finally {
    await t.close();
  }
});

test("a future block sees live holds, the step now is in reads from now, and repeats are safe", async () => {
  const w = await world();
  const { t, as, admin, desk, A } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const ps5 = await w.station(A, w.pc(1, "PS5"));
    // A live hold tomorrow at 11 AM, as it opens: a block over it is refused while the hold runs, by the real clock.
    const tomorrow11 = w.base - (18 * HOUR + 20 * MIN) + DAY + 11 * HOUR;
    const h = await hold(t.db, { hostId: A, stationId: ps5.id, userId: w.booker.me.id, start: tomorrow11, hours: 1, count: 1 }, t.now());
    assert.ok(h.ok);
    const blocked = await as(admin)("POST", `/venues/${A}/blocks`, { stationId: ps5.id, hours: 1, count: 1, why: "Party", start: iso(tomorrow11) });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, "noRoom");
    assert.deepEqual(await hold(t.db, { hostId: A, stationId: ps5.id, userId: w.booker2.me.id, start: tomorrow11 + HOUR, hours: 1, count: 0 }, t.now()), { ok: false, error: "badCount" });

    // One person's two holds at once, on two stations: the second lapses the first.
    const pcs = await w.station(A, w.pc(4, "PCs"));
    const eight = w.base + 100 * MIN;
    const both = await Promise.all([ps5.id, pcs.id].map((stationId) => hold(t.db, { hostId: A, stationId, userId: w.booker2.me.id, start: eight, hours: 1, count: 1 }, t.now())));
    assert.ok(both.every((r) => r.ok));
    const mine = await t.db.select().from(stationClaims).where(and(eq(stationClaims.userId, w.booker2.me.id), eq(stationClaims.status, "held")));
    assert.equal(mine.filter((r) => r.holdEndsAt!.getTime() > t.now()).length, 1);

    // A walk-in freed early: the cell now is in says free at once, as a new walk-in would find it.
    const solo = await w.station(A, w.pc(1, "Solo"));
    assert.equal((await w.wi(admin, A, solo.id, 1, 1)).status, 201);
    t.tick(5 * MIN); // 6:25 PM
    assert.equal((await as(desk)("POST", `/venues/${A}/walk-ins/free`, { stationId: solo.id })).status, 200);
    assert.equal(w.freeAt(await w.day(admin, A), solo.id, w.base - 20 * MIN), 1); // the 6:00 PM cell, read at 6:25

    // A host id that isn't one is nothing here, never a server error.
    const id = h.ok ? h.claim.id : "";
    assert.equal((await as(admin)("POST", `/venues/abc/claims/${id}/admit`, { total: 1 })).status, 404);
    assert.equal((await as(admin)("POST", `/venues/abc/claims/${id}/release`)).status, 404);
    assert.equal((await as(admin)("DELETE", `/venues/abc/blocks/${id}`)).status, 404);

    // Releasing twice: the same answer, and the booker is told once.
    const late = await w.claim(pcs.id, w.booker.me.id, w.base - 20 * MIN, w.base + 40 * MIN, 1);
    const r1 = await as(desk)("POST", `/venues/${A}/claims/${late.id}/release`);
    const r2 = await as(desk)("POST", `/venues/${A}/claims/${late.id}/release`);
    assert.deepEqual([r1.status, r2.status, r2.body.status], [200, 200, "released"]);
    assert.equal(t.notices.filter((x) => x.kind === "slotReleased" && x.data?.claimId === late.id).length, 1);
  } finally {
    await t.close();
  }
});

test("a Desk seat starts only on a Venue that can change its team, from a sitting Admin; a set-up Venue stays a Venue", async () => {
  const w = await world();
  const { t, as, admin, stranger, booker, booker2, A, B } = w;
  try {
    // A has a Desk seat, so it can't become another kind; B can until it's set up.
    const k = await as(admin)("PATCH", `/hosts/${A}`, { kind: "company" });
    assert.equal(k.status, 409);
    assert.equal(k.body.error, "stillVenue");
    assert.equal((await as(admin)("PATCH", `/hosts/${B}`, { kind: "company" })).status, 200);
    assert.equal((await as(admin)("PATCH", `/hosts/${B}`, { kind: "venue" })).status, 200);
    assert.equal((await w.setup(B, w.everyDay([6, 24]))).status, 201);
    assert.equal((await as(admin)("PATCH", `/hosts/${B}`, { kind: "company" })).status, 409);

    // An invite from an Admin removed since: it can't start.
    const adm = await as(admin)("POST", `/hosts/${B}/team`, { to: stranger.p });
    assert.equal((await as(stranger)("POST", `/invites/${adm.body.id}/accept`)).status, 200);
    assert.equal((await as(admin)("POST", `/hosts/${B}/team/${adm.body.id}/confirm`)).status, 200);
    const fromGone = await as(stranger)("POST", `/hosts/${B}/team`, { to: booker.p, role: "desk" });
    assert.equal(fromGone.status, 201);
    assert.equal((await as(admin)("DELETE", `/hosts/${B}/team/${adm.body.id}`)).status, 204);
    const r = await as(booker)("POST", `/invites/${fromGone.body.id}/accept`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "notWaiting");

    // An invite to a host archived since: it can't start either.
    const inv = await as(admin)("POST", `/hosts/${B}/team`, { to: booker2.p, role: "desk" });
    assert.equal(inv.status, 201);
    assert.equal((await as(admin)("POST", `/hosts/${B}/archive`)).status, 200);
    const shut = await as(booker2)("POST", `/invites/${inv.body.id}/accept`);
    assert.equal(shut.status, 409);
    assert.equal(shut.body.error, "hostClosed");
  } finally {
    await t.close();
  }
});

test("a Desk invite nobody has accepted doesn't keep a host a Venue, and can't start once it isn't one", async () => {
  const w = await world();
  const { t, as, admin, booker, B } = w;
  try {
    const inv = await as(admin)("POST", `/hosts/${B}/team`, { to: booker.p, role: "desk" });
    assert.equal(inv.status, 201);
    assert.equal((await as(admin)("PATCH", `/hosts/${B}`, { kind: "company" })).status, 200);
    const r = await as(booker)("POST", `/invites/${inv.body.id}/accept`);
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "hostClosed");
  } finally {
    await t.close();
  }
});

test("a seat on a venue not set up yet hears noVenue; no seat, or a removed one, hears notFound", async () => {
  const w = await world();
  const { t, as, admin, desk, stranger, A } = w;
  try {
    for (const [u, path] of [[admin, `/venues/${A}`], [admin, `/venues/${A}/day`], [desk, `/venues/${A}/day`]] as const) {
      const r = await as(u)("GET", path);
      assert.equal(r.status, 404);
      assert.equal(r.body.error, "noVenue", `${u.name} ${path}`);
    }
    // The settings are an Admin's: Desk and a stranger hear notFound, so nothing says whether a venue exists.
    for (const u of [desk, stranger]) assert.equal((await as(u)("GET", `/venues/${A}`)).body.error, "notFound");
    await w.setup(A, w.everyDay([11, 26]));
    assert.equal((await as(desk)("GET", `/venues/${A}/day`)).status, 200);
    const out = await as(stranger)("GET", `/venues/${A}/day`);
    assert.equal(out.status, 404);
    assert.equal(out.body.error, "notFound");
    // The Desk seat removed: the same read is notFound now.
    const seat = (await as(admin)("GET", `/hosts/${A}/team`)).body.members.find((m: any) => m.userId === desk.me.id).id;
    assert.equal((await as(admin)("DELETE", `/hosts/${A}/team/${seat}`)).status, 204);
    const gone = await as(desk)("GET", `/venues/${A}/day`);
    assert.equal(gone.status, 404);
    assert.equal(gone.body.error, "notFound");
  } finally {
    await t.close();
  }
});

test("anyone signed in holds a slot through the route", async () => {
  const w = await world();
  const { t, as, booker, booker2, A, C } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc(2));
    const seven = w.base + 40 * MIN;
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 2 };
    const ok = await as(booker)("POST", `/venues/${A}/holds`, body);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(ok.body, {
      id: ok.body.id, stationId: s.id, start: iso(seven), end: iso(seven + HOUR), count: 2, holdEndsAt: iso(t.now() + 10 * MIN), status: "held", qr: null, code: null,
    });
    // Someone else finds it full.
    const full = await as(booker2)("POST", `/venues/${A}/holds`, { ...body, count: 1 });
    assert.equal(full.status, 409);
    assert.equal(full.body.error, "full");
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, { ...body, hours: 0 })).status, 400);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, { ...body, start: "7 PM" })).status, 400);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, { ...body, start: iso(seven + 7 * MIN), count: 1 })).body.error, "badTime");
    assert.equal((await as(booker2)("POST", `/venues/${C}/holds`, body)).status, 404);
    assert.equal((await as(booker2)("POST", `/venues/abc/holds`, body)).status, 404);
    assert.equal((await t.call("POST", `/venues/${A}/holds`, body)).status, 401);

    // A re-hold through the route replaces the first: the slot is theirs again, once.
    const again = await as(booker)("POST", `/venues/${A}/holds`, body);
    assert.equal(again.status, 201);
    const live = (await w.day(w.admin, A)).claims.filter((c) => c.kind === "booking");
    assert.deepEqual(live.map((c) => c.id), [again.body.id]);
    // A paused host takes no holds; an archived station is gone.
    await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, A));
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, { ...body, start: iso(seven + DAY), count: 1 })).status, 409);
    await t.db.update(hosts).set({ status: "live" }).where(eq(hosts.id, A));
    const old = await w.station(A, w.pc(2, "Old PC"));
    assert.equal((await as(w.admin)("PATCH", `/venues/${A}/stations/${old.id}`, { archived: true })).status, 200);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, { ...body, stationId: old.id, count: 1 })).status, 404);
  } finally {
    await t.close();
  }
});

test("one person holds at most three times an hour at a venue", async () => {
  const w = await world();
  const { t, as, booker, A, B } = w;
  try {
    await w.setup(A, w.everyDay([11, 26]));
    await w.setup(B, w.everyDay([11, 26]));
    const s = await w.station(A, w.pc(2));
    const sb = await w.station(B, w.pc(2));
    const tomorrow = w.base + 40 * MIN + DAY;
    const body = { stationId: s.id, start: iso(tomorrow), hours: 1, count: 1 };
    for (let k = 0; k < 3; k++) assert.equal((await as(booker)("POST", `/venues/${A}/holds`, body)).status, 201);
    const fourth = await as(booker)("POST", `/venues/${A}/holds`, body);
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.error, "tooMany");
    // Another venue is its own count.
    assert.equal((await as(booker)("POST", `/venues/${B}/holds`, { ...body, stationId: sb.id })).status, 201);
    // An hour on, they can hold here again.
    t.tick(HOUR);
    assert.equal((await as(booker)("POST", `/venues/${A}/holds`, body)).status, 201);
  } finally {
    await t.close();
  }
});

// ---------- X7: confirming, letting go, freed-slot alerts, the public read and Galaxy ----------

// A venue open 11 AM to 2 AM with one free (₹0) station and the next 7 PM.
async function freeVenue(w: Awaited<ReturnType<typeof world>>, count = 1) {
  await w.setup(w.A, w.everyDay([11, 26]));
  const s = await w.station(w.A, { name: "Free PC", unit: "PC", count, pricePaise: 0, tile: "gaming" });
  return { s, seven: w.base + 40 * MIN };
}

test("two holds racing for the last station: exactly one wins", async () => {
  const w = await world();
  const { t, as, booker, booker2, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 1 };
    const got = await Promise.all([as(booker)("POST", `/venues/${A}/holds`, body), as(booker2)("POST", `/venues/${A}/holds`, body)]);
    assert.deepEqual(got.map((r) => r.status).sort(), [201, 409]);
    assert.equal(got.find((r) => r.status === 409)!.body.error, "full");
    await w.invariant(s.id, 1);
  } finally {
    await t.close();
  }
});

test("a free hold confirms into a ticket and the venue's team hears; a paid one needs paying", async () => {
  const w = await world();
  const { t, as, booker, booker2, admin, desk, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const h = (await as(booker)("POST", `/venues/${A}/holds`, { stationId: s.id, start: iso(seven), hours: 1, count: 1 })).body;
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds/${h.id}/confirm`)).status, 404); // not theirs
    const ok = await as(booker)("POST", `/venues/${A}/holds/${h.id}/confirm`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, "paid");
    assert.equal(ok.body.holdEndsAt, null);
    assert.match(ok.body.qr, /^[A-Za-z0-9_-]{32}$/);
    assert.match(ok.body.code, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    const told = t.notices.filter((n) => n.kind === "slotBooked");
    assert.deepEqual(told.map((n) => (n.to as any).userId).sort(), [admin.me.id, desk.me.id].sort());
    assert.equal(told[0]!.data!.station, "Free PC");
    // A retry answers the same and tells nobody twice.
    const again = await as(booker)("POST", `/venues/${A}/holds/${h.id}/confirm`);
    assert.equal(again.status, 200);
    assert.equal(again.body.qr, ok.body.qr);
    assert.equal(t.notices.filter((n) => n.kind === "slotBooked").length, 2);
    // It's a booking now: it counts past the 10 minutes.
    t.tick(15 * MIN);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, { stationId: s.id, start: iso(seven), hours: 1, count: 1 })).body.error, "full");

    // A priced station: 402 with the total, and the hold stays as it was.
    const pc = await w.station(A, w.pc(4));
    const p = (await as(booker2)("POST", `/venues/${A}/holds`, { stationId: pc.id, start: iso(seven + HOUR), hours: 2, count: 2 })).body;
    const pay = await as(booker2)("POST", `/venues/${A}/holds/${p.id}/confirm`);
    assert.equal(pay.status, 402);
    assert.equal(pay.body.error, "paymentNeeded");
    assert.equal(pay.body.totalPaise, 10000 * 2 * 2);
    const [row] = await t.db.select().from(stationClaims).where(eq(stationClaims.id, p.id));
    assert.equal(row!.status, "held");
    assert.equal(row!.qr, null);
    // The counter's day: a live hold carries when it lapses, a booking doesn't; charges says which stations take money.
    const d = await w.day(desk, A);
    assert.equal(d.claims.find((c) => c.id === p.id).holdEndsAt, iso(t.now() + 10 * MIN));
    assert.equal(d.claims.find((c) => c.id === h.id).holdEndsAt, null);
    assert.deepEqual(Object.fromEntries(d.stations.map((x) => [x.id, x.charges])), { [s.id]: false, [pc.id]: true });
  } finally {
    await t.close();
  }
});

test("a lapsed hold confirms only while the slot is still free", async () => {
  const w = await world();
  const { t, as, booker, booker2, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 1 };
    const first = (await as(booker)("POST", `/venues/${A}/holds`, body)).body;
    t.tick(11 * MIN);
    const late = await as(booker)("POST", `/venues/${A}/holds/${first.id}/confirm`);
    assert.equal(late.status, 200);
    assert.equal(late.body.status, "paid");

    // Lapsed, and someone else holds it now: full, and nothing changes.
    const later = { ...body, start: iso(seven + HOUR) };
    const mine = (await as(booker)("POST", `/venues/${A}/holds`, later)).body;
    t.tick(11 * MIN);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, later)).status, 201);
    const taken = await as(booker)("POST", `/venues/${A}/holds/${mine.id}/confirm`);
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error, "full");
    const [row] = await t.db.select().from(stationClaims).where(eq(stationClaims.id, mine.id));
    assert.equal(row!.status, "held");
    await w.invariant(s.id, 1);
  } finally {
    await t.close();
  }
});

test("a player lets go of a hold and the slot is free again", async () => {
  const w = await world();
  const { t, as, booker, booker2, stranger, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 1 };
    const h = (await as(booker)("POST", `/venues/${A}/holds`, body)).body;
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, body)).status, 409);
    assert.equal((await as(stranger)("DELETE", `/venues/${A}/holds/${h.id}`)).status, 404);
    assert.equal((await as(booker)("DELETE", `/venues/${A}/holds/${h.id}`)).status, 204);
    assert.equal((await as(booker)("DELETE", `/venues/${A}/holds/${h.id}`)).status, 404);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, body)).status, 201);
    const [row] = await t.db.select().from(stationClaims).where(eq(stationClaims.id, h.id));
    assert.equal(row!.status, "held"); // kept, just over
  } finally {
    await t.close();
  }
});

test("freed-slot alerts: only on a full slot, one push when it frees, the public read follows", async () => {
  const w = await world();
  const { t, as, booker, booker2, A, C } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 1 };
    const notFull = await as(booker2)("POST", `/venues/${A}/alerts`, body);
    assert.equal(notFull.status, 409);
    assert.equal(notFull.body.error, "notFull");

    const pub = async () => {
      const r = await t.call("GET", `/public/venues/${A}/slots`);
      assert.equal(r.status, 200);
      return r.body.stations[0].free.find((f: any) => f.at === iso(seven)).free as number;
    };
    assert.equal(await pub(), 1);
    await as(booker)("POST", `/venues/${A}/holds`, body);
    assert.equal(await pub(), 0);
    // Their own hold doesn't make it full for them.
    assert.equal((await as(booker)("POST", `/venues/${A}/alerts`, body)).body.error, "notFull");

    const a = await as(booker2)("POST", `/venues/${A}/alerts`, body);
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const again = await as(booker2)("POST", `/venues/${A}/alerts`, body);
    assert.equal(again.status, 200);
    assert.equal(again.body.id, a.body.id);

    await sweepSlotAlerts(t.db, t.notify, t.now());
    assert.equal(t.notices.filter((n) => n.kind === "slotFreedAgain").length, 0);
    t.tick(11 * MIN); // the hold lapses
    await sweepSlotAlerts(t.db, t.notify, t.now());
    await sweepSlotAlerts(t.db, t.notify, t.now());
    const sent = t.notices.filter((n) => n.kind === "slotFreedAgain");
    assert.equal(sent.length, 1);
    assert.equal((sent[0]!.to as any).userId, booker2.me.id);
    assert.equal(sent[0]!.data!.venueId, A);
    assert.equal(await pub(), 1);
    // Sent: it can't be cancelled, and a new ask on a free slot is refused.
    assert.equal((await as(booker2)("DELETE", `/venues/${A}/alerts/${a.body.id}`)).status, 404);

    // Cancel a waiting one; the public read's day window and non-venues.
    await as(booker)("POST", `/venues/${A}/holds`, body);
    const b2 = await as(booker2)("POST", `/venues/${A}/alerts`, body);
    assert.equal(b2.status, 201);
    assert.equal((await as(booker)("DELETE", `/venues/${A}/alerts/${b2.body.id}`)).status, 404);
    assert.equal((await as(booker2)("DELETE", `/venues/${A}/alerts/${b2.body.id}`)).status, 204);
    const [left] = await t.db.select().from(slotAlerts).where(eq(slotAlerts.id, b2.body.id));
    assert.equal(left, undefined);
    const tomorrow = new Date(t.now() + DAY + IST).toISOString().slice(0, 10);
    assert.equal((await t.call("GET", `/public/venues/${A}/slots?day=${tomorrow}`)).body.day, tomorrow);
    assert.equal((await t.call("GET", `/public/venues/${A}/slots?day=2020-01-01`)).status, 400);
    assert.equal((await t.call("GET", `/public/venues/${A}/slots?day=2026-02-31`)).status, 400);
    assert.equal((await t.call("GET", `/public/venues/${C}/slots`)).status, 404);
  } finally {
    await t.close();
  }
});

test("Galaxy lists live holds and alerts and releases a hold, for holders of Hosts only", async () => {
  const w = await world();
  const { t, as, booker, booker2, stranger, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 1 };
    const h = (await as(booker)("POST", `/venues/${A}/holds`, body)).body;
    await as(booker2)("POST", `/venues/${A}/alerts`, body);
    const R = { reason: "Stuck hold" };
    assert.equal((await as(stranger)("GET", "/galaxy/slot-holds")).status, 404);
    assert.equal((await as(stranger)("POST", `/galaxy/slot-holds/${h.id}/release`, R)).status, 404);
    await t.db.insert(staffGrants).values({ userId: stranger.me.id, feature: "hosts", addedBy: stranger.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
    const list = await as(stranger)("GET", "/galaxy/slot-holds");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.holds.map((x: any) => [x.id, x.person, x.venue, x.station]), [[h.id, "Meera Pillai", "Pixel Lounge", "Free PC"]]);
    assert.deepEqual(list.body.alerts.map((x: any) => [x.person, x.state]), [["Kabir Shah", "waiting"]]);
    assert.equal((await as(stranger)("POST", `/galaxy/slot-holds/${h.id}/release`, {})).status, 400);
    assert.equal((await as(stranger)("POST", `/galaxy/slot-holds/${h.id}/release`, R)).status, 204);
    assert.equal((await as(stranger)("POST", `/galaxy/slot-holds/${h.id}/release`, R)).status, 404);
    assert.deepEqual((await as(stranger)("GET", "/galaxy/slot-holds")).body.holds, []);
    const logged = await t.db.select().from(auditLog).where(eq(auditLog.action, "slots.releaseHold"));
    assert.equal(logged.length, 1);
    assert.equal(logged[0]!.targetUser, booker.me.id);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, body)).status, 201);
  } finally {
    await t.close();
  }
});

test("a hold let go, by the player or Galaxy, can't be confirmed free; a late payment still confirms it", async () => {
  const w = await world();
  const { t, as, booker, booker2, stranger, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 1 };
    const h = (await as(booker)("POST", `/venues/${A}/holds`, body)).body;
    assert.equal((await as(booker)("DELETE", `/venues/${A}/holds/${h.id}`)).status, 204);
    const [row] = await t.db.select().from(stationClaims).where(eq(stationClaims.id, h.id));
    assert.equal(row!.releasedBy, booker.me.id);
    const refused = await as(booker)("POST", `/venues/${A}/holds/${h.id}/confirm`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, "letGo");

    await t.db.insert(staffGrants).values({ userId: stranger.me.id, feature: "hosts", addedBy: stranger.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
    const g = (await as(booker2)("POST", `/venues/${A}/holds`, { ...body, start: iso(seven + HOUR) })).body;
    assert.equal((await as(stranger)("POST", `/galaxy/slot-holds/${g.id}/release`, { reason: "Stuck" })).status, 204);
    const [gr] = await t.db.select().from(stationClaims).where(eq(stationClaims.id, g.id));
    assert.equal(gr!.releasedBy, stranger.me.id);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds/${g.id}/confirm`)).body.error, "letGo");

    // Money landed for the one let go (X2's webhook): it confirms, and reads as booked, not released.
    const paid = await t.db.transaction((tx) => confirmHold(tx, h.id, t.now()));
    assert.equal(paid.ok, true);
    assert.equal(paid.ok && paid.claim.releasedAt, null);
    assert.equal(paid.ok && paid.claim.status, "paid");
  } finally {
    await t.close();
  }
});

test("confirmHold with a stale now can't double book", async () => {
  const w = await world();
  const { t, as, booker, booker2, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 1 };
    const stale = t.now();
    const first = (await as(booker)("POST", `/venues/${A}/holds`, body)).body;
    t.tick(11 * MIN);
    assert.equal((await as(booker2)("POST", `/venues/${A}/holds`, body)).status, 201);
    // A webhook that read the clock before the first hold lapsed still sees the second.
    const r = await t.db.transaction((tx) => confirmHold(tx, first.id, stale + MIN));
    assert.deepEqual(r, { ok: false, error: "full" });
    await w.invariant(s.id, 1);
  } finally {
    await t.close();
  }
});

test("a lapsed hold won't confirm after its start, on an archived station, a closed venue, or outside new hours", async () => {
  const w = await world();
  const { t, booker, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const lapsed = async (start: number) =>
      (await t.db.insert(stationClaims).values({
        stationId: s.id, kind: "booking", status: "held", count: 1, startsAt: new Date(start), endsAt: new Date(start + HOUR),
        holdEndsAt: new Date(t.now() - MIN), userId: booker.me.id,
      }).returning())[0]!;
    const confirm = (id: string) => t.db.transaction((tx) => confirmHold(tx, id, t.now()));
    const FULL = { ok: false, error: "full" };

    assert.deepEqual(await confirm((await lapsed(t.now() - 30 * MIN)).id), FULL); // started

    const later = await lapsed(seven + 2 * HOUR);
    await t.db.update(stations).set({ archivedAt: new Date(t.now()) }).where(eq(stations.id, s.id));
    assert.deepEqual(await confirm(later.id), FULL);
    await t.db.update(stations).set({ archivedAt: null }).where(eq(stations.id, s.id));

    await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, A));
    assert.deepEqual(await confirm(later.id), FULL);
    await t.db.update(hosts).set({ status: "live" }).where(eq(hosts.id, A));

    // The venue now closes at 8 PM: a 9 PM slot is outside its hours.
    await t.db.update(venues).set({ week: w.everyDay([11, 20]) }).where(eq(venues.hostId, A));
    assert.deepEqual(await confirm(later.id), FULL);
    await t.db.update(venues).set({ week: w.everyDay([11, 26]) }).where(eq(venues.hostId, A));
    assert.equal((await confirm(later.id)).ok, true);
  } finally {
    await t.close();
  }
});

test("confirm and let go answer 404 on the wrong host", async () => {
  const w = await world();
  const { t, as, booker, A, B } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const h = (await as(booker)("POST", `/venues/${A}/holds`, { stationId: s.id, start: iso(seven), hours: 1, count: 1 })).body;
    assert.equal((await as(booker)("POST", `/venues/${B}/holds/${h.id}/confirm`)).status, 404);
    assert.equal((await as(booker)("DELETE", `/venues/${B}/holds/${h.id}`)).status, 404);
    const [row] = await t.db.select().from(stationClaims).where(eq(stationClaims.id, h.id));
    assert.equal(row!.status, "held");
    assert.equal(row!.releasedAt, null);
  } finally {
    await t.close();
  }
});

test("the alert sweep carries on past one that fails and sends it once next time; old alerts are pruned", async () => {
  const w = await world();
  const { t, as, booker, booker2, stranger, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 1 };
    await as(booker)("POST", `/venues/${A}/holds`, body);
    assert.equal((await as(booker2)("POST", `/venues/${A}/alerts`, body)).status, 201);
    assert.equal((await as(stranger)("POST", `/venues/${A}/alerts`, body)).status, 201);
    // Asking again with another count updates the waiting ask.
    const re = await as(stranger)("POST", `/venues/${A}/alerts`, { ...body, hours: 2 });
    assert.equal(re.status, 200);
    assert.equal(re.body.end, iso(seven + 2 * HOUR));
    t.tick(11 * MIN);
    const err = console.error;
    console.error = () => {};
    let calls = 0;
    try {
      await sweepSlotAlerts(t.db, async (n, tx) => {
        if (calls++ === 0) throw new Error("push down");
        await t.notify(n, tx);
      }, t.now());
    } finally {
      console.error = err;
    }
    assert.equal(calls, 2);
    assert.equal(t.notices.filter((n) => n.kind === "slotFreedAgain").length, 1);
    await sweepSlotAlerts(t.db, t.notify, t.now());
    await sweepSlotAlerts(t.db, t.notify, t.now());
    const sent = t.notices.filter((n) => n.kind === "slotFreedAgain").map((n) => (n.to as any).userId).sort();
    assert.deepEqual(sent, [booker2.me.id, stranger.me.id].sort());

    t.tick(31 * DAY);
    await sweepSlotAlerts(t.db, t.notify, t.now());
    assert.equal((await t.db.select().from(slotAlerts)).length, 0);
  } finally {
    await t.close();
  }
});

test("the public read: a bad day is 400, every step still ahead, no people", async () => {
  const w = await world();
  const { t, as, booker, A } = w;
  try {
    const { s, seven } = await freeVenue(w);
    await as(booker)("POST", `/venues/${A}/holds`, { stationId: s.id, start: iso(seven), hours: 1, count: 1 });
    assert.equal((await t.call("GET", `/public/venues/${A}/slots?day=`)).status, 400);
    const r = await t.call("GET", `/public/venues/${A}/slots`);
    assert.equal(r.status, 200);
    const starts = r.body.stations[0].free.map((f: any) => f.at as string);
    // Closes at 2 AM: every half hour is listed, 1:30 too (a booking ending at 2 covers it), from the step ahead of now.
    assert.equal(ist(Date.parse(starts.at(-1))), "1:30");
    assert.equal(ist(Date.parse(starts[0])), "18:30");
    // The last 30 minutes can't be held for an hour; the hour before can.
    const h = (at: string) => as(booker)("POST", `/venues/${A}/holds`, { stationId: s.id, start: at, hours: 1, count: 1 });
    assert.equal((await h(starts.at(-1))).body.error, "badTime");
    assert.equal((await h(starts.at(-2))).status, 201);
    const text = JSON.stringify(r.body);
    for (const x of [booker.me.id, booker.name, "userId", "qr", "code"]) assert.ok(!text.includes(x), x);
  } finally {
    await t.close();
  }
});

test("places to play: public, live venues with a live station, tiled and nearest first", async () => {
  const w = await world();
  const { t, as, admin, A, B, C } = w;
  try {
    const listed = async (q = "") => (await t.call("GET", `/public/places${q}`)).body.places as any[];
    await w.setup(A, w.everyDay([11, 26]));
    // Set up but no stations yet: not a place.
    assert.deepEqual(await listed(), []);
    await w.station(A, w.pc());
    await as(admin)("PUT", `/venues/${B}`, { address: "2 Road", area: "Gachibowli", lat: 17.45, lng: 78.35, deskPhone: "+914012345678", week: w.everyDay([6, 24]) });
    const turf = await w.station(B, { name: "Turf", unit: "pitch", count: 1, pricePaise: 80000, tile: "sports" });
    await w.station(B, w.pc(2, "Lounge PC")); // gaming and sports together read as sports
    const all = await listed();
    assert.deepEqual(all.map((p) => [p.name, p.tile, p.area, p.distanceKm]), [["Pixel Lounge", "gaming", "Madhapur", null], ["Turf Park", "sports", "Gachibowli", null]]);
    assert.deepEqual(Object.keys(all[0]).sort(), ["area", "city", "distanceKm", "id", "kind", "logo", "name", "slug", "tile", "verified"]);
    // With a point: nearest first, with its distance.
    const near = await listed("?lat=17.46&lng=78.34");
    assert.deepEqual(near.map((p) => p.name), ["Turf Park", "Pixel Lounge"]);
    assert.ok(near[0].distanceKm < near[1].distanceKm && near[0].distanceKm < 2);
    assert.equal((await t.call("GET", "/public/places?lat=17.4")).status, 400);
    // Archiving B's turf leaves it gaming; a host that isn't public and live is left out.
    assert.equal((await as(admin)("PATCH", `/venues/${B}/stations/${turf.id}`, { archived: true })).status, 200);
    assert.equal((await listed()).find((p) => p.id === B).tile, "gaming");
    await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, A));
    assert.deepEqual((await listed()).map((p) => p.id), [B]);
    assert.ok(!(await listed()).some((p) => p.id === C));
  } finally {
    await t.close();
  }
});

test("deleting an account drops its alerts, lapses its holds and releases its upcoming slot bookings", async () => {
  const w = await world();
  const { t, as, booker, booker2, A } = w;
  try {
    const { s, seven } = await freeVenue(w, 2);
    const body = { stationId: s.id, start: iso(seven), hours: 1, count: 2 };
    await as(booker2)("POST", `/venues/${A}/holds`, body);
    assert.equal((await as(booker)("POST", `/venues/${A}/alerts`, body)).status, 201);
    const h = (await as(booker)("POST", `/venues/${A}/holds`, { ...body, start: iso(seven + 2 * HOUR), count: 1 })).body;
    const booked = await w.claim(s.id, booker.me.id, seven + 4 * HOUR, seven + 5 * HOUR, 1);
    const past = await w.claim(s.id, booker.me.id, t.now() - 3 * HOUR, t.now() - 2 * HOUR, 1);
    await t.db.update(users).set({ deletionRequestedAt: new Date(t.now() - 31 * DAY), deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, booker.me.id));
    await runDeletions(t.db, async (x) => void t.notices.push(x), t.now());
    assert.equal((await t.db.select().from(slotAlerts).where(eq(slotAlerts.userId, booker.me.id))).length, 0);
    const row = async (id: string) => (await t.db.select().from(stationClaims).where(eq(stationClaims.id, id)))[0]!;
    assert.ok((await row(h.id)).holdEndsAt!.getTime() <= t.now());
    assert.equal((await row(booked.id)).status, "released");
    assert.equal((await row(booked.id)).releasedAt!.getTime(), t.now());
    assert.equal((await row(past.id)).status, "paid");
  } finally {
    await t.close();
  }
});
