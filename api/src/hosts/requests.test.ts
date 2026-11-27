import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { HostEvents, inboxApp } from "@orbit/contract";
import { emailFor } from "../notification-emails.ts";
import { testApp } from "../testkit.ts";
import { runDeletions } from "../auth/deletion.ts";
import { auditLog, bookings, deliveries, eventRequests, events, hosts, inboxItems, staffGrants, teamRoles, ticketTypes, users } from "../db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => {
  t = await testApp();
});
after(async () => {
  await t.close();
});

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(5_000_000 + ++n * 11).padStart(9, "0")}`;
const DAY = 24 * 3600_000;

const join = async () => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const staff = async () => {
  const s = await join();
  await t.db.insert(staffGrants).values({ userId: s.me.id, feature: "hosts", addedBy: s.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return s;
};

const host = { name: "Punchline Collective", kind: "comedy-group", city: "Hyderabad", about: "Stand-up on Fridays" };
const event = { title: "Open Mic Night", category: "comedy", startsAt: new Date(Date.now() + 60 * 24 * 3600_000).toISOString(), venue: "The Moonshine Project", paid: false, expectedSize: 80 };
const R = { reason: "Checked the page" };

test("send, one waiting at a time, edit only after changes, withdraw", async () => {
  const a = await join(), st = await staff();
  assert.equal((await as(a)("GET", "/me/event-request")).body, null);
  // An event is needed, except for a Venue or a Performer.
  assert.equal((await as(a)("POST", "/event-requests", { host })).status, 400);
  assert.equal((await as(a)("POST", "/event-requests", { host: { ...host, city: "Gotham" }, event })).status, 400);
  assert.equal((await as(a)("POST", "/event-requests", { host, event: { ...event, category: "nope" } })).status, 400);

  const sent = await as(a)("POST", "/event-requests", { host, event });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.status, "open");
  assert.equal((await as(a)("POST", "/event-requests", { host: { ...host, kind: "venue" } })).status, 409);
  assert.equal((await as(a)("GET", "/me/event-request")).body.id, sent.body.id);
  // Not editable while open.
  assert.equal((await as(a)("PATCH", "/me/event-request", { host, event })).status, 409);

  const asked = await as(st)("POST", `/galaxy/event-requests/${sent.body.id}/changes`, { reason: "Add the venue's area" });
  assert.equal(asked.status, 200);
  const mine = (await as(a)("GET", "/me/event-request")).body;
  assert.equal(mine.status, "changes");
  assert.equal(mine.note, "Add the venue's area");
  assert.ok(t.notices.some((x) => x.kind === "eventRequestAnswered" && "userId" in x.to && x.to.userId === a.me.id && x.data?.decision === "changes"));
  // Approve needs it open again.
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${sent.body.id}/approve`, R)).status, 409);

  const edited = await as(a)("PATCH", "/me/event-request", { host, event: { ...event, venue: "Moonshine, Jubilee Hills" } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.status, "open");
  assert.equal(edited.body.note, null);
  assert.equal(edited.body.event.venue, "Moonshine, Jubilee Hills");

  assert.equal((await as(a)("DELETE", "/me/event-request")).body.status, "withdrawn");
  assert.equal((await as(a)("DELETE", "/me/event-request")).status, 404);
  // Withdrawn frees the slot: a Performer may come without an event.
  const again = await as(a)("POST", "/event-requests", { host: { ...host, kind: "performer" } });
  assert.equal(again.status, 201);
  assert.equal(again.body.event, null);
});

