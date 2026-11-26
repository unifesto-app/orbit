import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { auditLog, bookings, broadcasts, deliveries, events, follows, hosts, inboxItems, staffGrants, ticketTypes, users } from "./db/schema.ts";
import type { Notify } from "./http.ts";
import type { Device, Push, PushMessage } from "./push.ts";
import { runBroadcasts } from "./broadcasts.ts";
import { testApp } from "./testkit.ts";

// Broadcasts (notifications build plan PR 9).
let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const IST = 5.5 * HOUR;
// On to the next hh:00 India time, so quiet hours (23:00-07:00) are where each test wants them.
const goTo = (hour: number) => t.tick((hour * HOUR - ((t.now() + IST) % DAY) + DAY) % DAY || DAY);
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
const retireStaff = () => t.db.update(staffGrants).set({ endedAt: new Date(t.now()) }).where(isNull(staffGrants.endedAt));
const B = "/galaxy/notifications/broadcasts";
const draft = (city: string, more: Record<string, unknown> = {}) => ({ type: "news", segment: { city }, channels: ["push", "email"], title: "Orbit is live", text: "Book your first event.", ...more });
const run = (batch?: number, notify: Notify = t.notify) => runBroadcasts({ db: t.db, notify, now: t.now, batch });
const inbox = (u: P, kind = "orbitNews") => t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, u.me.id), eq(inboxItems.kind, kind)));
const rows = (u: P, kind = "orbitNews") => t.db.select().from(deliveries).where(and(eq(deliveries.userId, u.me.id), eq(deliveries.kind, kind)));
const of = (id: string) => t.db.select().from(deliveries).where(eq(deliveries.broadcastId, id));
const get = async (id: string) => (await t.db.select().from(broadcasts).where(eq(broadcasts.id, id)))[0]!;
const pushed: { d: Device; m: PushMessage }[] = [];
const one = async (d: Device, m: PushMessage) => `pid-${pushed.push({ d, m })}`;
const fake = { ios: one, android: one } as Push;
// The worker until nothing is due, then the tick again, which marks a broadcast sent once none of its rows is left.
const finish = async (batch?: number) => {
  await run(batch);
  for (let i = 0; i < 50 && (await t.deliver(fake)) > 0; i++);
  await run(batch);
};

test("one Platform holder: no one to confirm, so it goes by itself 24 hours on, audited and shown so", async () => {
  goTo(12);
  await retireStaff();
  const st = await staff();
  const a = await join("Siddipet");
  const r = await as(st)("POST", B, draft("Siddipet"));
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.status, r.body.audienceCount, r.body.autoAt, r.body.autoSent], ["waiting", 1, new Date(t.now() + DAY).toISOString(), false]);
  assert.equal(t.notices.filter((x) => x.kind === "broadcastWaiting").length, 0);
  assert.equal((await as(st)("POST", `${B}/${r.body.id}/confirm`)).status, 403);
  await run();
  assert.equal((await get(r.body.id)).status, "waiting");
  t.tick(DAY + 60_000);
  await finish();
  assert.equal((await get(r.body.id)).status, "sent");
  assert.equal((await inbox(a)).length, 1);
  const [audit] = await t.db.select().from(auditLog).where(eq(auditLog.action, "notifications.broadcastAutoSend"));
  assert.deepEqual([audit?.actorId, (audit?.data as { id: string }).id], [st.me.id, r.body.id]);
  const viewer = await staff();
  const shown = await as(viewer)("GET", `${B}/${r.body.id}`);
  assert.deepEqual([shown.status, shown.body.autoSent, shown.body.confirmer], [200, true, null]);
  await retireStaff();
});

