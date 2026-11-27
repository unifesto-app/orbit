import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import sharp from "sharp";
import { KINDS, type NoticeKind, PUSH_SWITCHES } from "@orbit/contract";
import { deliveries, events, follows, hosts, inboxItems, notificationPrefs, pushDevices, sessions, users } from "./db/schema.ts";
import { pruneNotifications, releaseHeld } from "./notifications.ts";
import { testApp } from "./testkit.ts";

// Notifications PR 2 against a real database: the person's routes, switches, caps, quiet hours, devices and publish.
let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, IST = 330 * MIN;
// To the next given hour, India time (a fresh sign-in after it: access tokens last 15 minutes).
const goTo = (hour: number) => t.tick((hour * HOUR - ((t.now() + IST) % DAY) + DAY) % DAY || DAY);
const istHour = (d: Date) => ((d.getTime() + IST) % DAY) / HOUR;

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `7${String(5_000_000 + ++n * 13).padStart(9, "0")}`;
type A = { p: string; access: string; me: { id: string } };
const join = async (o: { email?: boolean; city?: string } = {}): Promise<A> => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  const set = { ...(o.email ? { email: `m${n}@example.com`, emailVerifiedAt: new Date(t.now()) } : {}), ...(o.city ? { city: o.city } : {}) };
  if (Object.keys(set).length) await t.db.update(users).set(set).where(eq(users.id, s.body.me.id));
  return { p, ...s.body };
};
const as = (a: A) => (m: string, path: string, body?: unknown) => t.call(m, path, body, a.access);
const addDevice = (a: A, token = `tok-${++n}`, app = "orbit") => as(a)("PUT", "/me/push-device", { app, platform: "ios", env: "sandbox", token });
// Someone with a phone on the people app.
const ready = async (o: { email?: boolean; city?: string } = {}) => {
  const a = await join(o);
  assert.equal((await addDevice(a)).status, 204);
  return a;
};
const settings = (a: A, body: object) => as(a)("PUT", "/me/notification-settings", body);
const sent = (a: A, kind: NoticeKind, channel: "push" | "email") =>
  t.db.select().from(deliveries).where(and(eq(deliveries.userId, a.me.id), eq(deliveries.kind, kind), eq(deliveries.channel, channel))).orderBy(asc(deliveries.createdAt));
const last = async (a: A, kind: NoticeKind, channel: "push" | "email") => (await sent(a, kind, channel)).at(-1)!;
// A millisecond on per notice, so last() can order by created time (the rows have no other order).
const tell = (a: A, kind: NoticeKind, data: Record<string, unknown> = {}, key?: string) => (t.tick(1), t.notify({ to: { userId: a.me.id }, kind, data, key }));
const inboxOf = (a: A) => t.db.select().from(inboxItems).where(eq(inboxItems.userId, a.me.id));

// A push kind for each switch.
const PUSH_KIND: Record<(typeof PUSH_SWITCHES)[number], NoticeKind> = {
  tickets: "finishBooking", reminders: "eventTomorrow", follows: "followedHostEvent", near: "nearYou",
  announcements: "hostAnnouncement", inRoom: "inRoomAsk", orbit: "orbitNews", yourHosts: "teamRoleStarted",
};

