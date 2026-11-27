import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import postgres from "postgres";
import { HostEvents, TeamEvent } from "@orbit/contract";
import { testApp } from "../testkit.ts";
import { events, eventSlugs, hosts, teamRoles } from "../db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
// A second connection that holds the host's row lock, so a change can land while requests wait on it.
let lock: ReturnType<typeof postgres>;
before(async () => {
  t = await testApp();
  lock = postgres(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/orbit_test", { max: 1, onnotice: () => {} });
});
after(async () => {
  await lock.end();
  await t.close();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Holds the host's row FOR UPDATE, starts the requests, lets them queue, makes `change` in the same transaction, then
// commits: the requests read the host only after the change.
const during = async <T>(hostId: string, requests: (() => Promise<T>)[], change: (sql: any) => Promise<unknown>) => {
  let started: Promise<T>[] = [];
  await lock.begin(async (sql: any) => {
    await sql`select 1 from hosts where id = ${hostId} for update`;
    started = requests.map((r) => r());
    await sleep(400);
    await change(sql);
    await sleep(200);
  });
  return Promise.all(started);
};

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(4_000_000 + ++n * 11).padStart(9, "0")}`;
const e164 = (p: string) => `+91${p}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

const join = async (p = phone()) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(e164(p)), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const start = async (u: P, name = "Punchline Collective") => (await as(u)("POST", "/hosts", { name, kind: "comedy-group", city: "Hyderabad" })).body as { id: string; slug: string };
const addAdmin = async (owner: P, hostId: string, who: P) => {
  const inv = await as(owner)("POST", `/hosts/${hostId}/team`, { to: who.p });
  assert.equal((await as(who)("POST", `/invites/${inv.body.id}/accept`)).status, 200);
  assert.equal((await as(owner)("POST", `/hosts/${hostId}/team/${inv.body.id}/confirm`)).status, 200);
  return inv.body.id as string;
};
const draft = async (u: P, hostId: string, title = "Open Mic Night") => {
  const r = await as(u)("POST", `/hosts/${hostId}/events`, { title });
  assert.equal(r.status, 201);
  return TeamEvent.parse(r.body);
};
// A published event always has a place (publishing needed one), so a seeded one gets it unless the seed sets its own.
const seed = (id: string, set: Partial<typeof events.$inferInsert>) =>
  t.db.update(events).set({ ...(set.status === "published" ? { ...place, placeId: null } : {}), ...set }).where(eq(events.id, id));
const row = async (id: string) => (await t.db.select().from(events).where(eq(events.id, id)))[0]!;
const slugsOf = async (id: string) => (await t.db.select().from(eventSlugs).where(eq(eventSlugs.eventId, id))).map((s) => s.slug);
const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
const ago = (ms: number) => new Date(t.now() - ms);
const ahead = (ms: number) => new Date(t.now() + ms);

test("an Admin creates a draft from its name", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  const e = await draft(a, h.id, "Open Mic Night!");
  assert.match(e.slug, /^open-mic-night-[0-9a-f]{6}$/);
  assert.equal(e.status, "draft");
  assert.equal(e.visibility, "public");
  assert.equal(e.hostId, h.id);
  assert.equal(e.title, "Open Mic Night!");
  assert.deepEqual(await slugsOf(e.id), [e.slug]);
  assert.equal((await row(e.id)).createdBy, a.me.id);

  assert.equal((await as(out)("POST", `/hosts/${h.id}/events`, { title: "Nope" })).status, 404);
  assert.equal((await as(a)("POST", "/hosts/not-a-uuid/events", { title: "Nope" })).status, 404);
  assert.equal((await as(a)("POST", `/hosts/${h.id}/events`, { title: "   " })).status, 400);
});

test("a private host's draft is link-only; a paused host may still create, a suspended one may not", async () => {
  const a = await join();
  const h = await start(a);
  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, h.id));
  assert.equal((await draft(a, h.id)).visibility, "link");
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, h.id));
  await draft(a, h.id);
  await t.db.update(hosts).set({ status: "suspended" }).where(eq(hosts.id, h.id));
  const r = await as(a)("POST", `/hosts/${h.id}/events`, { title: "Nope" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "hostClosed");
});