test("Galaxy's request routes are for holders of Hosts only, never on their own request but the owner's", async () => {
  const a = await join(), nobody = await join(), st = await staff();
  const r = (await as(a)("POST", "/event-requests", { host, event })).body;
  for (const [m, path, body] of [
    ["GET", "/galaxy/event-requests"],
    ["GET", `/galaxy/event-requests/${r.id}`],
    ["POST", `/galaxy/event-requests/${r.id}/approve`, R],
    ["POST", `/galaxy/event-requests/${r.id}/changes`, R],
    ["POST", `/galaxy/event-requests/${r.id}/decline`, R],
  ] as [string, string, unknown?][]) {
    assert.equal((await as(nobody)(m, path, body)).status, 404, path);
    assert.equal((await t.call(m, path, body)).status, 401, path);
  }
  const list = await as(st)("GET", "/galaxy/event-requests?status=open");
  assert.equal(list.status, 200);
  assert.ok(list.body.requests.some((x: any) => x.id === r.id && x.user.id === a.me.id && x.user.phone.includes("••")));
  assert.equal((await as(st)("GET", "/galaxy/event-requests?status=bogus")).status, 400);
  assert.equal((await as(st)("GET", `/galaxy/event-requests/${r.id}`)).body.host.name, host.name);

  const own = (await as(st)("POST", "/event-requests", { host, event })).body;
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${own.id}/approve`, R)).status, 403);

  // The platform owner may answer their own.
  const boss = await join();
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.platformOwner, true));
  await t.db.update(users).set({ platformOwner: true }).where(eq(users.id, boss.me.id));
  const mine = (await as(boss)("POST", "/event-requests", { host, event })).body;
  assert.equal((await as(boss)("POST", `/galaxy/event-requests/${mine.id}/decline`, R)).status, 200);
  const mine2 = (await as(boss)("POST", "/event-requests", { host, event })).body;
  const approved = await as(boss)("POST", `/galaxy/event-requests/${mine2.id}/approve`, R);
  assert.deepEqual([approved.status, approved.body.status], [200, "approved"]);
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.id, boss.me.id));
});

test("approve makes the host, the owner's Admin seat and the draft, once", async () => {
  const a = await join(), st = await staff();
  const r = (await as(a)("POST", "/event-requests", { host, event })).body;
  // Approval isn't held to POST /hosts's 5 a day.
  for (let i = 0; i < 5; i++) assert.equal((await as(a)("POST", "/hosts", { name: `H${i}`, kind: "other", city: "Hyderabad" })).status, 201);

  const ok = await as(st)("POST", `/galaxy/event-requests/${r.id}/approve`, R);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "approved");
  assert.equal(ok.body.decidedBy, st.me.id);
  const [h] = await t.db.select().from(hosts).where(eq(hosts.id, ok.body.hostId));
  assert.equal(h!.ownerId, a.me.id);
  assert.equal(h!.status, "live");
  assert.equal(h!.verifiedAt, null);
  assert.equal(h!.about, host.about);
  const [seat] = await t.db.select().from(teamRoles).where(eq(teamRoles.hostId, h!.id));
  assert.equal(seat!.userId, a.me.id);
  assert.equal(seat!.role, "admin");
  assert.ok(seat!.startedAt);
  const [e] = await t.db.select().from(events).where(eq(events.id, ok.body.eventId));
  assert.equal(e!.status, "draft");
  assert.equal(e!.title, event.title);
  assert.equal(e!.category, "comedy");
  assert.equal(e!.startsAt!.toISOString(), new Date(event.startsAt).toISOString());
  // The requester reads it as an Admin.
  assert.equal(HostEvents.parse((await as(a)("GET", `/hosts/${h!.id}/events`)).body).drafts[0]!.id, e!.id);
  assert.ok(t.notices.some((x) => x.kind === "eventRequestAnswered" && x.data?.decision === "approved"));
  assert.ok((await t.db.select().from(auditLog)).some((x) => x.action === "requests.approve" && x.targetHost === h!.id));

  // Twice is refused, and so is any other answer now.
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${r.id}/approve`, R)).status, 409);
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${r.id}/decline`, R)).status, 409);
  assert.equal((await t.db.select().from(hosts).where(eq(hosts.ownerId, a.me.id))).length, 6);

  // A Venue without an event: a host, no draft.
  const b = await join();
  const v = (await as(b)("POST", "/event-requests", { host: { ...host, kind: "venue", about: null } })).body;
  const vok = await as(st)("POST", `/galaxy/event-requests/${v.id}/approve`, R);
  assert.equal(vok.status, 200);
  assert.ok(vok.body.hostId);
  assert.equal(vok.body.eventId, null);
});

test("decline keeps the note for the requester and frees them to send again", async () => {
  const a = await join(), st = await staff();
  const r = (await as(a)("POST", "/event-requests", { host, event })).body;
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${r.id}/decline`, { reason: "x" })).status, 400); // a reason of 3+
  const no = await as(st)("POST", `/galaxy/event-requests/${r.id}/decline`, { reason: "Not an event we can list" });
  assert.equal(no.body.status, "declined");
  const mine = (await as(a)("GET", "/me/event-request")).body;
  assert.equal(mine.note, "Not an event we can list");
  const told = t.notices.filter((x) => x.kind === "eventRequestAnswered" && x.data?.requestId === r.id);
  assert.deepEqual(told.map((x) => [x.data?.decision, x.data?.reason]), [["declined", "Not an event we can list"]]);
  assert.equal((await as(a)("DELETE", "/me/event-request")).status, 404);
  assert.equal((await as(a)("POST", "/event-requests", { host, event })).status, 201);
});