test("each switch off skips its channel's row; master push off skips every non-Must push", async () => {
  goTo(12);
  const a = await ready({ email: true, city: "Hyderabad" });
  for (const [sw, kind] of Object.entries(PUSH_KIND) as [keyof typeof PUSH_KIND, NoticeKind][]) {
    assert.equal(KINDS[kind].switch, sw);
    assert.equal((await settings(a, { switches: { [`push.${sw}`]: false } })).status, 200);
    await tell(a, kind, { hostId: crypto.randomUUID() });
    assert.deepEqual([(await last(a, kind, "push")).status, (await last(a, kind, "push")).reason], ["skipped", "switchOff"], sw);
    assert.equal((await inboxOf(a)).filter((i) => i.kind === kind).length, 1, `${sw}: the inbox still fills`);
    await settings(a, { switches: { [`push.${sw}`]: true } });
  }
  // Email: the switches with an "always" kind behind them. Reminders and follows only govern "fallback" email (PR 4),
  // written above when their push was switched off. Optional email queues (PR 6) until its switch is off.
  for (const [sw, kind] of [["announcements", "hostAnnouncement"], ["orbit", "orbitNews"], ["yourHosts", "teamRoleStarted"]] as const) {
    await tell(a, kind);
    assert.equal((await last(a, kind, "email")).status, "queued", sw);
    await settings(a, { switches: { [`email.${sw}`]: false } });
    await tell(a, kind);
    assert.deepEqual([(await last(a, kind, "email")).status, (await last(a, kind, "email")).reason], ["skipped", "switchOff"], sw);
  }
  for (const kind of ["eventTomorrow", "followedHostEvent"] as const)
    assert.deepEqual((await sent(a, kind, "email")).map((d) => d.status), ["queued"], kind); // the push couldn't land

  const b = await ready({ city: "Hyderabad" });
  await settings(b, { push: false });
  for (const kind of Object.values(PUSH_KIND)) {
    await tell(b, kind, { hostId: crypto.randomUUID() });
    assert.equal((await last(b, kind, "push")).reason, "switchOff", kind);
  }
  await tell(b, "signInMethodChanged", { method: "passkey", change: "added" });
  assert.equal((await last(b, "signInMethodChanged", "push")).status, "queued");
});

