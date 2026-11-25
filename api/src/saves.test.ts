import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import type { MySaves } from "@orbit/contract";
import { testApp } from "./testkit.ts";
import { events, hosts, listEvents, lists, saves, users } from "./db/schema.ts";

// Saves and lists on the account (Saved events and lists doc), and the host's count of saves.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(7_000_000 + ++n * 11).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

const join = async (p = phone()) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
let hn = 0;
const start = async (u: P, name = `Punchline Collective ${++hn}`) => (await as(u)("POST", "/hosts", { name, kind: "comedy-group", city: "Hyderabad" })).body as { id: string; slug: string };
const draft = async (u: P, hostId: string, title = "Open Mic Night") => (await as(u)("POST", `/hosts/${hostId}/events`, { title })).body as { id: string; slug: string };
const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
const png = (w: number, h: number, color = "#1D372A") => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const upload = async (u: P, path: string, bytes: Uint8Array) => {
  const form = new FormData();
  form.set("image", new File([bytes as BlobPart], "p.png", { type: "image/png" }));
  const res = await t.app.request(path, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  return { status: res.status, body: (await res.json()) as any };
};
const poster = async (u: P, id: string) => assert.equal((await upload(u, `/events/${id}/poster`, await png(900, 1200))).status, 200);
const tier = (u: P, id: string, body: object = { name: "General", pricePaise: 0 }) => as(u)("POST", `/events/${id}/tickets`, body);

// A published event: poster, a place, a time, a ticket type.
const publish = async (u: P, hostId: string, o: { title?: string; place?: object | null; startsIn?: number; endsIn?: number; price?: number; category?: string; online?: boolean } = {}) => {
  const e = await draft(u, hostId, o.title);
  await poster(u, e.id);
  const set = await as(u)("PATCH", `/events/${e.id}`, {
    category: o.category ?? "comedy", startsAt: iso(o.startsIn ?? DAY), endsAt: iso(o.endsIn ?? DAY + 2 * HOUR),
    ...(o.place === null ? { online: true, onlineLink: "https://meet.example.com/secret-room" } : { place: o.place ?? place }),
    ...(o.online ? { online: true, onlineLink: "https://meet.example.com/secret-room" } : {}),
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal((await tier(u, e.id, { name: "General", pricePaise: o.price ?? 0 })).status, 201);
  const p = await as(u)("POST", `/events/${e.id}/publish`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return e;
};

const DAY_MS = DAY;
const read = async (u: P) => (await as(u)("GET", "/me/saves")).body as MySaves;
const ids = (r: MySaves) => r.saved.map((s) => s.eventId);
// Making a list says `create`, as the app does; a rename doesn't.
const list = (u: P, id: string, name: string, eventId?: string) => as(u)("PUT", `/me/lists/${id}`, { name, create: true, ...(eventId && { eventId }) });
const rename = (u: P, id: string, name: string) => as(u)("PUT", `/me/lists/${id}`, { name });
const tickEvent = (u: P, id: string, e: string) => as(u)("PUT", `/me/lists/${id}/events/${e}`);
// Many events at once, cloned from a published one (a real publish takes seven calls each).
const clones = async (like: string, n: number, o: { hostId?: string; past?: boolean } = {}) => {
  const [row] = await t.db.select().from(events).where(eq(events.id, like));
  const made = Array.from({ length: n }, () => ({
    ...row!, id: randomUUID(), slug: `c-${randomUUID().slice(0, 12)}`, hostId: o.hostId ?? row!.hostId,
    ...(o.past ? { startsAt: new Date(t.now() - 3 * DAY), endsAt: new Date(t.now() - 2 * DAY) } : {}),
  }));
  for (let i = 0; i < made.length; i += 200) await t.db.insert(events).values(made.slice(i, i + 200));
  return made.map((m) => m.id);
};
const give = async (u: P, eventIds: string[]) => {
  for (let i = 0; i < eventIds.length; i += 500)
    await t.db.insert(saves).values(eventIds.slice(i, i + 500).map((eventId) => ({ userId: u.me.id, eventId })));
};

test("save is idempotent, keeps its first time, and GET answers with cards", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, (await start(a)).id);
  assert.deepEqual(await read(b), { saved: [], lists: [], events: [] });
  assert.equal((await as(b)("PUT", `/me/saves/${e.id}`)).status, 204);
  const first = (await read(b)).saved[0]!.at;
  t.tick(60_000);
  assert.equal((await as(b)("PUT", `/me/saves/${e.id}`)).status, 204);
  const r = await read(b);
  assert.equal(r.saved.length, 1);
  assert.equal(r.saved[0]!.at, first);
  assert.equal(r.events[0]!.id, e.id);
  assert.equal(r.events[0]!.tiers.length, 1);
  assert.deepEqual((await read(a)).saved, []); // private
  assert.equal((await t.call("GET", "/me/saves")).status, 401);
  assert.equal((await t.call("PUT", `/me/saves/${e.id}`)).status, 401);
});

test("only an event that can be opened can be saved; the rest are 404 and reveal nothing", async () => {
  const a = await join(), b = await join();
  const h = await start(a);
  const d = await draft(a, h.id);
  const live = await publish(a, h.id);
  const stranger = await publish(a, (await start(a)).id);
  for (const id of [d.id, randomUUID(), "nope", "00000000-0000-0000-0000-000000000000%00", "a\u0000b"])
    assert.equal((await as(b)("PUT", `/me/saves/${encodeURIComponent(id)}`)).status, 404, id);
  // Link-only and cancelled open; a private host's events open.
  await as(a)("PATCH", `/events/${live.id}`, { visibility: "link-only" });
  assert.equal((await as(b)("PUT", `/me/saves/${live.id}`)).status, 204);
  assert.equal((await as(a)("POST", `/events/${stranger.id}/cancel`, { reason: "Rain" })).status, 200);
  assert.equal((await as(b)("PUT", `/me/saves/${stranger.id}`)).status, 204);
  assert.deepEqual(new Set((await read(b)).events.map((e) => e.id)), new Set([live.id, stranger.id]));
  assert.equal((await read(b)).events.find((e) => e.id === stranger.id)!.status, "cancelled");
  // A host off the air: 404 to save.
  const other = await start(a);
  const off = await publish(a, other.id);
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, other.id));
  assert.equal((await as(b)("PUT", `/me/saves/${off.id}`)).status, 404);
});

