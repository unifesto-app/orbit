import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { auditLog, bookings, broadcasts, deliveries, events, follows, hosts, inboxItems, staffGrants, ticketTypes, users } from "./db/schema.ts";
import type { Notify } from "./http.ts";
import { runBroadcasts } from "./broadcasts.ts";
import { testApp } from "./testkit.ts";

// Broadcasts (notifications build plan PR 9).
let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const DAY = 24 * 3600_000;
let n = 0;
const phone = () => `6${String(4_000_000 + ++n * 13).padStart(9, "0")}`;
type P = { access: string; me: { id: string } };
const join = async (city?: string): Promise<P> => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  assert.equal((await t.call("PUT", "/me/push-device", { app: "orbit", platform: "ios", env: "sandbox", token: `tok-${n}` }, s.body.access)).status, 204);
  if (city) await t.db.update(users).set({ city }).where(eq(users.id, s.body.me.id));
  return s.body;
};
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const staff = async () => {
  const u = await join();
  await t.db.insert(staffGrants).values({ userId: u.me.id, feature: "platform", addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return u;
};
const B = "/galaxy/notifications/broadcasts";
const draft = (city: string, more: Record<string, unknown> = {}) => ({ type: "news", segment: { city }, channels: ["push", "email"], title: "Orbit is live", text: "Book your first event.", ...more });
const run = (batch?: number, notify: Notify = t.notify) => runBroadcasts({ db: t.db, notify, now: t.now, batch });
const inbox = (u: P, kind = "orbitNews") => t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, u.me.id), eq(inboxItems.kind, kind)));
const rows = (u: P, kind = "orbitNews") => t.db.select().from(deliveries).where(and(eq(deliveries.userId, u.me.id), eq(deliveries.kind, kind)));
const get = async (id: string) => (await t.db.select().from(broadcasts).where(eq(broadcasts.id, id)))[0]!;

test("one Platform holder: no one to confirm, so it goes by itself 24 hours on", async () => {
  const st = await staff();
  const a = await join("Siddipet");
  const r = await as(st)("POST", B, draft("Siddipet"));
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.status, r.body.audienceCount, r.body.autoAt], ["waiting", 1, new Date(t.now() + DAY).toISOString()]);
  assert.equal(t.notices.filter((x) => x.kind === "broadcastWaiting").length, 0);
  assert.equal((await as(st)("POST", `${B}/${r.body.id}/confirm`)).status, 403);
  await run();
  assert.equal((await get(r.body.id)).status, "waiting");
  t.tick(DAY + 60_000);
  await run();
  assert.equal((await get(r.body.id)).status, "sent");
  assert.equal((await inbox(a)).length, 1);
  // Retire this holder so the next tests have two.
  await t.db.update(staffGrants).set({ endedAt: new Date(t.now()) }).where(isNull(staffGrants.endedAt));
});

test("the author can't confirm; another Platform holder can, once; the rest find nothing", async () => {
  const [st, other] = [await staff(), await staff()];
  const plain = await join();
  assert.equal((await as(plain)("POST", B, draft("Warangal"))).status, 404);
  assert.equal((await as(plain)("GET", B)).status, 404);
  assert.equal((await as(st)("POST", B, { ...draft("Warangal"), type: "ad" })).status, 400);
  assert.equal((await as(st)("POST", B, draft("Atlantis"))).status, 400);
  const r = await as(st)("POST", B, draft("Warangal"));
  assert.equal(r.body.autoAt, null);
  const told = t.notices.filter((x) => x.kind === "broadcastWaiting").map((x) => (x.to as { userId: string }).userId);
  assert.deepEqual(told, [other.me.id]);
  const own = await as(st)("POST", `${B}/${r.body.id}/confirm`);
  assert.deepEqual([own.status, own.body.error], [403, "ownBroadcast"]);
  const ok = await as(other)("POST", `${B}/${r.body.id}/confirm`);
  assert.deepEqual([ok.status, ok.body.status], [200, "sending"]);
  assert.equal((await as(other)("POST", `${B}/${r.body.id}/confirm`)).status, 409);
  const list = await as(other)("GET", B);
  const mine = list.body.items.find((b: any) => b.id === r.body.id);
  assert.deepEqual([mine.author.id, mine.confirmer.id], [st.me.id, other.me.id]);
  const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "notifications.broadcastConfirm"));
  assert.equal(audits.length, 1);
  // A later send time: confirmed into scheduled, sent once it comes.
  const later = await as(st)("POST", B, draft("Warangal", { sendAt: new Date(t.now() + 3600_000).toISOString() }));
  assert.equal((await as(other)("POST", `${B}/${later.body.id}/confirm`)).body.status, "scheduled");
  await run();
  assert.equal((await get(later.body.id)).status, "scheduled");
  t.tick(3600_000);
  await run();
  assert.equal((await get(later.body.id)).status, "sent");
});