test("an Admin edits a draft: several fields, a place, dates and a cleared date", async () => {
  const a = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  const start1 = "2026-12-20T13:00:00.000Z", end1 = "2026-12-20T16:00:00.000Z";
  const r = await as(a)("PATCH", `/events/${e.id}`, {
    title: "Big Night", category: "comedy", startsAt: start1, endsAt: end1, place, online: true, onlineLink: "https://meet.example.com/x",
    about: "Laughs", agenda: [{ at: start1, item: "Doors" }], faq: [{ q: "Parking?", a: "Yes" }], terms: ["No refunds"],
  });
  assert.equal(r.status, 200);
  const p = TeamEvent.parse(r.body);
  assert.equal(p.title, "Big Night");
  assert.equal(p.startsAt, start1);
  assert.equal(p.place?.venue, "Hall");
  assert.equal(p.place?.placeId, null);
  assert.equal(p.online, true);
  assert.equal(p.agenda.length, 1);
  assert.deepEqual(p.terms, ["No refunds"]);
  assert.equal(p.slug, e.slug); // not asked
  assert.ok(Date.parse(p.updatedAt) >= Date.parse(e.updatedAt));

  // Only what was sent changes.
  assert.equal(TeamEvent.parse((await as(a)("PATCH", `/events/${e.id}`, { about: null })).body).title, "Big Night");

  // A place cleared clears all seven columns.
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { place: null })).status, 200);
  const cleared = await row(e.id);
  for (const k of ["venue", "address", "area", "city", "lat", "lng", "placeId"] as const) assert.equal(cleared[k], null, k);

  const nulled = await as(a)("PATCH", `/events/${e.id}`, { startsAt: null });
  assert.equal(nulled.body.startsAt, null);
  assert.equal(nulled.body.endsAt, end1);
});

test("start and end are checked against what's stored; empty and bad bodies are refused", async () => {
  const a = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  await as(a)("PATCH", `/events/${e.id}`, { startsAt: "2026-12-20T13:00:00.000Z" });
  const r = await as(a)("PATCH", `/events/${e.id}`, { endsAt: "2026-12-20T12:00:00.000Z" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "endsBeforeStart");
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, {})).status, 400);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { title: "" })).status, 400);
});

test("a new link keeps the old; the old comes back; another event's doesn't", async () => {
  const a = await join();
  const h = await start(a);
  const e1 = await draft(a, h.id, "First");
  const e2 = await draft(a, h.id, "Second");
  const r = await as(a)("PATCH", `/events/${e1.id}`, { slug: "first-night" });
  assert.equal(r.status, 200);
  assert.equal(r.body.slug, "first-night");
  assert.deepEqual((await slugsOf(e1.id)).sort(), [e1.slug, "first-night"].sort());
  assert.equal((await as(a)("PATCH", `/events/${e1.id}`, { slug: e1.slug })).body.slug, e1.slug);

  const clash = await as(a)("PATCH", `/events/${e2.id}`, { slug: "first-night" });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, "linkTaken");
  const old = await as(a)("PATCH", `/events/${e2.id}`, { slug: e1.slug });
  assert.equal(old.status, 409);
  assert.equal(old.body.error, "linkTaken");
  assert.equal((await row(e2.id)).slug, e2.slug);
});

test("a cancelled event can't be edited; an ended one keeps its date and place locked", async () => {
  const a = await join();
  const h = await start(a);
  const gone = await draft(a, h.id, "Cancelled");
  await seed(gone.id, { status: "cancelled", cancelledAt: ago(HOUR), cancelledBy: a.me.id, cancelReason: "Rain", publishedAt: ago(DAY), startsAt: ahead(DAY), endsAt: ahead(DAY + HOUR) });
  const c = await as(a)("PATCH", `/events/${gone.id}`, { title: "Back" });
  assert.equal(c.status, 409);
  assert.equal(c.body.error, "cancelled");

  const done = await draft(a, h.id, "Ended");
  await seed(done.id, { status: "published", publishedAt: ago(3 * DAY), startsAt: ago(2 * DAY), endsAt: ago(DAY) });
  const locked = await as(a)("PATCH", `/events/${done.id}`, { startsAt: ahead(DAY).toISOString() });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, "ended");
  assert.equal((await as(a)("PATCH", `/events/${done.id}`, { place: { ...place, venue: "Other" } })).status, 409);
  const ok = await as(a)("PATCH", `/events/${done.id}`, { title: "Ended, renamed" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.title, "Ended, renamed");
});