test("a save whose event can't be opened is hidden, never deleted, and returns with its time", async () => {
  const a = await join(), b = await join();
  const h = await start(a);
  const e = await publish(a, h.id), keep = await publish(a, h.id);
  await list(b, "l_one", "Weekend");
  await tickEvent(b, "l_one", e.id);
  await as(b)("PUT", `/me/saves/${keep.id}`);
  const before = (await read(b)).saved.find((s) => s.eventId === e.id)!.at;
  await t.db.update(hosts).set({ status: "suspended" }).where(eq(hosts.id, h.id));
  const hidden = await read(b);
  assert.deepEqual(hidden.saved, []);
  assert.deepEqual(hidden.lists[0]!.events, []);
  assert.deepEqual(hidden.events, []);
  assert.equal((await t.db.select().from(saves).where(eq(saves.userId, b.me.id))).length, 2);
  await t.db.update(hosts).set({ status: "live" }).where(eq(hosts.id, h.id));
  const back = await read(b);
  assert.equal(back.saved.find((s) => s.eventId === e.id)!.at, before);
  assert.deepEqual(back.lists[0]!.events, [e.id]);
  await as(a)("POST", `/events/${e.id}/cancel`, { reason: "Rain" }); // cancelled stays
  assert.equal((await read(b)).saved.length, 2);
});