test("a confirmed broadcast reaches each person in its city once, in batches, and again sends nothing", async () => {
  const [st, other] = [await staff(), await staff()];
  const people = [await join("Nalgonda"), await join("Nalgonda"), await join("Nalgonda")];
  const away = await join("Khammam");
  const r = await as(st)("POST", B, draft("Nalgonda"));
  assert.equal(r.body.audienceCount, 3);
  await as(other)("POST", `${B}/${r.body.id}/confirm`);
  await run(2);
  const b = await get(r.body.id);
  assert.deepEqual([b.status, b.sent, b.failed], ["sent", 3, 0]);
  for (const u of people) {
    const [item, ...extra] = await inbox(u);
    assert.equal(extra.length, 0);
    assert.equal(item!.text, "Book your first event.");
    const ds = await rows(u);
    assert.ok(ds.length >= 1 && ds.every((d) => d.broadcastId === r.body.id));
    assert.equal(ds.filter((d) => d.channel === "push").length, 1);
  }
  assert.equal((await inbox(away)).length, 0);
  const before = (await t.db.select().from(deliveries).where(eq(deliveries.broadcastId, r.body.id))).length;
  await t.db.update(broadcasts).set({ status: "sending", cursor: null }).where(eq(broadcasts.id, r.body.id));
  await run(2);
  assert.equal((await t.db.select().from(deliveries).where(eq(deliveries.broadcastId, r.body.id))).length, before);
});

test("a cancel between batches stops the rest", async () => {
  const [st, other] = [await staff(), await staff()];
  const people = [];
  for (let i = 0; i < 5; i++) people.push(await join("Nizamabad"));
  const r = await as(st)("POST", B, draft("Nizamabad"));
  await as(other)("POST", `${B}/${r.body.id}/confirm`);
  let calls = 0;
  const cancelling: Notify = async (x, tx) => {
    await t.notify(x, tx);
    if (++calls === 1) assert.equal((await as(other)("POST", `${B}/${r.body.id}/cancel`, { reason: "Wrong city" })).status, 200);
  };
  await run(2, cancelling);
  const b = await get(r.body.id);
  assert.deepEqual([b.status, b.sent, b.reason], ["cancelled", 2, "Wrong city"]);
  let reached = 0;
  for (const u of people) reached += (await inbox(u)).length;
  assert.equal(reached, 2);
  assert.equal((await as(other)("POST", `${B}/${r.body.id}/cancel`, { reason: "Again" })).status, 409);
  assert.equal((await as(other)("POST", `${B}/${r.body.id}/cancel`, { reason: "" })).status, 400);
});