test("the 24 h wait runs from when the author became the only holder; a suspended holder doesn't count", async () => {
  goTo(12);
  const [st, other] = [await staff(), await staff()];
  await join("Tirupati");
  const r = await as(st)("POST", B, draft("Tirupati"));
  assert.equal(r.body.autoAt, null);
  // The other holder is suspended: the author is alone from now.
  await t.db.update(users).set({ suspendedAt: new Date(t.now()) }).where(eq(users.id, other.me.id));
  await run();
  assert.equal((await get(r.body.id)).autoAt?.getTime(), t.now() + DAY);
  // Back 12 hours on: the wait is off and they're told it's waiting.
  t.tick(12 * HOUR);
  await t.db.update(users).set({ suspendedAt: null }).where(eq(users.id, other.me.id));
  const told = () => t.notices.filter((x) => x.kind === "broadcastWaiting" && (x.to as { userId: string }).userId === other.me.id).length;
  const before = told();
  await run();
  assert.equal((await get(r.body.id)).autoAt, null);
  assert.equal(told(), before + 1);
  await run();
  assert.equal(told(), before + 1);
  // They leave Platform: a fresh 24 hours from then, not from when it was written.
  await t.db.update(staffGrants).set({ endedAt: new Date(t.now()) }).where(eq(staffGrants.userId, other.me.id));
  await run();
  t.tick(DAY - 60_000);
  await run();
  assert.equal((await get(r.body.id)).status, "waiting");
  t.tick(2 * 60_000);
  await run();
  assert.notEqual((await get(r.body.id)).status, "waiting");
  await retireStaff();
});

test("the author can't confirm; another Platform holder can, once; the rest find nothing", async () => {
  goTo(12);
  await retireStaff();
  const [st, other] = [await staff(), await staff()];
  const plain = await join();
  assert.equal((await as(plain)("POST", B, draft("Warangal"))).status, 404);
  assert.equal((await as(plain)("GET", B)).status, 404);
  assert.equal((await as(plain)("POST", `${B}/count`, { segment: { all: true } })).status, 404);
  assert.equal((await as(st)("POST", B, { ...draft("Warangal"), type: "ad" })).status, 400);
  assert.equal((await as(st)("POST", B, draft("Atlantis"))).status, 400);
  assert.equal((await as(st)("POST", B, draft("Warangal", { title: "Two\nlines" }))).status, 400);
  assert.equal((await as(st)("POST", B, draft("Warangal", { title: "Two\rlines" }))).status, 400);
  const sendAt = (ms: number) => draft("Warangal", { sendAt: new Date(t.now() + ms).toISOString() });
  assert.equal((await as(st)("POST", B, sendAt(-10 * 60_000))).body.error, "badSendAt");
  assert.equal((await as(st)("POST", B, sendAt(91 * DAY))).body.error, "badSendAt");
  const r = await as(st)("POST", B, draft("Warangal"));
  assert.equal(r.body.autoAt, null);
  const told = t.notices.filter((x) => x.kind === "broadcastWaiting" && x.key === r.body.id).map((x) => (x.to as { userId: string }).userId);
  assert.deepEqual(told, [other.me.id]);
  assert.equal((await as(plain)("POST", `${B}/${r.body.id}/confirm`)).status, 404);
  assert.equal((await as(plain)("POST", `${B}/${r.body.id}/cancel`, { reason: "Not mine" })).status, 404);
  assert.equal((await as(plain)("GET", `${B}/${r.body.id}`)).status, 404);
  const own = await as(st)("POST", `${B}/${r.body.id}/confirm`);
  assert.deepEqual([own.status, own.body.error], [403, "ownBroadcast"]);
  const ok = await as(other)("POST", `${B}/${r.body.id}/confirm`);
  assert.deepEqual([ok.status, ok.body.status], [200, "sending"]);
  assert.equal((await as(other)("POST", `${B}/${r.body.id}/confirm`)).status, 409);
  const list = await as(other)("GET", B);
  const mine = list.body.items.find((b: any) => b.id === r.body.id);
  assert.deepEqual([mine.author.id, mine.confirmer.id, mine.autoSent], [st.me.id, other.me.id, false]);
  const one = await as(other)("GET", `${B}/${r.body.id}`);
  assert.deepEqual([one.status, one.body.id, one.body.title], [200, r.body.id, "Orbit is live"]);
  assert.equal((await as(other)("GET", `${B}/${randomUUID()}`)).status, 404);
  assert.equal((await as(other)("GET", `${B}/not-an-id`)).status, 404);
  const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "notifications.broadcastConfirm"));
  assert.equal(audits.length, 1);
  // A later send time: confirmed into scheduled, sent once it comes.
  const later = await as(st)("POST", B, sendAt(HOUR));
  assert.equal((await as(other)("POST", `${B}/${later.body.id}/confirm`)).body.status, "scheduled");
  // Cancelled while waiting, and while scheduled: neither goes.
  const waiting = await as(st)("POST", B, draft("Warangal"));
  assert.equal((await as(other)("POST", `${B}/${waiting.body.id}/cancel`, { reason: "Typo" })).status, 200);
  const scheduled = await as(st)("POST", B, sendAt(HOUR));
  await as(other)("POST", `${B}/${scheduled.body.id}/confirm`);
  assert.equal((await as(st)("POST", `${B}/${scheduled.body.id}/cancel`, { reason: "Not now" })).status, 200);
  await run();
  assert.equal((await get(later.body.id)).status, "scheduled");
  t.tick(HOUR);
  await finish();
  assert.equal((await get(later.body.id)).status, "sent");
  for (const id of [waiting.body.id, scheduled.body.id]) {
    const b = await get(id);
    assert.deepEqual([b.status, b.autoAt, b.sent], ["cancelled", null, 0]);
    assert.equal((await of(id)).length, 0);
  }
});