test("the cap: 1,000 over openable saves; hidden ones don't count, past ones do", async () => {
  const a = await join(), b = await join();
  const h = await start(a), h2 = await start(a);
  const like = await publish(a, h.id);
  const fresh = await publish(a, h.id), fresh2 = await publish(a, h.id);
  const upcoming = await clones(like.id, 600), past = await clones(like.id, 396, { past: true }); // 996 + `like` + 3 below
  const hiddenOnes = await clones(like.id, 5, { hostId: h2.id });
  await give(b, [...upcoming, ...past, like.id, ...hiddenOnes]);
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, h2.id));
  // 997 openable (396 of them past) + 5 hidden: three more fit.
  assert.equal((await read(b)).saved.length, 997);
  assert.equal((await as(b)("PUT", `/me/saves/${fresh.id}`)).status, 204);
  assert.equal((await as(b)("PUT", `/me/saves/${fresh2.id}`)).status, 204);
  const third = (await clones(like.id, 1))[0]!;
  assert.equal((await as(b)("PUT", `/me/saves/${third}`)).status, 204);
  const no = await as(b)("PUT", `/me/saves/${randomUUID()}`);
  assert.equal(no.status, 404); // unopenable beats full
  const more = (await clones(like.id, 1))[0]!;
  const full = await as(b)("PUT", `/me/saves/${more}`);
  assert.equal(full.status, 409);
  assert.equal(full.body.error, "full");
  assert.equal(full.body.message, "You have 1,000 saved; remove some first");
  assert.equal((await as(b)("PUT", `/me/saves/${fresh.id}`)).status, 204); // already saved: fine at the cap
  // Two saves at 999 can't both pass.
  assert.equal((await as(b)("POST", "/me/saves/remove", { eventIds: [third] })).status, 204);
  const two = await clones(like.id, 2);
  const r = await Promise.all(two.map((e) => as(b)("PUT", `/me/saves/${e}`)));
  assert.deepEqual(r.map((x) => x.status).sort(), [204, 409]);
  // A tick into a list at the cap is refused the same way.
  await list(b, "l_a", "A");
  assert.equal((await tickEvent(b, "l_a", more)).status, 409);
});

test("list names: trimmed, 1 to 40 as people count, unique ignoring case; 50 lists", async () => {
  const a = await join(), b = await join();
  const made = await list(a, "l_1", "  Weekend plans  ");
  assert.equal(made.status, 200);
  assert.equal(made.body.name, "Weekend plans");
  assert.deepEqual(made.body.events, []);
  assert.equal((await list(a, "l_2", "WEEKEND PLANS")).status, 409);
  const taken = await list(a, "l_2", "weekend plans");
  assert.equal(taken.body.error, "nameTaken");
  assert.equal(taken.body.message, "You already have a list called Weekend plans");
  assert.equal((await list(a, "l_1", "WEEKEND plans")).status, 200); // renaming itself in case
  assert.equal((await list(b, "l_1", "Weekend plans")).status, 200); // another person's own
  for (const bad of ["", "   ", "x".repeat(41), "\u0000"]) assert.equal((await list(a, "l_3", bad)).status, 400, bad);
  assert.equal((await as(a)("PUT", "/me/lists/l_3", { name: 5 })).status, 400);
  assert.equal((await list(a, "bad id", "X")).status, 400);
  assert.equal((await list(a, "x".repeat(41), "X")).status, 400);
  assert.equal((await list(a, "a\u0000b", "X")).status, 400);
  assert.equal((await list(a, "l_3", "😀".repeat(40))).status, 200); // 40 emoji
  assert.equal((await list(a, "l_4", "😀".repeat(41))).status, 400);
  assert.equal((await list(a, "l_5", "తెలుగు పదం ".repeat(3).trim())).status, 200); // 3 x 9 letters as people count them
  assert.equal((await list(a, "l_6", "ఆ".repeat(40))).status, 200);
  assert.equal((await list(a, "l_7", "ఆ".repeat(41))).status, 400);
  for (let i = 8; i <= 53; i++) assert.equal((await list(a, `l_${i}`, `List ${i}`)).status, 200);
  const many = await list(a, "l_54", "One too many");
  assert.equal(many.status, 409);
  assert.equal(many.body.error, "tooMany");
  assert.equal((await list(a, "l_8", "Renamed at 50")).status, 200);
  assert.equal((await read(a)).lists.length, 50);
});