const hostAndEvent = async (a: A, startsIn = 2 * DAY) => {
  const h = (await as(a)("POST", "/hosts", { name: `Club ${++n}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
  const [e] = await t.db
    .insert(events)
    .values({ hostId: h.id, slug: `e-${n}`, title: "Open Mic", status: "published", startsAt: new Date(t.now() + startsIn), endsAt: new Date(t.now() + startsIn + HOUR), createdBy: a.me.id })
    .returning();
  return { hostId: h.id, eventId: e!.id };
};

test("quiet hours: a Low push at 23:00 is held until 07:00, then queued; a cancelled event's is dropped stale", async () => {
  goTo(23);
  const a = await ready();
  const one = await hostAndEvent(a), two = await hostAndEvent(a);
  await tell(a, "eventStartingSoon", { eventId: one.eventId });
  await tell(a, "eventStartingSoon", { eventId: two.eventId });
  const held = await sent(a, "eventStartingSoon", "push");
  assert.deepEqual(held.map((d) => d.status), ["held", "held"]);
  assert.equal(istHour(held[0]!.runAt), 7);
  assert.ok(held[0]!.runAt.getTime() - t.now() > 7 * HOUR && held[0]!.runAt.getTime() - t.now() <= 8 * HOUR);
  assert.equal((await inboxOf(a)).length, 2);
  // A Normal push isn't held.
  await tell(a, "eventTomorrow", { eventId: one.eventId });
  assert.equal((await last(a, "eventTomorrow", "push")).status, "queued");

  await t.db.update(events).set({ status: "cancelled", cancelledAt: new Date(t.now()) }).where(eq(events.id, two.eventId));
  t.tick(7 * HOUR + 59 * MIN);
  assert.equal(await releaseHeld({ db: t.db, now: t.now }), 0); // 06:59: not yet
  t.tick(MIN);
  assert.equal(await releaseHeld({ db: t.db, now: t.now }), 2);
  const out = await sent(a, "eventStartingSoon", "push");
  const byEvent = (id: string) => out.find((d) => d.payload.eventId === id)!;
  assert.deepEqual([byEvent(one.eventId).status, byEvent(one.eventId).runAt.getTime()], ["queued", t.now()]);
  assert.deepEqual([byEvent(two.eventId).status, byEvent(two.eventId).reason], ["dropped", "stale"]);
  // No push sender given: the worker records it as not set up.
  await t.deliver();
  assert.deepEqual([(await sent(a, "eventStartingSoon", "push")).find((d) => d.id === byEvent(one.eventId).id)!.status], ["skipped"]);
});

test("a held push whose device went, whose sign-in ended or whose switch went off is dropped at release", async () => {
  goTo(23);
  const a = await ready(), b = await ready(), c = await ready();
  for (const u of [a, b, c]) await tell(u, "eventStartingSoon");
  assert.equal((await as(a)("DELETE", "/me/push-device")).status, 204);
  await settings(b, { switches: { "push.reminders": false } });
  await t.db.update(sessions).set({ endedAt: new Date(t.now()) }).where(eq(sessions.userId, c.me.id));
  t.tick(8 * HOUR);
  await releaseHeld({ db: t.db, now: t.now });
  assert.deepEqual([(await last(a, "eventStartingSoon", "push")).status, (await last(a, "eventStartingSoon", "push")).reason], ["dropped", "noDevice"]);
  assert.deepEqual([(await last(b, "eventStartingSoon", "push")).status, (await last(b, "eventStartingSoon", "push")).reason], ["dropped", "switchOff"]);
  assert.deepEqual([(await last(c, "eventStartingSoon", "push")).status, (await last(c, "eventStartingSoon", "push")).reason], ["dropped", "noDevice"]);
});

test("release: a broken held row is dropped as error and the queue goes on; post-event kinds are never stale", async () => {
  goTo(7);
  const a = await ready({ email: true });
  const ev = await hostAndEvent(a, -HOUR); // started an hour ago
  const [s] = await t.db.select().from(sessions).where(eq(sessions.userId, a.me.id));
  const held = (kind: string, payload: Record<string, unknown>) => ({
    userId: a.me.id, kind, channel: "push", target: s!.id, status: "held", runAt: new Date(t.now() - MIN), payload, dedupeKey: `h-${++n}`,
  });
  const made = await t.db
    .insert(deliveries)
    .values([held("noSuchKind", {}), held("eventStartingSoon", { eventId: "not-a-uuid-------------------------!" }), held("thanksForComing", { eventId: ev.eventId })] as (typeof deliveries.$inferInsert)[])
    .returning();
  await tell(a, "signInMethodChanged", { method: "passkey", change: "added" }); // a Must email behind them
  await t.deliver();
  const now = await t.db.select().from(deliveries).where(eq(deliveries.userId, a.me.id));
  const of = (i: number) => now.find((d) => d.id === made[i]!.id)!;
  assert.deepEqual([of(0).status, of(0).reason], ["dropped", "error"]);
  assert.notEqual(of(1).status, "held"); // a bad event id is no event: released, not thrown
  assert.notEqual(of(2).status, "dropped"); // thanks for coming is about an event that has happened: never stale
  assert.equal((await last(a, "signInMethodChanged", "email")).status, "sent");
});

test("caps: a sixth Low push in a day is inbox only, Normal isn't counted; one followed-host push a day per host", async () => {
  goTo(10);
  const a = await ready({ city: "Hyderabad" }); // near needs a city
  for (let i = 0; i < 3; i++) await tell(a, "finishBooking");
  await t.deliver(); // the first three become "not set up", and still count
  for (let i = 0; i < 2; i++) await tell(a, "nearYou");
  await tell(a, "eventStartingSoon");
  const pushes = (await t.db.select().from(deliveries).where(and(eq(deliveries.userId, a.me.id), eq(deliveries.channel, "push")))).map((d) => d.reason ?? d.status);
  assert.deepEqual(pushes.sort(), ["capReached", "notSetUp", "notSetUp", "notSetUp", "queued", "queued"]);
  assert.equal((await inboxOf(a)).length, 6);
  await tell(a, "eventTomorrow"); // Normal: past the five, still goes
  assert.equal((await last(a, "eventTomorrow", "push")).status, "queued");
  // A new India day starts the count again.
  goTo(7); // the next morning, out of quiet hours
  await tell(a, "eventStartingSoon");
  assert.equal((await last(a, "eventStartingSoon", "push")).status, "queued");

  goTo(10);
  const b = await ready();
  const h1 = crypto.randomUUID(), h2 = crypto.randomUUID();
  await tell(b, "followedHostEvent", { hostId: h1, title: "One" });
  await tell(b, "followedHostEvent", { hostId: h1, title: "Two" });
  await tell(b, "followedHostEvent", { hostId: h2, title: "Three" });
  const byTitle = (await sent(b, "followedHostEvent", "push")).map((d) => [d.payload.title, d.status, d.reason]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  assert.deepEqual(byTitle, [["One", "queued", null], ["Three", "queued", null], ["Two", "skipped", "capReached"]]); // no row order in SQL
});

test("caps count by the day a push delivers: five held overnight fill the morning", async () => {
  goTo(23);
  const a = await ready();
  for (let i = 0; i < 5; i++) await tell(a, "finishBooking");
  assert.deepEqual((await sent(a, "finishBooking", "push")).map((d) => d.status), ["held", "held", "held", "held", "held"]);
  goTo(8); // the India day those five deliver on
  await tell(a, "eventStartingSoon");
  assert.deepEqual([(await last(a, "eventStartingSoon", "push")).status, (await last(a, "eventStartingSoon", "push")).reason], ["skipped", "capReached"]);
});

test("a Must kind ignores switches, caps and quiet hours", async () => {
  goTo(23);
  const a = await ready({ email: true });
  await settings(a, { push: false, switches: Object.fromEntries(PUSH_SWITCHES.map((s) => [`push.${s}`, false])) });
  await t.db.update(notificationPrefs).set({ push: true }).where(eq(notificationPrefs.userId, a.me.id));
  for (let i = 0; i < 5; i++) await tell(a, "finishBooking");
  await t.db.update(deliveries).set({ status: "queued", reason: null }).where(and(eq(deliveries.userId, a.me.id), eq(deliveries.channel, "push"))); // five counted
  await tell(a, "signInMethodChanged", { method: "passkey", change: "added" });
  const push = await last(a, "signInMethodChanged", "push");
  assert.deepEqual([push.status, push.runAt.getTime()], ["queued", t.now()]);
  assert.equal((await last(a, "signInMethodChanged", "email")).status, "queued");
});

test("a token moves: the second account's PUT takes it, the first has no device; one row per live device", async () => {
  goTo(12);
  const a = await join(), b = await join();
  assert.equal((await addDevice(a, "shared-token")).status, 204);
  assert.equal((await addDevice(b, "shared-token")).status, 204);
  const rows = await t.db.select().from(pushDevices).where(eq(pushDevices.token, "shared-token"));
  assert.deepEqual(rows.map((r) => r.userId), [b.me.id]);
  assert.equal((await t.db.select().from(pushDevices).where(eq(pushDevices.userId, a.me.id))).length, 0);
  await tell(a, "orbitNews");
  assert.equal((await last(a, "orbitNews", "push")).reason, "noDevice");
  await tell(b, "orbitNews");
  const [bs] = await t.db.select().from(sessions).where(eq(sessions.userId, b.me.id));
  assert.deepEqual([(await last(b, "orbitNews", "push")).status, (await last(b, "orbitNews", "push")).target], ["queued", bs!.id]);
  // An ended sign-in's device is not live.
  await t.db.update(sessions).set({ endedAt: new Date(t.now()) }).where(eq(sessions.id, bs!.id));
  await tell(b, "orbitNews");
  assert.equal((await last(b, "orbitNews", "push")).reason, "noDevice");
  // A device on another app isn't the people app's.
  assert.equal((await as(a)("PUT", "/me/push-device", { app: "web", platform: "ios", env: "sandbox", token: "x" })).status, 400);
});

test("signing in again on the same phone drops the old session's token row; signing out drops it too", async () => {
  goTo(12);
  const a = (await join()) as A & { device: string };
  assert.equal((await addDevice(a, "again-token")).status, 204);
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: a.p })).status, 200);
  const again = await t.call("POST", "/auth/code/verify", { to: a.p, code: t.lastCode(`+91${a.p}`), device: { ...device, id: a.device } });
  assert.equal(again.status, 200);
  assert.equal(again.body.step, "signedIn");
  assert.equal(again.body.device, a.device); // the same device, so the same session row with a new id
  assert.equal((await t.db.select().from(pushDevices).where(eq(pushDevices.userId, a.me.id))).length, 0);
  // The new session sends the token again, then signs out: the row goes with it.
  const b = { ...a, access: again.body.access };
  assert.equal((await addDevice(b, "again-token")).status, 204);
  assert.equal((await t.db.select().from(pushDevices).where(eq(pushDevices.userId, a.me.id))).length, 1);
  assert.equal((await as(b)("POST", "/auth/signout")).status, 204);
  assert.equal((await t.db.select().from(pushDevices).where(eq(pushDevices.userId, a.me.id))).length, 0);
});

test("settings: GET fills the defaults (near follows the city); PUT stores only what differs", async () => {
  goTo(12);
  const a = await join(), b = await join({ city: "Pune" });
  const got = (await as(a)("GET", "/me/notification-settings")).body;
  assert.deepEqual([got.push, got.quiet, got.switches["push.near"], got.switches["push.tickets"], got.switches["email.orbit"]], [true, true, false, true, true]);
  assert.equal(Object.keys(got.switches).length, 13);
  assert.equal((await as(b)("GET", "/me/notification-settings")).body.switches["push.near"], true);

  const put = await settings(a, { quiet: false, switches: { "push.near": true, "email.orbit": false, "push.tickets": true } });
  assert.equal(put.status, 200);
  assert.deepEqual([put.body.quiet, put.body.switches["push.near"], put.body.switches["email.orbit"]], [false, true, false]);
  const stored = async (u: A) => (await t.db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.me.id)))[0]!;
  assert.deepEqual((await stored(a)).switches, { "push.near": true, "email.orbit": false });
  await settings(a, { switches: { "email.orbit": true } });
  assert.deepEqual([(await stored(a)).switches, (await stored(a)).quiet], [{ "push.near": true }, false]);
  await settings(b, { switches: { "push.near": false } });
  assert.deepEqual((await stored(b)).switches, { "push.near": false });

  // Two first PUTs at once: both changes stick (the defaults row is made first, so the second waits on the first's lock).
  const c = await join();
  const both = await Promise.all([settings(c, { switches: { "push.near": true } }), settings(c, { quiet: false })]);
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
  assert.deepEqual([(await stored(c)).switches, (await stored(c)).quiet], [{ "push.near": true }, false]);

  for (const bad of [{ switches: { "email.tickets": false } }, { switches: { "push.nope": false } }, { push: "yes" }]) {
    assert.equal((await settings(a, bad)).status, 400, JSON.stringify(bad));
  }
});

test("inbox: pages of 30 newest first with a cursor, the app's unread count, read by ids and read all", async () => {
  goTo(12);
  const a = await join(), b = await join();
  await t.db.delete(inboxItems).where(eq(inboxItems.userId, a.me.id)); // the welcome has no inbox item, but be sure
  const base = t.now();
  const item = (i: number, app: "orbit" | "launch" = "orbit") => ({
    userId: a.me.id, app, kind: "orbitNews", type: "announcement", fromName: "Orbit", text: `n${i}`, dedupeKey: `${app}-${i}`,
    createdAt: new Date(base - Math.floor(i / 2) * MIN), // pairs share a time: the id breaks the tie
  });
  await t.db.insert(inboxItems).values([...Array.from({ length: 65 }, (_, i) => item(i)), item(0, "launch")]);
  const [theirs] = await t.db.insert(inboxItems).values({ ...item(99), userId: b.me.id }).returning();

  const seen: string[] = [];
  let cursor: string | null = null;
  const sizes: number[] = [];
  do {
    const r = await as(a)("GET", `/me/inbox?app=orbit${cursor ? `&before=${cursor}` : ""}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.unread, 65);
    sizes.push(r.body.items.length);
    seen.push(...r.body.items.map((i: { id: string }) => i.id));
    cursor = r.body.next;
  } while (cursor);
  assert.deepEqual(sizes, [30, 30, 5]);
  assert.equal(new Set(seen).size, 65);
  const all = await t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, a.me.id), eq(inboxItems.app, "orbit")));
  const order = all.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (y.id > x.id ? 1 : -1)).map((i) => i.id);
  assert.deepEqual(seen, order);
  assert.equal((await as(a)("GET", "/me/inbox?app=launch")).body.unread, 1);
  assert.equal((await as(a)("GET", "/me/inbox?before=garbage")).status, 400);
  const cur = (s: string) => Buffer.from(s).toString("base64url");
  for (const bad of [`2026-02-30T10:00:00.000000Z|${seen[0]}`, `2026-01-05 10:00|${seen[0]}`, `2026-01-05T10:00:00.000000Z|nope`]) {
    assert.equal((await as(a)("GET", `/me/inbox?before=${cur(bad)}`)).status, 400, bad);
  }

  assert.equal((await as(a)("POST", "/me/inbox/read", { app: "orbit", ids: [seen[0], seen[1], theirs!.id] })).status, 204);
  const page = (await as(a)("GET", "/me/inbox?app=orbit")).body;
  assert.equal(page.unread, 63);
  assert.deepEqual(page.items.slice(0, 3).map((i: { read: boolean }) => i.read), [true, true, false]);
  assert.equal((await t.db.select().from(inboxItems).where(eq(inboxItems.id, theirs!.id)))[0]!.readAt, null);
  assert.equal((await as(a)("POST", "/me/inbox/read", { app: "orbit" })).status, 204);
  assert.equal((await as(a)("GET", "/me/inbox?app=orbit")).body.unread, 0);
  assert.equal((await as(a)("GET", "/me/inbox?app=launch")).body.unread, 1);
});