test("a private host's event can't be made public", async () => {
  const a = await join();
  const h = await start(a);
  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, h.id));
  const e = await draft(a, h.id);
  const r = await as(a)("PATCH", `/events/${e.id}`, { visibility: "public" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "linkOnly");
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { visibility: "link" })).status, 200);
});

test("an Admin whose seat has ended, and anyone outside the team, finds nothing", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  assert.equal((await as(out)("PATCH", `/events/${e.id}`, { title: "Mine" })).status, 404);
  assert.equal((await as(out)("GET", `/events/${e.id}`)).status, 404);
  assert.equal((await as(a)("PATCH", "/events/not-a-uuid", { title: "Mine" })).status, 404);
  await t.db.update(teamRoles).set({ endedAt: ago(1000) }).where(and(eq(teamRoles.hostId, h.id), eq(teamRoles.userId, a.me.id), isNull(teamRoles.endedAt)));
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { title: "Mine" })).status, 404);
  assert.equal((await as(a)("GET", `/events/${e.id}`)).status, 404);
  assert.equal((await row(e.id)).title, "Open Mic Night");
});

test("a suspended host's events can be read but not edited", async () => {
  const a = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  await t.db.update(hosts).set({ status: "suspended" }).where(eq(hosts.id, h.id));
  const r = await as(a)("PATCH", `/events/${e.id}`, { title: "Nope" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "hostClosed");
  assert.equal((await as(a)("GET", `/events/${e.id}`)).status, 200);
});

test("GET /events/:id: an Admin reads it", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  const r = await as(a)("GET", `/events/${e.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(TeamEvent.parse(r.body), e);
  assert.equal((await as(out)("GET", `/events/${e.id}`)).status, 404);
  assert.equal((await as(a)("GET", "/events/nope")).status, 404);
});

test("a host's events split into drafts, upcoming and past, each in its order", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  const mk = async (title: string, set: Partial<typeof events.$inferInsert>) => {
    const e = await draft(a, h.id, title);
    await seed(e.id, set);
    return e.id;
  };
  const d1 = await mk("Draft old", { updatedAt: ago(3 * DAY) });
  const d2 = await mk("Draft new", { updatedAt: ago(HOUR) });
  const pub = { status: "published" as const, publishedAt: ago(10 * DAY) };
  const u2 = await mk("Later", { ...pub, startsAt: ahead(5 * DAY), endsAt: ahead(5 * DAY + HOUR) });
  const u1 = await mk("Sooner", { ...pub, startsAt: ahead(DAY), endsAt: ahead(DAY + HOUR) });
  const u3 = await mk("Open ended", { ...pub, startsAt: null, endsAt: null });
  const p1 = await mk("Older", { ...pub, startsAt: ago(5 * DAY), endsAt: ago(5 * DAY - HOUR) });
  const p2 = await mk("Newer", { ...pub, startsAt: ago(2 * DAY), endsAt: ago(2 * DAY - HOUR) });
  const x = await mk("Cancelled gone", { status: "cancelled", cancelledAt: ago(DAY), startsAt: ago(3 * DAY), endsAt: ago(3 * DAY - HOUR) });
  // Another host's events never show.
  const other = await start(a, "Other Host");
  await draft(a, other.id, "Elsewhere");

  const r = await as(a)("GET", `/hosts/${h.id}/events`);
  assert.equal(r.status, 200);
  const list = HostEvents.parse(r.body);
  assert.deepEqual(list.drafts.map((e) => e.id), [d2, d1]);
  assert.deepEqual(list.upcoming.map((e) => e.id), [u1, u2, u3]);
  assert.deepEqual(list.past.map((e) => e.id), [p2, x, p1]);

  assert.equal((await as(out)("GET", `/hosts/${h.id}/events`)).status, 404);
  assert.equal((await as(a)("GET", "/hosts/nope/events")).status, 404);
});

test("a running event is upcoming; past shows the newest 50", async () => {
  const a = await join();
  const h = await start(a);
  const running = await draft(a, h.id, "Running");
  await seed(running.id, { status: "published", publishedAt: ago(DAY), startsAt: ago(HOUR), endsAt: ahead(HOUR) });
  const first = await draft(a, h.id, "Seed");
  await t.db.delete(eventSlugs).where(eq(eventSlugs.eventId, first.id));
  await t.db.delete(events).where(eq(events.id, first.id));
  // 51 past events, one an hour older than the last.
  await t.db.insert(events).values(
    Array.from({ length: 51 }, (_, i) => ({
      hostId: h.id, slug: `past-${i}-aaaaaa`, title: `Past ${i}`, status: "published" as const, publishedAt: ago(100 * DAY), createdBy: a.me.id,
      startsAt: ago((i + 2) * DAY), endsAt: ago((i + 2) * DAY - HOUR),
    })),
  );
  const list = HostEvents.parse((await as(a)("GET", `/hosts/${h.id}/events`)).body);
  assert.deepEqual(list.upcoming.map((e) => e.id), [running.id]);
  assert.equal(list.past.length, 50);
  assert.equal(list.past[0]!.title, "Past 0");
  assert.equal(list.past[49]!.title, "Past 49");
});

test("a second Admin creates, edits and reads; an unconfirmed seat, and another host's Admin, find nothing", async () => {
  const owner = await join(), second = await join(), waiting = await join(), elsewhere = await join();
  const h = await start(owner);
  await addAdmin(owner, h.id, second);
  const inv = await as(owner)("POST", `/hosts/${h.id}/team`, { to: waiting.p });
  assert.equal((await as(waiting)("POST", `/invites/${inv.body.id}/accept`)).status, 200); // accepted, never confirmed
  const other = await start(elsewhere, "Another Host");
  await draft(elsewhere, other.id);

  const e = await draft(second, h.id, "By the second");
  assert.equal((await as(second)("PATCH", `/events/${e.id}`, { about: "Hello" })).status, 200);
  assert.equal((await as(second)("GET", `/events/${e.id}`)).status, 200);
  assert.equal(HostEvents.parse((await as(second)("GET", `/hosts/${h.id}/events`)).body).drafts.length, 1);

  for (const u of [waiting, elsewhere]) {
    assert.equal((await as(u)("POST", `/hosts/${h.id}/events`, { title: "No" })).status, 404);
    assert.equal((await as(u)("GET", `/hosts/${h.id}/events`)).status, 404);
    assert.equal((await as(u)("GET", `/events/${e.id}`)).status, 404);
    assert.equal((await as(u)("PATCH", `/events/${e.id}`, { title: "No" })).status, 404);
  }
});

test("an archived host's owner is told it's closed; its other Admins find nothing", async () => {
  const owner = await join(), second = await join();
  const h = await start(owner);
  await addAdmin(owner, h.id, second);
  const e = await draft(owner, h.id);
  assert.equal((await as(owner)("POST", `/hosts/${h.id}/archive`)).status, 200);
  for (const r of [await as(owner)("POST", `/hosts/${h.id}/events`, { title: "No" }), await as(owner)("PATCH", `/events/${e.id}`, { title: "No" })]) {
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "hostClosed");
  }
  assert.equal((await as(second)("POST", `/hosts/${h.id}/events`, { title: "No" })).status, 404);
  assert.equal((await as(second)("GET", `/events/${e.id}`)).status, 404);
  assert.equal((await as(second)("GET", `/hosts/${h.id}/events`)).status, 404);
});

test("a seat removed while requests wait on the host lock finds nothing", async () => {
  const owner = await join(), second = await join();
  const h = await start(owner);
  await addAdmin(owner, h.id, second);
  const e = await draft(second, h.id);
  const [post, patch] = await during(
    h.id,
    [() => as(second)("POST", `/hosts/${h.id}/events`, { title: "Late" }), () => as(second)("PATCH", `/events/${e.id}`, { title: "Late" })],
    (sql) => sql`update team_roles set ended_at = now() where host_id = ${h.id} and user_id = ${second.me.id} and ended_at is null`,
  );
  assert.equal(post!.status, 404);
  assert.equal(patch!.status, 404);
  assert.equal((await row(e.id)).title, "Open Mic Night");
});

test("a host suspended while requests wait on the host lock is closed", async () => {
  const a = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  const [post, patch] = await during(
    h.id,
    [() => as(a)("POST", `/hosts/${h.id}/events`, { title: "Late" }), () => as(a)("PATCH", `/events/${e.id}`, { title: "Late" })],
    (sql) => sql`update hosts set status = 'suspended' where id = ${h.id}`,
  );
  for (const r of [post!, patch!]) {
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "hostClosed");
  }
  assert.equal((await row(e.id)).title, "Open Mic Night");
});

test("a host holds at most 50 drafts", async () => {
  const a = await join();
  const h = await start(a);
  await t.db.insert(events).values(
    Array.from({ length: 50 }, (_, i) => ({ hostId: h.id, slug: `many-${i}-bbbbbb`, title: `Draft ${i}`, createdBy: a.me.id })),
  );
  const r = await as(a)("POST", `/hosts/${h.id}/events`, { title: "One too many" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "tooManyDrafts");
  // A published event isn't a draft: freeing one makes room.
  const [one] = await t.db.select().from(events).where(eq(events.hostId, h.id)).limit(1);
  await seed(one!.id, { status: "published" });
  assert.equal((await as(a)("POST", `/hosts/${h.id}/events`, { title: "Room again" })).status, 201);
});

test("an event keeps at most 10 links; one it had comes back", async () => {
  const a = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  for (let i = 1; i <= 9; i++) assert.equal((await as(a)("PATCH", `/events/${e.id}`, { slug: `link-number-${i}` })).status, 200, `link ${i}`);
  assert.equal((await slugsOf(e.id)).length, 10);
  const r = await as(a)("PATCH", `/events/${e.id}`, { slug: "link-number-10" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "tooManyLinks");
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { slug: e.slug })).body.slug, e.slug);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { slug: "link-number-3" })).status, 200);
});

test("a host that goes private shows its events as link-only; the event keeps its own choice", async () => {
  const a = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  assert.equal(e.visibility, "public");
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { visibility: "private" })).status, 200);
  assert.equal((await as(a)("GET", `/events/${e.id}`)).body.visibility, "link");
  assert.equal(HostEvents.parse((await as(a)("GET", `/hosts/${h.id}/events`)).body).drafts[0]!.visibility, "link");
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { title: "Renamed" })).body.visibility, "link");
  assert.equal((await row(e.id)).visibility, "public");
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { visibility: "public" })).status, 200);
  assert.equal((await as(a)("GET", `/events/${e.id}`)).body.visibility, "public");
});

test("a published event can't have its end moved into the past, and a whole form sent back after it ended is fine", async () => {
  const a = await join();
  const h = await start(a);
  const live = await draft(a, h.id, "Live");
  await seed(live.id, { status: "published", publishedAt: ago(DAY), startsAt: ago(HOUR), endsAt: ahead(HOUR) });
  const early = await as(a)("PATCH", `/events/${live.id}`, { endsAt: ago(1000).toISOString() });
  assert.equal(early.status, 400);
  assert.equal(early.body.error, "endInPast");
  assert.equal((await as(a)("PATCH", `/events/${live.id}`, { endsAt: ahead(2 * HOUR).toISOString() })).status, 200);

  const done = await draft(a, h.id, "Done");
  const startsAt = ago(2 * DAY), endsAt = ago(DAY);
  await seed(done.id, { status: "published", publishedAt: ago(3 * DAY), startsAt, endsAt, timezone: "Asia/Kolkata", online: false });
  const form = await as(a)("PATCH", `/events/${done.id}`, { title: "Renamed", startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), timezone: "Asia/Kolkata", place, online: false, onlineLink: null });
  assert.equal(form.status, 200);
  assert.equal(form.body.title, "Renamed");
});

test("an agenda's times are stored in one form", async () => {
  const a = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  const r = await as(a)("PATCH", `/events/${e.id}`, { agenda: [{ at: "2026-12-20T18:30:00+05:30", item: "Doors" }] });
  assert.equal(r.body.agenda[0].at, "2026-12-20T13:00:00.000Z");
});

test("a team event carries exactly its documented keys", async () => {
  const a = await join();
  const h = await start(a);
  const keys = [
    "id", "hostId", "slug", "status", "visibility", "title", "category", "startsAt", "endsAt", "timezone", "place", "online", "onlineLink",
    "about", "agenda", "faq", "terms", "vibes", "details", "inRoom", "minAge", "poster", "wide", "wideEdge", "tone", "publishedAt", "cancelledAt", "cancelReason", "saved", "createdAt", "updatedAt",
  ].sort();
  const made = await as(a)("POST", `/hosts/${h.id}/events`, { title: "Keys" });
  assert.deepEqual(Object.keys(made.body).sort(), keys);
  assert.deepEqual(Object.keys((await as(a)("GET", `/events/${made.body.id}`)).body).sort(), keys);
  assert.deepEqual(Object.keys((await as(a)("PATCH", `/events/${made.body.id}`, { title: "Keys 2" })).body).sort(), keys);
  const rowKeys = ["id", "slug", "status", "visibility", "title", "category", "startsAt", "endsAt", "timezone", "area", "city", "online", "sold", "checkedIn"].sort();
  assert.deepEqual(Object.keys((await as(a)("GET", `/hosts/${h.id}/events`)).body.drafts[0]).sort(), rowKeys);
});

test("kind details, inRoom and age round-trip; once it has started, the host can't flip the room", async () => {
  const a = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  const details = { teamMin: 2, teamMax: 4, tracks: [{ name: "AI", brief: "Build with models" }], criteria: [{ name: "Idea", weight: 100 }] };
  const r = await as(a)("PATCH", `/events/${e.id}`, { category: "hackathons", details: { ...details, language: "Hindi" }, inRoom: true, minAge: 18 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.details, r.body.inRoom, r.body.minAge], [details, false, 18]); // the category's keys; a room only on a meetup
  const got = TeamEvent.parse((await as(a)("GET", `/events/${e.id}`)).body);
  assert.deepEqual([got.details, got.inRoom, got.minAge], [details, false, 18]);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { minAge: 16 })).status, 400);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { details: { teamMin: 5, teamMax: 4 } })).status, 400);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { minAge: null })).body.minAge, null);
  // With no category yet, details stay as they are.
  assert.deepEqual((await as(a)("PATCH", `/events/${e.id}`, { category: null, details: { language: "Hindi" } })).body.details, details);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { category: "meetups", inRoom: true })).body.inRoom, true);

  await seed(e.id, { status: "published", startsAt: ago(HOUR), endsAt: ahead(HOUR) });
  const no = await as(a)("PATCH", `/events/${e.id}`, { inRoom: false });
  assert.equal(no.status, 409);
  assert.equal(no.body.error, "started");
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { category: "comedy" })).body.error, "started"); // leaving meetups ends the room
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { inRoom: true, title: "Same switch" })).status, 200); // unchanged is fine
  // A stored switch on another category doesn't open a room by moving to meetups either.
  await seed(e.id, { category: "comedy", inRoom: true });
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { category: "meetups" })).body.error, "started");
  await seed(e.id, { category: "meetups", startsAt: ahead(HOUR), endsAt: ahead(2 * HOUR) });
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { inRoom: false })).body.inRoom, false);
});
