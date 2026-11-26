import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { HostEvents } from "@orbit/contract";
import { testApp } from "../testkit.ts";
import { auditLog, bookings, events, hosts, staffGrants, teamRoles, ticketTypes } from "../db/schema.ts";

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
const event = { title: "Open Mic Night", category: "comedy", startsAt: "2026-12-12T19:00:00+05:30", venue: "The Moonshine Project", paid: false, expectedSize: 80 };
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

test("Galaxy's request routes are for holders of Hosts only, never on their own request", async () => {
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
  const book = (userId: string, quantity: number, status: "confirmed" | "cancelled") =>
    t.db.insert(bookings).values({ userId, eventId: e.id, ticketTypeId: tier!.id, quantity, status, qr: crypto.randomUUID(), code: crypto.randomUUID() });
  await book(b.me.id, 3, "confirmed");
  await book(c.me.id, 2, "confirmed");
  await book(a.me.id, 4, "cancelled");
  const list = HostEvents.parse((await as(a)("GET", `/hosts/${h.id}/events`)).body);
  const by = new Map(list.drafts.map((r) => [r.id, r]));
  assert.equal(by.get(e.id)!.sold, 5);
  assert.equal(by.get(e.id)!.checkedIn, 0);
  assert.equal(by.get(other.id)!.sold, 0);
});