test("ticks save first, touch the list; taking out keeps it saved; delete never unsaves", async () => {
  const a = await join();
  const h = await start(a);
  const e1 = await publish(a, h.id), e2 = await publish(a, h.id);
  await list(a, "l_a", "A");
  t.tick(1000);
  await list(a, "l_b", "B");
  assert.deepEqual((await read(a)).lists.map((l) => l.id), ["l_b", "l_a"]); // newest touched first
  t.tick(1000);
  assert.equal((await tickEvent(a, "l_a", e1.id)).status, 204);
  let r = await read(a);
  assert.deepEqual(ids(r), [e1.id]); // saved by the tick
  assert.deepEqual(r.lists.map((l) => l.id), ["l_a", "l_b"]);
  assert.deepEqual(r.lists[0]!.events, [e1.id]);
  const touched = r.lists[0]!.touched;
  t.tick(1000);
  assert.equal((await tickEvent(a, "l_a", e1.id)).status, 204); // already in: no touch
  assert.equal((await read(a)).lists[0]!.touched, touched);
  assert.equal((await tickEvent(a, "l_a", randomUUID())).status, 404);
  assert.equal((await tickEvent(a, "l_zzz", e1.id)).body.error, "listGone");
  assert.equal((await tickEvent(a, "l_zzz", e1.id)).body.message, "That list is gone");
  assert.equal((await as(a)("DELETE", `/me/lists/l_a/events/${e1.id}`)).status, 204);
  r = await read(a);
  assert.deepEqual(ids(r), [e1.id]);
  assert.deepEqual(r.lists.find((l) => l.id === "l_a")!.events, []);
  await tickEvent(a, "l_a", e1.id);
  await tickEvent(a, "l_b", e2.id);
  assert.equal((await as(a)("DELETE", "/me/lists/l_a")).status, 204);
  r = await read(a);
  assert.deepEqual(new Set(ids(r)), new Set([e1.id, e2.id]));
  assert.deepEqual(r.lists.map((l) => l.id), ["l_b"]);
  assert.equal((await as(a)("DELETE", "/me/lists/l_a")).body.error, "listGone");
  assert.equal((await as(a)("DELETE", `/me/lists/l_a/events/${e1.id}`)).body.error, "listGone");
});

test("unsave removes from every list; Undo restores the times and lists, skipping what's gone", async () => {
  const a = await join();
  const h = await start(a);
  const e1 = await publish(a, h.id), e2 = await publish(a, h.id), e3 = await publish(a, h.id);
  await list(a, "l_a", "A");
  await list(a, "l_b", "B");
  await tickEvent(a, "l_a", e1.id);
  await tickEvent(a, "l_b", e1.id);
  t.tick(5000);
  await tickEvent(a, "l_b", e2.id);
  await as(a)("PUT", `/me/saves/${e3.id}`);
  const before = await read(a);
  assert.equal((await as(a)("POST", "/me/saves/remove", { eventIds: [e1.id, e2.id] })).status, 204);
  let r = await read(a);
  assert.deepEqual(ids(r), [e3.id]);
  assert.deepEqual(r.lists.flatMap((l) => l.events), []);
  assert.equal((await as(a)("POST", "/me/saves/remove", { eventIds: [] })).status, 400);
  assert.equal((await as(a)("POST", "/me/saves/remove", { eventIds: ["x"] })).status, 400);
  await as(a)("DELETE", "/me/lists/l_a"); // deleted meanwhile: stays deleted
  const undo = {
    saves: before.saved.filter((s) => s.eventId !== e3.id),
    lists: { l_a: [e1.id], l_b: [e1.id, e2.id], l_gone: [e1.id] },
  };
  t.tick(5000);
  assert.equal((await as(a)("POST", "/me/saves/restore", undo)).status, 204);
  r = await read(a);
  assert.deepEqual(r.lists.map((l) => l.id), ["l_b"]);
  assert.deepEqual(new Set(r.lists[0]!.events), new Set([e1.id, e2.id]));
  for (const s of before.saved) assert.equal(r.saved.find((x) => x.eventId === s.eventId)!.at, s.at);
  // Idempotent, and a draft or unknown event is skipped.
  const d = await draft(a, h.id);
  assert.equal((await as(a)("POST", "/me/saves/restore", { saves: [{ eventId: d.id, at: new Date().toISOString() }, ...undo.saves], lists: { l_b: [d.id] } })).status, 204);
  r = await read(a);
  assert.equal(r.saved.length, 3);
  assert.equal(r.lists[0]!.events.length, 2);
  assert.equal((await as(a)("POST", "/me/saves/restore", { saves: [{ eventId: e1.id, at: "yesterday" }], lists: {} })).status, 400);
  assert.equal((await as(a)("POST", "/me/saves/restore", { saves: [], lists: { "bad id": [] } })).status, 400);
});