test("host events carry tickets sold and checked in", async () => {
  const a = await join(), b = await join(), c = await join();
  const h = (await as(a)("POST", "/hosts", { name: "Counts", kind: "other", city: "Hyderabad" })).body;
  const e = (await as(a)("POST", `/hosts/${h.id}/events`, { title: "Counted" })).body;
  const other = (await as(a)("POST", `/hosts/${h.id}/events`, { title: "Empty" })).body;
  const [tier] = await t.db.insert(ticketTypes).values({ eventId: e.id, name: "General" }).returning();
  const book = (userId: string, quantity: number, status: "confirmed" | "cancelled" | "cancelledByHost") =>
    t.db.insert(bookings).values({ userId, eventId: e.id, ticketTypeId: tier!.id, quantity, status, qr: crypto.randomUUID(), code: crypto.randomUUID() });
  await book(b.me.id, 3, "confirmed");
  await book(c.me.id, 2, "confirmed");
  await book(a.me.id, 4, "cancelled");
  await book(a.me.id, 6, "cancelledByHost");
  // Another host's bookings never count here.
  const h2 = (await as(b)("POST", "/hosts", { name: "Elsewhere", kind: "other", city: "Hyderabad" })).body;
  const e2 = (await as(b)("POST", `/hosts/${h2.id}/events`, { title: "Theirs" })).body;
  const [tier2] = await t.db.insert(ticketTypes).values({ eventId: e2.id, name: "General" }).returning();
  await t.db.insert(bookings).values({ userId: c.me.id, eventId: e2.id, ticketTypeId: tier2!.id, quantity: 7, status: "confirmed", qr: crypto.randomUUID(), code: crypto.randomUUID() });
  const list = HostEvents.parse((await as(a)("GET", `/hosts/${h.id}/events`)).body);
  const by = new Map(list.drafts.map((r) => [r.id, r]));
  assert.equal(by.get(e.id)!.sold, 5);
  assert.equal(by.get(e.id)!.checkedIn, 0);
  assert.equal(by.get(other.id)!.sold, 0);
});

test("a past start is refused on send and on edit", async () => {
  const a = await join(), st = await staff();
  const past = { ...event, startsAt: new Date(t.now() - 1000).toISOString() };
  assert.equal((await as(a)("POST", "/event-requests", { host, event: past })).body.error, "past");
  const r = (await as(a)("POST", "/event-requests", { host, event })).body;
  await as(st)("POST", `/galaxy/event-requests/${r.id}/changes`, R);
  assert.equal((await as(a)("PATCH", "/me/event-request", { host, event: past })).status, 400);
  // Back to open clears who decided.
  const back = await as(a)("PATCH", "/me/event-request", { host, event });
  assert.equal(back.body.decidedAt, null);
  const [row] = await t.db.select().from(eventRequests).where(eq(eventRequests.id, r.id));
  assert.equal(row!.decidedBy, null);
});