test("a confirmed broadcast reaches each person in its city once, in batches, with its title, and again sends nothing", async () => {
  goTo(12);
  const [st, other] = [await staff(), await staff()];
  const people = [await join("Nalgonda"), await join("Nalgonda"), await join("Nalgonda")];
  const away = await join("Khammam");
  const r = await as(st)("POST", B, draft("Nalgonda"));
  assert.equal(r.body.audienceCount, 3);
  await as(other)("POST", `${B}/${r.body.id}/confirm`);
  pushed.length = 0;
  await finish(2);
  const b = await get(r.body.id);
  assert.deepEqual([b.status, b.sent, b.failed], ["sent", 3, 0]);
  for (const u of people) {
    const [item, ...extra] = await inbox(u);
    assert.equal(extra.length, 0);
    assert.equal(item!.text, "Orbit is live: Book your first event.");
    const ds = await rows(u);
    assert.ok(ds.length >= 1 && ds.every((d) => d.broadcastId === r.body.id));
    assert.equal(ds.filter((d) => d.channel === "push").length, 1);
  }
  const ours = pushed.filter((p) => p.m.title === "Orbit is live");
  assert.equal(ours.length, 3);
  assert.ok(ours.every((p) => p.m.body === "Book your first event."));
  assert.equal((await inbox(away)).length, 0);
  const before = (await of(r.body.id)).length;
  await t.db.update(broadcasts).set({ status: "sending", cursor: null }).where(eq(broadcasts.id, r.body.id));
  await run(2);
  assert.equal((await of(r.body.id)).length, before);
});

test("a cancel stops the rest and the pushes already queued: none of its rows sends", async () => {
  goTo(12);
  const [st, other] = [await staff(), await staff()];
  const people = [];
  for (let i = 0; i < 5; i++) people.push(await join("Nizamabad"));
  const r = await as(st)("POST", B, draft("Nizamabad"));
  await as(other)("POST", `${B}/${r.body.id}/confirm`);
  // The cancel lands after the first person's rows and before the second's: the cancel drops the first's, the worker the second's.
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
  pushed.length = 0;
  await finish();
  assert.equal(pushed.length, 0);
  const pushes = (await of(r.body.id)).filter((d) => d.channel === "push");
  assert.deepEqual(pushes.map((d) => [d.status, d.reason]), [["dropped", "cancelled"], ["dropped", "cancelled"]]);
  assert.equal((await as(other)("POST", `${B}/${r.body.id}/cancel`, { reason: "Again" })).status, 409);
  assert.equal((await as(other)("POST", `${B}/${r.body.id}/cancel`, { reason: "" })).status, 400);
  // Every person written, pushes still queued: the cancel itself drops them, and it never shows as sent.
  const all = await as(st)("POST", B, draft("Nizamabad", { title: "Second" }));
  await as(other)("POST", `${B}/${all.body.id}/confirm`);
  await run();
  assert.equal((await get(all.body.id)).status, "sending");
  assert.equal((await of(all.body.id)).filter((d) => d.channel === "push" && d.status === "queued").length, 5);
  assert.equal((await as(other)("POST", `${B}/${all.body.id}/cancel`, { reason: "Changed my mind" })).status, 200);
  assert.deepEqual([...new Set((await of(all.body.id)).filter((d) => d.channel === "push").map((d) => `${d.status}:${d.reason}`))], ["dropped:cancelled"]);
  await finish();
  assert.equal(pushed.length, 0);
  assert.equal((await get(all.body.id)).status, "cancelled");
});