test("another person can't see or touch your lists", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, (await start(a)).id);
  await list(a, "l_mine", "Mine");
  await tickEvent(a, "l_mine", e.id);
  assert.deepEqual((await read(b)).lists, []);
  assert.equal((await tickEvent(b, "l_mine", e.id)).body.error, "listGone");
  assert.equal((await as(b)("DELETE", "/me/lists/l_mine")).status, 404);
  assert.equal((await as(b)("DELETE", `/me/lists/l_mine/events/${e.id}`)).status, 404);
  assert.deepEqual((await read(a)).lists[0]!.events, [e.id]);
  // Their same-named id is their own list, not yours.
  await list(b, "l_mine", "Theirs");
  assert.equal((await read(a)).lists[0]!.name, "Mine");
});

test("deleting the account removes every save and list", async () => {
  const a = await join();
  const e = await publish(a, (await start(a)).id);
  const b = await join();
  await list(b, "l_a", "A");
  await tickEvent(b, "l_a", e.id);
  await t.db.update(users).set({ deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, b.me.id));
  const { runDeletions } = await import("./auth/deletion.ts");
  assert.equal(await runDeletions(t.db, async () => {}, t.now()), 1);
  for (const table of [saves, lists, listEvents]) assert.equal((await t.db.select().from(table).where(eq(table.userId, b.me.id))).length, 0);
});

test("the host's count: null under 10, the number from 10, only active accounts, admins only", async () => {
  const a = await join();
  const h = await start(a);
  const e = await publish(a, h.id);
  const count = async () => (await as(a)("GET", `/events/${e.id}`)).body.saved;
  const people = [];
  for (let i = 0; i < 9; i++) people.push(await join());
  await give(people[0]!, [e.id]);
  for (const p of people.slice(1)) await as(p)("PUT", `/me/saves/${e.id}`);
  assert.equal(await count(), null); // 9
  const tenth = await join();
  await as(tenth)("PUT", `/me/saves/${e.id}`);
  assert.equal(await count(), 10);
  await t.db.update(users).set({ suspendedAt: new Date(t.now() - 1000), suspendedUntil: null }).where(eq(users.id, tenth.me.id));
  assert.equal(await count(), null); // suspended don't count
  await t.db.update(users).set({ suspendedUntil: new Date(t.now() - 500) }).where(eq(users.id, tenth.me.id));
  assert.equal(await count(), 10); // a suspension that ended does
  await t.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, tenth.me.id));
  assert.equal(await count(), null);
  assert.equal((await as(people[0]!)("GET", `/events/${e.id}`)).status, 404); // not on the team
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { title: "New title" })).body.saved, null);
});

test("a rename never makes a list again; a new list takes its first event in one go", async () => {
  const a = await join();
  const h = await start(a);
  const e = await publish(a, h.id), d = await draft(a, h.id);
  await list(a, "l_a", "A");
  assert.equal((await as(a)("DELETE", "/me/lists/l_a")).status, 204); // deleted on another phone
  const r = await rename(a, "l_a", "Renamed");
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "listGone");
  assert.deepEqual((await read(a)).lists, []);
  // An event that can't be opened: no list, no save.
  assert.equal((await list(a, "l_b", "B", d.id)).status, 404);
  assert.deepEqual(await read(a), { saved: [], lists: [], events: [] });
  const made = await list(a, "l_b", "B", e.id);
  assert.equal(made.status, 200);
  assert.deepEqual(made.body.events, [e.id]);
  assert.deepEqual(ids(await read(a)), [e.id]);
  assert.equal((await rename(a, "l_b", "B2")).body.name, "B2");
  assert.equal((await as(a)("PUT", "/me/lists/l_c", { name: "C", eventId: e.id })).status, 400); // an event needs `create`
});