test("inbox: each row's picture is read from what it opens, and only while that is public", async () => {
  goTo(12);
  const a = await join();
  const { hostId, eventId } = await hostAndEvent(a);
  await t.db.update(hosts).set({ status: "live", visibility: "public", logo: "https://x.test/logo.jpg" }).where(eq(hosts.id, hostId));
  await t.db.update(events).set({ poster: "https://x.test/poster.jpg" }).where(eq(events.id, eventId));
  await t.db.delete(inboxItems).where(eq(inboxItems.userId, a.me.id));
  const opens = [{ to: "ticket", event: eventId }, { to: "host", host: hostId }, { to: "slot", venue: hostId }, { to: "event", event: crypto.randomUUID() }, { to: "security" }, null];
  await t.db.insert(inboxItems).values(opens.map((o, i) => ({
    userId: a.me.id, app: "orbit" as const, kind: "orbitNews", type: "announcement", fromName: "Orbit", text: `p${i}`, opens: o, dedupeKey: `pic-${i}`,
    createdAt: new Date(t.now() - i * MIN),
  })));
  const pictures = async () => (await as(a)("GET", "/me/inbox?app=orbit")).body.items.map((i: { picture: unknown }) => i.picture);
  const host = { host: { id: hostId, name: (await t.db.select().from(hosts).where(eq(hosts.id, hostId)))[0]!.name, logo: "https://x.test/logo.jpg" } };
  assert.deepEqual(await pictures(), [{ event: { id: eventId, title: "Open Mic", poster: "https://x.test/poster.jpg" } }, host, host, null, null, null]);
  // No poster: the event's host.
  await t.db.update(events).set({ poster: null }).where(eq(events.id, eventId));
  assert.deepEqual((await pictures()).slice(0, 3), [host, host, host]);
  // A private host: its event still opens, but neither shows the host.
  await t.db.update(events).set({ poster: "https://x.test/poster.jpg" }).where(eq(events.id, eventId));
  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, hostId));
  assert.deepEqual((await pictures()).slice(0, 3), [{ event: { id: eventId, title: "Open Mic", poster: "https://x.test/poster.jpg" } }, null, null]);
  // A host that isn't live: nothing at all.
  await t.db.update(hosts).set({ visibility: "public", status: "paused" }).where(eq(hosts.id, hostId));
  assert.deepEqual((await pictures()).slice(0, 3), [null, null, null]);
});