test("a restart mid-batch (cursor not saved) writes no second rows", async () => {
  goTo(12);
  const [st, other] = [await staff(), await staff()];
  const people = [await join("Karimnagar"), await join("Karimnagar"), await join("Karimnagar")];
  const r = await as(st)("POST", B, draft("Karimnagar"));
  await as(other)("POST", `${B}/${r.body.id}/confirm`);
  // The first two were written before the crash; the cursor and counts weren't saved.
  const first = [...people].sort((x, y) => (x.me.id < y.me.id ? -1 : 1)).slice(0, 2);
  for (const u of first)
    await t.notify({ to: { userId: u.me.id }, kind: "orbitNews", data: { title: "Orbit is live", text: "Book your first event." }, key: `broadcast:${r.body.id}`, broadcastId: r.body.id, channels: ["push", "email"] });
  await finish();
  for (const u of people) {
    assert.equal((await inbox(u)).length, 1);
    const ds = await rows(u);
    assert.equal(new Set(ds.map((d) => `${d.channel}:${d.target}`)).size, ds.length);
  }
  assert.equal((await get(r.body.id)).status, "sent");
});

test("news honours the From Orbit switch and the channels picked; a notice ignores the switch", async () => {
  goTo(12);
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

test("news keeps quiet hours and the daily cap; a notice ignores both", async () => {
  goTo(23);
  t.tick(30 * 60_000); // 23:30 India time
  const [st, other] = [await staff(), await staff()];
  const night = await join("Nellore");
  const send = async (city: string, body: Record<string, unknown> = {}) => {
    const r = await as(st)("POST", B, draft(city, { channels: ["push"], ...body }));
    assert.equal(r.status, 201);
    await as(other)("POST", `${B}/${r.body.id}/confirm`);
    await run();
  };
  await send("Nellore");
  assert.deepEqual((await rows(night)).map((d) => d.status), ["held"]);
  await send("Nellore", { type: "notice" });
  assert.deepEqual((await rows(night, "orbitNotice")).map((d) => d.status), ["queued"]);

  goTo(12);
  const [st2, other2] = [await staff(), await staff()];
  const day = await join("Adilabad");
  // Five Orbit news pushes already today fill the cap.
  for (let i = 0; i < 5; i++) await t.notify({ to: { userId: day.me.id }, kind: "orbitNews", data: { title: `News ${i}`, text: "Hi" }, key: `fill-${i}` });
  const sendDay = async (body: Record<string, unknown> = {}) => {
    const r = await as(st2)("POST", B, draft("Adilabad", { channels: ["push"], ...body }));
    await as(other2)("POST", `${B}/${r.body.id}/confirm`);
    await run();
    return r.body.id as string;
  };
  const news = await sendDay();
  assert.deepEqual((await of(news)).map((d) => [d.status, d.reason]), [["skipped", "capReached"]]);
  assert.equal((await inbox(day)).filter((i) => i.text.startsWith("Orbit is live")).length, 1);
  const notice = await sendDay({ type: "notice" });
  assert.deepEqual((await of(notice)).map((d) => d.status), ["queued"]);
});

test("the news email has the unsubscribe link; a service notice's doesn't", async () => {
  goTo(12);
  const [st, other] = [await staff(), await staff()];
  const u = await join("Kurnool");
  const address = `broadcast-${randomUUID()}@example.com`;
  await t.db.update(users).set({ email: address, emailVerifiedAt: new Date(t.now()) }).where(eq(users.id, u.me.id));
  for (const [type, title] of [["news", "Big news"], ["notice", "Planned downtime"]]) {
    const r = await as(st)("POST", B, draft("Kurnool", { type, title, channels: ["email"] }));
    await as(other)("POST", `${B}/${r.body.id}/confirm`);
  }
  await finish();
  const mail = (subject: string) => t.mails.find((m) => m.to === address && m.subject === subject);
  assert.match(mail("Big news")!.text, /Stop them: https:\/\/api\.test/);
  assert.doesNotMatch(mail("Planned downtime")!.text, /Stop them/);
});

test("segment counts: everyone, a city, a host's followers, an event's guests; a host's followers get it", async () => {
  goTo(12);
  const [st, other] = [await staff(), await staff()];
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
  const r = await as(st)("POST", B, { ...draft("Ramagundam"), segment: { hostId: h!.id }, title: "From H" });
  assert.equal(r.body.audienceCount, 2);
  await as(other)("POST", `${B}/${r.body.id}/confirm`);
  await finish();
  assert.deepEqual([(await get(r.body.id)).status, (await get(r.body.id)).sent], ["sent", 2]);
  for (const u of [a, b]) assert.equal((await inbox(u)).filter((i) => i.text.startsWith("From H")).length, 1);
});