test("a lone surrogate is refused, not a server error", async () => {
  const a = await join();
  assert.equal((await as(a)("POST", "/event-requests", { host: { ...host, name: "Bad \uD83C name" }, event })).status, 400);
});

test("5 requests sent a day, and racing sends make one", async () => {
  const a = await join();
  const raced = await Promise.all([1, 2, 3].map(() => as(a)("POST", "/event-requests", { host, event })));
  assert.deepEqual(raced.map((x) => x.status).sort(), [201, 409, 409]);
  for (let i = 0; i < 4; i++) {
    assert.equal((await as(a)("DELETE", "/me/event-request")).status, 200);
    if (i < 3) assert.equal((await as(a)("POST", "/event-requests", { host, event })).status, 201);
  }
  assert.equal((await as(a)("POST", "/event-requests", { host, event })).status, 201); // the 5th
  await as(a)("DELETE", "/me/event-request");
  const sixth = await as(a)("POST", "/event-requests", { host, event });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error, "tooMany");
  t.tick(24 * 3600_000 + 1000);
  assert.equal((await as(a)("POST", "/event-requests", { host, event: { ...event, startsAt: new Date(t.now() + 30 * DAY).toISOString() } })).status, 201);
});

test("double approve makes one host", async () => {
  const a = await join(), st = await staff(), st2 = await staff();
  const r = (await as(a)("POST", "/event-requests", { host, event })).body;
  const res = await Promise.all([st, st2, st].map((s) => as(s)("POST", `/galaxy/event-requests/${r.id}/approve`, R)));
  assert.deepEqual(res.map((x) => x.status).sort(), [200, 409, 409]);
  assert.equal((await t.db.select().from(hosts).where(eq(hosts.ownerId, a.me.id))).length, 1);
});

test("approve: unavailable while deletion is pending, a lapsed suspension doesn't block, no contact is a 409", async () => {
  const st = await staff();
  const a = await join();
  const r = (await as(a)("POST", "/event-requests", { host, event })).body;
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now()) }).where(eq(users.id, a.me.id));
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${r.id}/approve`, R)).body.error, "unavailable");
  await t.db.update(users).set({ deletionRequestedAt: null, suspendedAt: new Date(t.now() - 2 * DAY), suspendedUntil: new Date(t.now() - DAY) }).where(eq(users.id, a.me.id));
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${r.id}/approve`, R)).status, 200);

  const b = await join();
  const rb = (await as(b)("POST", "/event-requests", { host, event })).body;
  await t.db.update(users).set({ phone: null, phoneVerifiedAt: null, email: null }).where(eq(users.id, b.me.id));
  const no = await as(st)("POST", `/galaxy/event-requests/${rb.id}/approve`, R);
  assert.equal(no.status, 409);
  assert.equal(no.body.error, "noContact");
  assert.equal((await t.db.select().from(hosts).where(eq(hosts.ownerId, b.me.id))).length, 0);
});

test("day-30 deletion drops requests that never became a host and clears notes on approved ones", async () => {
  const a = await join();
  const row = (status: "approved" | "declined" | "open", note: string | null) =>
    t.db.insert(eventRequests).values({ userId: a.me.id, status, note, host: host as never, event: event as never });
  await row("declined", "Not an event we can list");
  await row("open", null);
  await row("approved", "kept text");
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now()), deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, a.me.id));
  assert.equal(await runDeletions(t.db, async () => {}, t.now()), 1);
  const left = await t.db.select().from(eventRequests).where(eq(eventRequests.userId, a.me.id));
  assert.deepEqual(left.map((x) => [x.status, x.note]), [["approved", null]]);
});