test("restore: at the cap, a made-up time, and a body bigger than one insert", async () => {
  const a = await join(), b = await join();
  const h = await start(a);
  const like = await publish(a, h.id), extra = await publish(a, h.id);
  const many = await clones(like.id, 999);
  await give(b, many);
  const now = new Date(t.now()).toISOString();
  // One place left: the first of the two fits.
  assert.equal((await as(b)("POST", "/me/saves/restore", { saves: [{ eventId: like.id, at: now }, { eventId: extra.id, at: now }], lists: {} })).status, 204);
  assert.deepEqual(ids(await read(b)).filter((x) => x === like.id || x === extra.id), [like.id]);
  // Year 0 and the future are clamped, not a 500.
  const c = await join();
  for (const at of ["0000-01-01T00:00:00Z", "9999-12-31T00:00:00Z"])
    assert.equal((await as(c)("POST", "/me/saves/restore", { saves: [{ eventId: like.id, at }], lists: {} })).status, 204, at);
  const at = (await read(c)).saved[0]!.at;
  assert.ok(Date.parse(at) >= Date.parse("2026-01-01T00:00:00Z") && Date.parse(at) <= t.now(), at);
  // 1,000 events in 6 lists is 6,000 rows: more than one chunk.
  const d = await join();
  const more = [like.id, ...(await clones(like.id, 999))];
  for (let i = 1; i <= 6; i++) await list(d, `l_${i}`, `List ${i}`);
  const body = { saves: more.map((eventId) => ({ eventId, at: now })), lists: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`l_${i}`, more])) };
  assert.equal((await as(d)("POST", "/me/saves/restore", body)).status, 204);
  const r = await read(d);
  assert.equal(r.saved.length, 1000);
  assert.deepEqual(r.lists.map((l) => l.events.length), [1000, 1000, 1000, 1000, 1000, 1000]);
});

test("races: two lists at 49, and a remove during a tick", async () => {
  const a = await join();
  const h = await start(a);
  const e = await publish(a, h.id);
  for (let i = 1; i <= 49; i++) assert.equal((await list(a, `l_${i}`, `List ${i}`)).status, 200);
  const r = await Promise.all([list(a, "l_x", "X"), list(a, "l_y", "Y")]);
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await read(a)).lists.length, 50);
  // Whichever lands first, the event is never listed without being saved.
  for (let i = 0; i < 5; i++) {
    await Promise.all([tickEvent(a, "l_1", e.id), as(a)("POST", "/me/saves/remove", { eventIds: [e.id] }), as(a)("DELETE", "/me/lists/l_1")]);
    const s = await read(a);
    for (const l of s.lists) for (const x of l.events) assert.ok(ids(s).includes(x));
    await list(a, "l_1", "List 1").then((x) => x.status === 200 || assert.equal(x.status, 409));
  }
});

test("a hidden save inside a list is neither counted nor returned", async () => {
  const a = await join(), b = await join();
  const h = await start(a), h2 = await start(a);
  const like = await publish(a, h.id), off = await publish(a, h2.id);
  await list(b, "l_a", "A");
  await tickEvent(b, "l_a", off.id);
  await give(b, await clones(like.id, 999));
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, h2.id));
  assert.equal((await as(b)("PUT", `/me/saves/${like.id}`)).status, 204); // 999 openable + the hidden one: room for one more
  const r = await read(b);
  assert.equal(r.saved.length, 1000);
  assert.deepEqual(r.lists[0]!.events, []);
  assert.equal(r.events.length, 1000);
  assert.ok(!r.events.some((x) => x.id === off.id));
});