test("a restart mid-batch (cursor not saved) writes no second rows", async () => {
  const [st, other] = [await staff(), await staff()];
  const people = [await join("Karimnagar"), await join("Karimnagar"), await join("Karimnagar")];
  const r = await as(st)("POST", B, draft("Karimnagar"));
  await as(other)("POST", `${B}/${r.body.id}/confirm`);
  // The first two were written before the crash; the cursor and counts weren't saved.
  const first = [...people].sort((x, y) => (x.me.id < y.me.id ? -1 : 1)).slice(0, 2);
  for (const u of first)
    await t.notify({ to: { userId: u.me.id }, kind: "orbitNews", data: { title: "Orbit is live", text: "Book your first event." }, key: `broadcast:${r.body.id}`, broadcastId: r.body.id, channels: ["push", "email"] });
  await run();
  for (const u of people) {
    assert.equal((await inbox(u)).length, 1);
    const ds = await rows(u);
    assert.equal(new Set(ds.map((d) => `${d.channel}:${d.target}`)).size, ds.length);
  }
  assert.equal((await get(r.body.id)).status, "sent");
});

test("news honours the From Orbit switch and the channels picked; a notice ignores the switch", async () => {
  const [st, other] = [await staff(), await staff()];
  const u = await join("Suryapet");
  assert.equal((await as(u)("PUT", "/me/notification-settings", { switches: { "push.orbit": false } })).status, 200);
  const send = async (body: Record<string, unknown>) => {
    const r = await as(st)("POST", B, draft("Suryapet", body));
    assert.equal(r.status, 201);
    await as(other)("POST", `${B}/${r.body.id}/confirm`);
    await run();
  };
  await send({});
  assert.deepEqual((await rows(u)).filter((d) => d.channel === "push").map((d) => [d.status, d.reason]), [["skipped", "switchOff"]]);
  assert.equal((await inbox(u)).length, 1);
  await send({ type: "notice", title: "Planned downtime" });
  assert.deepEqual((await rows(u, "orbitNotice")).filter((d) => d.channel === "push").map((d) => d.status), ["queued"]);
  await send({ type: "notice", channels: [] });
  const inboxOnly = (await rows(u, "orbitNotice")).filter((d) => d.payload.title === "Orbit is live");
  assert.equal(inboxOnly.length, 0);
  assert.equal((await inbox(u, "orbitNotice")).length, 2);
});

test("segment counts: everyone, a city, a host's followers, an event's guests", async () => {
  const st = await staff();
  const [a, b] = [await join("Ramagundam"), await join("Ramagundam")];
  const count = async (segment: object) => (await as(st)("POST", `${B}/count`, { segment })).body.audienceCount;
  assert.equal(await count({ city: "Ramagundam" }), 2);
  assert.equal(await count({ all: true }), (await t.db.select().from(users).where(isNull(users.deletedAt))).length);
  const [h] = await t.db
    .insert(hosts)
    .values({ name: "H", slug: `h-${randomUUID()}`, kind: "venue", city: "Hyderabad", status: "live", ownerId: st.me.id, createdBy: st.me.id })
    .returning({ id: hosts.id });
  await t.db.insert(follows).values([{ userId: a.me.id, hostId: h!.id }, { userId: b.me.id, hostId: h!.id }]);
  assert.equal(await count({ hostId: h!.id }), 2);
  const [e] = await t.db.insert(events).values({ hostId: h!.id, slug: `e-${randomUUID()}`, title: "E", status: "published", createdBy: st.me.id }).returning({ id: events.id });
  assert.equal(await count({ eventId: e!.id }), 0);
  const [tt] = await t.db.insert(ticketTypes).values({ eventId: e!.id, name: "General" }).returning({ id: ticketTypes.id });
  await t.db.insert(bookings).values({ userId: a.me.id, eventId: e!.id, ticketTypeId: tt!.id, quantity: 2, qr: randomUUID(), code: randomUUID() });
  assert.equal(await count({ eventId: e!.id }), 1);
  assert.equal((await as(st)("POST", `${B}/count`, { segment: { hostId: randomUUID() } })).status, 400);
  assert.equal((await as(st)("POST", `${B}/count`, { segment: { city: "Hyderabad", all: true } })).status, 400);
});