test("an approved venue request leaves the requester able to set the venue up; Galaxy lists it", async () => {
  const a = await join(), st = await staff(), nobody = await join();
  const other = (await as(nobody)("POST", "/hosts", { name: "Not A Venue", kind: "comedy-group", city: "Hyderabad" })).body;
  const sent = await as(a)("POST", "/event-requests", { host: { name: "Respawn Arena", kind: "venue", city: "Hyderabad", about: null } });
  assert.equal(sent.status, 201);
  const ok = await as(st)("POST", `/galaxy/event-requests/${sent.body.id}/approve`, R);
  assert.equal(ok.status, 200);
  const hostId = ok.body.hostId as string;
  assert.equal(ok.body.eventId, null);
  const [h] = await t.db.select().from(hosts).where(eq(hosts.id, hostId));
  assert.equal(h!.kind, "venue");

  // Setup pending until Play Partner saves the venue.
  const pending = (await as(st)("GET", "/galaxy/venues")).body.venues.find((v: any) => v.host.id === hostId);
  assert.equal(pending.venue, null);
  assert.equal(pending.host.status, "live");
  // Only Venue hosts.
  assert.ok(!(await as(st)("GET", "/galaxy/venues")).body.venues.some((v: any) => v.host.id === other.id));
  assert.deepEqual(pending.stations, []);

  const setup = await as(a)("PUT", `/venues/${hostId}`, { address: "1 Road", area: "Madhapur", lat: 17.4, lng: 78.4, deskPhone: "+914012345678", week: Array(7).fill([11, 23]) });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  const pc = await as(a)("POST", `/venues/${hostId}/stations`, { name: "Gaming PC", unit: "PC", tile: "gaming", count: 10, pricePaise: 8000 });
  assert.equal(pc.status, 201, JSON.stringify(pc.body));

  const live = (await as(st)("GET", "/galaxy/venues")).body.venues.find((v: any) => v.host.id === hostId);
  assert.deepEqual(live.venue, { area: "Madhapur", address: "1 Road", deskPhone: "+914012345678" });
  assert.deepEqual(live.stations, [{ id: pc.body.id, name: "Gaming PC", unit: "PC", tile: "gaming", count: 10, pricePaise: 8000, archived: false }]);

  // Holders of Hosts only.
  assert.equal((await as(nobody)("GET", "/galaxy/venues")).status, 404);
  assert.equal((await as(a)("GET", "/galaxy/venues")).status, 404);
  assert.equal((await t.call("GET", "/galaxy/venues")).status, 401);
});

test("a venue request's answers land in Play Partner, its email names Play Partner; others stay in Event Partner", async () => {
  const a = await join(), st = await staff();
  assert.equal((await as(a)("PUT", "/me/push-device", { app: "station", platform: "ios", env: "sandbox", token: `tok-x9-${a.me.id}` })).status, 204);
  const venue = { name: "Respawn Arena", kind: "venue", city: "Hyderabad", about: null };
  const sent = await as(a)("POST", "/event-requests", { host: venue });
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${sent.body.id}/changes`, { reason: "Add the area" })).status, 200);
  assert.equal((await as(a)("PATCH", "/me/event-request", { host: { ...venue, about: "Madhapur" } })).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/event-requests/${sent.body.id}/approve`, R)).status, 200);

  const items = await t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, a.me.id), eq(inboxItems.kind, "eventRequestAnswered")));
  assert.deepEqual(items.map((i) => i.app), ["station", "station"]);
  const pushes = await t.db.select().from(deliveries).where(and(eq(deliveries.userId, a.me.id), eq(deliveries.kind, "eventRequestAnswered"), eq(deliveries.channel, "push")));
  assert.equal(pushes.length, 2);
  assert.ok(pushes.every((p) => p.status === "queued"), JSON.stringify(pushes.map((p) => p.reason)));

  assert.match(emailFor("eventRequestAnswered", { decision: "approved", name: "Respawn Arena", kind: "venue" }).text, /Orbit Play Partner/);
  assert.match(emailFor("eventRequestAnswered", { decision: "changes", name: "Punchline", kind: "comedy-group", reason: "x" }).text, /Orbit Event Partner/);
  assert.equal(inboxApp("eventRequestAnswered", { kind: "comedy-group" }), "launch");
});