const png = () => sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer();
const upload = async (a: A, path: string) => {
  const form = new FormData();
  form.set("image", new File([(await png()) as BlobPart], "p.png", { type: "image/png" }));
  const res = await t.app.request(path, { method: "PUT", headers: { authorization: `Bearer ${a.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  return res.status;
};

// A draft with everything publish needs.
const publishable = async (owner: A, hostId: string) => {
  const e = (await as(owner)("POST", `/hosts/${hostId}/events`, { title: "Open Mic Night" })).body as { id: string };
  assert.equal(await upload(owner, `/events/${e.id}/poster`), 200);
  const iso = (ms: number) => new Date(t.now() + ms).toISOString();
  const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
  assert.equal((await as(owner)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(DAY), endsAt: iso(DAY + HOUR), place })).status, 200);
  assert.equal((await as(owner)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 })).status, 201);
  return e;
};
// Publish tells followers in the background, after its response.
const settle = () => new Promise((r) => setTimeout(r, 300));
const told = (u: A) => t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, u.me.id), eq(inboxItems.kind, "followedHostEvent")));

test("publish tells followers on all, not those on off; a second publish tells nobody twice", async () => {
  goTo(12);
  const owner = await join(), on = await join(), off = await join(), stranger = await join();
  const h = (await as(owner)("POST", "/hosts", { name: "Punchline Collective", kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
  for (const u of [on, off]) assert.equal((await as(u)("POST", `/hosts/${h.id}/follow`)).status, 200);
  assert.equal((await as(off)("PUT", `/me/follows/${h.id}/notify`, { notify: "off" })).status, 204);
  assert.equal((await as(stranger)("PUT", `/me/follows/${h.id}/notify`, { notify: "off" })).status, 404);
  assert.equal((await as(off)("PUT", `/me/follows/${h.id}/notify`, { notify: "sometimes" })).status, 400);
  assert.equal((await t.db.select().from(follows).where(eq(follows.userId, off.me.id)))[0]!.notify, "off");

  const e = await publishable(owner, h.id);
  assert.equal((await as(owner)("POST", `/events/${e.id}/publish`)).status, 200);
  await settle();

  const [item] = await told(on);
  assert.deepEqual([item?.fromName, item?.text], ["Punchline Collective", "Open Mic Night"]);
  assert.equal((await told(off)).length, 0);
  assert.equal((await told(stranger)).length, 0);
  const [d] = await sent(on, "followedHostEvent", "push");
  assert.deepEqual([d!.payload.hostId, d!.payload.eventId], [h.id, e.id]);

  assert.equal((await as(owner)("POST", `/events/${e.id}/publish`)).status, 409);
  await t.notify({ to: { userId: on.me.id }, kind: "followedHostEvent", key: e.id, data: { hostId: h.id, eventId: e.id, title: "Open Mic Night" } });
  assert.equal((await told(on)).length, 1);
  assert.equal((await sent(on, "followedHostEvent", "push")).length, 1);
});

test("publish tells nobody for a link-only event, a private host or a paused host", async () => {
  goTo(12);
  const owner = await join(), fan = await join();
  const hostFollowed = async () => {
    const h = (await as(owner)("POST", "/hosts", { name: `Club ${++n}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
    assert.equal((await as(fan)("POST", `/hosts/${h.id}/follow`)).status, 200);
    return h.id;
  };
  const link = await hostFollowed(), priv = await hostFollowed(), paused = await hostFollowed();
  const e1 = await publishable(owner, link);
  await t.db.update(events).set({ visibility: "link" }).where(eq(events.id, e1.id));
  const e2 = await publishable(owner, priv);
  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, priv));
  const e3 = await publishable(owner, paused);
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, paused));
  for (const e of [e1, e2, e3]) assert.equal((await as(owner)("POST", `/events/${e.id}/publish`)).status, 200);
  await settle();
  assert.equal((await told(fan)).length, 0);
  assert.equal((await sent(fan, "followedHostEvent", "push")).length, 0);
});

test("push devices unseen for 270 days are pruned", async () => {
  goTo(12);
  const a = await join(), b = await join();
  await addDevice(a, "old");
  await addDevice(b, "recent");
  await t.db.update(pushDevices).set({ seenAt: new Date(t.now() - 271 * DAY) }).where(eq(pushDevices.token, "old"));
  await t.db.update(pushDevices).set({ seenAt: new Date(t.now() - 269 * DAY) }).where(eq(pushDevices.token, "recent"));
  await pruneNotifications(t.db, t.now());
  assert.deepEqual((await t.db.select().from(pushDevices)).map((d) => d.token).filter((x) => x === "old" || x === "recent"), ["recent"]);
});
