import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { auditLog, bookings, events, reports, staffGrants, ticketTypes, userBlocks, users } from "./db/schema.ts";
import { runDeletions } from "./auth/deletion.ts";

// Reports (X15): sending one, the Galaxy queue, and the event's calendar file. People in rooms (inRoom R2).

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(8_000_000 + ++n * 11).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

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
const withFeature = async (feature: "queues" | "hosts") => {
  const s = await join();
  await t.db.insert(staffGrants).values({ userId: s.me.id, feature, addedBy: s.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return s;
};
let hn = 0;
const start = async (u: P) => (await as(u)("POST", "/hosts", { name: `Punchline ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string; slug: string };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
const place = { venue: "Hall; Main", address: "Road 1, Block 2", area: "Jubilee Hills", city: "Hyderabad" };
const draft = async (u: P, hostId: string, title = "Open Mic Night") => (await as(u)("POST", `/hosts/${hostId}/events`, { title })).body as { id: string; slug: string };
const publish = async (u: P, hostId: string, title?: string) => {
  const e = await draft(u, hostId, title);
  const form = new FormData();
  form.set("image", new File([(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer()) as BlobPart], "p.png", { type: "image/png" }));
  const up = await t.app.request(`/events/${e.id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  assert.equal(up.status, 200);
  assert.equal((await as(u)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(DAY), endsAt: iso(DAY + 2 * HOUR), place })).status, 200);
  await as(u)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 });
  assert.equal((await as(u)("POST", `/events/${e.id}/publish`)).status, 200);
  return e;
};

test("send a report: checked, 404 for a missing or draft subject, one open per subject, 10 a day", async () => {
  const owner = await join(), a = await join();
  const h = await start(owner);
  const e = await publish(owner, h.id);
  const d = await draft(owner, h.id, "Secret");

  assert.equal((await t.call("POST", "/reports", { eventId: e.id, reason: "scam" })).status, 401);
  assert.equal((await as(a)("POST", "/reports", { reason: "scam" })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { eventId: e.id, hostId: h.id, reason: "scam" })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { eventId: e.id, reason: "boring" })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { eventId: e.id, reason: "other", note: "x".repeat(1001) })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { eventId: d.id, reason: "scam" })).status, 404);
  assert.equal((await as(a)("POST", "/reports", { hostId: crypto.randomUUID(), reason: "scam" })).status, 404);

  const one = await as(a)("POST", "/reports", { eventId: e.id, reason: "scam", note: "Asks for UPI to a personal number" });
  assert.equal(one.status, 201);
  const again = await as(a)("POST", "/reports", { eventId: e.id, reason: "spam" });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, one.body.id);
  assert.equal((await as(a)("POST", "/reports", { hostId: h.id, reason: "misleading" })).status, 201);

  // 5 valid tries so far today (the 400s don't count); 5 more pass, the 11th is refused, and a day later it's open again.
  for (let i = 0; i < 5; i++) assert.equal((await as(a)("POST", "/reports", { hostId: h.id, reason: "spam" })).status, 200);
  const many = await as(a)("POST", "/reports", { hostId: h.id, reason: "spam" });
  assert.equal(many.status, 429);
  assert.equal(many.body.error, "tooMany");
  t.tick(DAY);
  assert.equal((await as(a)("POST", "/reports", { hostId: h.id, reason: "spam" })).status, 200);
});

test("Galaxy: Queues only; list, view, resolve and dismiss once", async () => {
  const owner = await join(), a = await join(), b = await join(), hostsOnly = await withFeature("hosts"), q = await withFeature("queues");
  const h = await start(owner);
  const e = await publish(owner, h.id, "Late Show");
  const ra = (await as(a)("POST", "/reports", { eventId: e.id, reason: "unsafe", note: "No exits" })).body.id as string;
  t.tick(1000); // newest first needs two times
  const rb = (await as(b)("POST", "/reports", { eventId: e.id, reason: "offensive" })).body.id as string;

  assert.equal((await as(a)("GET", "/galaxy/reports")).status, 404);
  assert.equal((await as(hostsOnly)("GET", "/galaxy/reports")).status, 404);
  for (const u of [a, hostsOnly]) {
    assert.equal((await as(u)("GET", `/galaxy/reports/${ra}`)).status, 404);
    assert.equal((await as(u)("POST", `/galaxy/reports/${ra}/resolve`, {})).status, 404);
    assert.equal((await as(u)("POST", `/galaxy/reports/${ra}/dismiss`, {})).status, 404);
  }
  assert.equal((await as(q)("GET", "/galaxy/reports?status=nope")).status, 400);

  const open = (await as(q)("GET", "/galaxy/reports")).body.reports as any[];
  const mine = open.filter((r) => r.subject.id === e.id);
  assert.deepEqual(mine.map((r) => r.id), [rb, ra]); // newest first
  assert.equal(mine[1].subject.kind, "event");
  assert.equal(mine[1].subject.name, "Late Show");
  assert.equal(mine[1].subject.slug, e.slug);
  assert.equal(mine[1].openOnSubject, 2);
  assert.match(mine[1].reporter.phone, /^\+91 ••••••\d{4}$/);

  const one = await as(q)("GET", `/galaxy/reports/${ra}`);
  assert.equal(one.body.note, "No exits");
  assert.equal(one.body.decidedBy, null);
  assert.equal((await as(q)("GET", "/galaxy/reports/nope")).status, 404);
  assert.equal((await as(q)("GET", `/galaxy/reports/${crypto.randomUUID()}`)).status, 404);

  const done = await as(q)("POST", `/galaxy/reports/${ra}/resolve`, { note: "Host fixed the page" });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "resolved");
  assert.equal(done.body.staffNote, "Host fixed the page");
  assert.equal(done.body.decidedBy.id, q.me.id);
  assert.equal(done.body.openOnSubject, 1);
  assert.equal((await as(q)("POST", `/galaxy/reports/${ra}/dismiss`, {})).status, 409);
  assert.equal((await as(q)("POST", `/galaxy/reports/${rb}/dismiss`, {})).body.status, "dismissed");
  assert.equal((await as(q)("POST", `/galaxy/reports/${rb}/resolve`, {})).status, 409);
  assert.equal((await as(q)("GET", "/galaxy/reports?status=resolved")).body.reports[0].id, ra);
  assert.equal((await as(q)("GET", "/galaxy/reports?status=dismissed")).body.reports[0].id, rb);
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.actorId, q.me.id))).length, 2);

  // Decided, the reporter may send a new one on the same event.
  assert.equal((await as(a)("POST", "/reports", { eventId: e.id, reason: "unsafe" })).status, 201);
});

test("calendar file for a published event, 404 for a draft", async () => {
  const owner = await join();
  const h = await start(owner);
  const e = await publish(owner, h.id, "Jokes, Laughs; More");
  const d = await draft(owner, h.id);
  const res = await t.app.request(`/public/events/${e.slug}/calendar.ics`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(res.headers.get("content-disposition"), `inline; filename="${e.slug}.ics"`);
  const body = await res.text();
  assert.ok(body.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Orbit//EN\r\n"));
  assert.ok(body.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(body));
  assert.ok(body.includes(`UID:${e.id}@heyorbit.in\r\n`));
  assert.ok(body.includes("SUMMARY:Jokes\\, Laughs\\; More\r\n"));
  assert.ok(body.includes("LOCATION:Hall\\; Main\\, Road 1\\, Block 2\\, Jubilee Hills\\, Hyderabad\r\n"));
  assert.ok(body.includes(`URL:https://heyorbit.in/event/${e.slug}\r\n`));
  assert.match(body, /DTSTART:\d{8}T\d{6}Z\r\nDTEND:\d{8}T\d{6}Z\r\n/);
  assert.equal((await t.app.request(`/public/events/${d.slug}/calendar.ics`)).status, 404);
  assert.equal((await t.app.request(`/public/events/nope-nope/calendar.ics`)).status, 404);
});

test("two reports at once: one made, the other answered with it", async () => {
  const owner = await join(), a = await join();
  const h = await start(owner);
  const [x, y] = await Promise.all([as(a)("POST", "/reports", { hostId: h.id, reason: "spam" }), as(a)("POST", "/reports", { hostId: h.id, reason: "scam" })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 201]);
  assert.equal(x.body.id, y.body.id);
});

test("staff never see or decide reports on a host they're on", async () => {
  const q = await withFeature("queues"), q2 = await withFeature("queues"), a = await join();
  const h = await start(q); // q owns this host
  const e = await publish(q, h.id, "My Own Show");
  const onHost = (await as(a)("POST", "/reports", { hostId: h.id, reason: "spam" })).body.id as string;
  const onEvent = (await as(a)("POST", "/reports", { eventId: e.id, reason: "unsafe" })).body.id as string;
  for (const id of [onHost, onEvent]) {
    assert.equal((await as(q)("POST", `/galaxy/reports/${id}/resolve`, {})).status, 403);
    assert.equal((await as(q)("POST", `/galaxy/reports/${id}/dismiss`, {})).body.error, "ownHost");
    assert.equal((await as(q)("GET", `/galaxy/reports/${id}`)).status, 404);
  }
  const seen = ((await as(q)("GET", "/galaxy/reports")).body.reports as any[]).map((r) => r.id);
  assert.ok(!seen.includes(onHost) && !seen.includes(onEvent));
  // Another staff member sees and decides them.
  const other = ((await as(q2)("GET", "/galaxy/reports")).body.reports as any[]).map((r) => r.id);
  assert.ok(other.includes(onHost) && other.includes(onEvent));
  assert.equal((await as(q2)("POST", `/galaxy/reports/${onHost}/resolve`, {})).status, 200);
});

test("calendar file: text with line breaks and controls, no end time, cancelled", async () => {
  const owner = await join();
  const h = await start(owner);
  const e = await publish(owner, h.id);
  await t.db.update(events).set({ title: "Line\r\nBreak\rOne\nTwo\u0007\u2028End", endsAt: null }).where(eq(events.id, e.id));
  const body = await (await t.app.request(`/public/events/${e.slug}/calendar.ics`)).text();
  assert.ok(body.includes("SUMMARY:Line\\nBreak\\nOne\\nTwoEnd\r\n"));
  assert.ok(!/\r(?!\n)|[^\r]\n/.test(body));
  const start_ = /DTSTART:(\d{8}T\d{6}Z)/.exec(body)![1]!, end = /DTEND:(\d{8}T\d{6}Z)/.exec(body)![1]!;
  const ms = (s: string) => Date.parse(s.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z"));
  assert.equal(ms(end) - ms(start_), 2 * HOUR);
  await t.db.update(events).set({ status: "cancelled" }).where(eq(events.id, e.id));
  assert.equal((await t.app.request(`/public/events/${e.slug}/calendar.ics`)).status, 404);
});

// ---------- People in rooms (inRoom R2) ----------

let k = 0;
type E = { id: string; hostId: string; tt: string };
// A published meetup with inRoom on, started an hour ago, ending in an hour (as rooms.test.ts).
const meetup = async (owner: P): Promise<E> => {
  const h = await start(owner);
  const [e] = await t.db
    .insert(events)
    .values({ hostId: h.id, slug: `room-${++k}`, status: "published", title: `Founders Meetup ${k}`, category: "meetups", inRoom: true, startsAt: new Date(t.now() - HOUR), endsAt: new Date(t.now() + HOUR), createdBy: owner.me.id, publishedAt: new Date(t.now() - DAY) })
    .returning();
  const [tt] = await t.db.insert(ticketTypes).values({ eventId: e!.id, name: "General" }).returning();
  return { id: e!.id, hostId: h.id, tt: tt!.id };
};
const book = (u: P, e: E) => t.db.insert(bookings).values({ userId: u.me.id, eventId: e.id, ticketTypeId: e.tt, quantity: 1, qr: crypto.randomUUID(), code: crypto.randomUUID(), admitted: 1 });
// Someone let in who has put up a card, with a name and an email of their own: their member id.
const guest = async (e: E, u?: P) => {
  const g = u ?? (await join());
  await t.db.update(users).set({ name: `Guest ${g.me.id.slice(0, 4)}`, email: `${g.p}@example.com`, emailVerifiedAt: new Date() }).where(eq(users.id, g.me.id));
  await book(g, e);
  const r = await as(g)("PUT", `/me/rooms/${e.id}/card`, { line: "Building a climbing gym app", reach: [{ label: "Instagram", value: "@climber" }] });
  assert.equal(r.body.state, "in");
  return { ...g, member: r.body.me.id as string };
};
type G = Awaited<ReturnType<typeof guest>>;
const report = (u: P, e: E, memberId: string, reason = "offensive") => as(u)("POST", "/reports", { eventId: e.id, memberId, reason });

test("report a person: any other card in the reporter's room, {id} only, one open per person per room", async () => {
  const owner = await join(), q = await withFeature("queues");
  const e = await meetup(owner), other = await meetup(owner);
  const a = await guest(e), b = await guest(e), x = await guest(other);

  assert.equal((await as(a)("POST", "/reports", { memberId: b.member, reason: "spam" })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { hostId: e.hostId, memberId: b.member, reason: "spam" })).status, 400);

  const one = await report(a, e, b.member);
  assert.equal(one.status, 201);
  assert.deepEqual(Object.keys(one.body), ["id"]);
  const raw = JSON.stringify(one.body);
  assert.ok(!raw.includes(b.me.id) && !raw.includes(b.p) && !raw.includes("@example.com"));
  const again = await report(a, e, b.member, "spam");
  assert.equal(again.status, 200);
  assert.equal(again.body.id, one.body.id);

  // The room's event is a subject of its own: the person report doesn't answer for it, nor it for the person.
  const ev = await as(a)("POST", "/reports", { eventId: e.id, reason: "unsafe" });
  assert.equal(ev.status, 201);
  assert.notEqual(ev.body.id, one.body.id);
  assert.equal((await report(a, e, b.member)).body.id, one.body.id);

  // The same person from another room is another report.
  await guest(other, a);
  const b2 = await guest(other, b);
  const there = await report(a, other, b2.member);
  assert.equal(there.status, 201);
  assert.notEqual(there.body.id, one.body.id);

  // Decided, a new one may be sent.
  assert.equal((await as(q)("POST", `/galaxy/reports/${one.body.id}/dismiss`, {})).status, 200);
  const next = await report(a, e, b.member);
  assert.equal(next.status, 201);
  assert.notEqual(next.body.id, one.body.id);

  // Another room's card, a room the reporter isn't in, a made-up id, themselves: all the same 404, and the same body as
  // a reporter who isn't in, or is let in with no card.
  const c = await guest(e);
  const missing = await report(c, e, crypto.randomUUID());
  assert.equal(missing.status, 404);
  for (const r of [await report(c, e, x.member), await report(c, other, x.member), await report(c, e, c.member)]) assert.deepEqual(r, missing);
  const stranger = await join(), door = await join();
  await book(door, e);
  for (const u of [stranger, door]) assert.deepEqual(await report(u, e, b.member), missing);
});

test("report a person: left, removed, blocked and suspended people stay reportable; reporters out, removed or barred aren't", async () => {
  const owner = await join(), staff = await withFeature("queues");
  const e = await meetup(owner);
  const a = await guest(e), left = await guest(e), removed = await guest(e), blocked = await guest(e), blocker = await guest(e), suspended = await guest(e), barred = await guest(e);
  const leaver = await guest(e), outed = await guest(e), ok = await guest(e);
  await as(left)("DELETE", `/me/rooms/${e.id}`);
  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${removed.member}/remove`, { reason: "Spam links" }, staff.access)).status, 200);
  assert.equal((await as(a)("POST", `/me/rooms/${e.id}/members/${blocked.member}/block`)).status, 204); // block, then report
  await t.db.insert(userBlocks).values({ blockerId: blocker.me.id, blockedId: a.me.id, createdAt: new Date() });
  await t.db.update(users).set({ suspendedAt: new Date(t.now()) }).where(eq(users.id, suspended.me.id));
  for (const m of [left, removed, blocked, blocker, suspended]) assert.equal((await report(a, e, m.member)).status, 201);

  // A reporter who left still can; one removed, barred or no longer let in can't.
  await as(leaver)("DELETE", `/me/rooms/${e.id}`);
  assert.equal((await report(leaver, e, ok.member)).status, 201);
  await t.db.update(users).set({ inRoomBarredAt: new Date(t.now()) }).where(eq(users.id, barred.me.id));
  await t.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.userId, outed.me.id));
  const missing = await report(ok, e, crypto.randomUUID());
  for (const u of [removed, barred, outed]) assert.deepEqual(await report(u, e, ok.member), missing);
});

test("report a person after the room closes: any card there, by anyone with a card", async () => {
  const owner = await join();
  const e = await meetup(owner);
  const a = await guest(e), b = await guest(e), c = await guest(e), stranger = await join();
  await as(c)("DELETE", `/me/rooms/${e.id}`);
  await t.db.update(events).set({ startsAt: new Date(t.now() - 9 * DAY), endsAt: new Date(t.now() - 7 * DAY) }).where(eq(events.id, e.id));
  assert.equal((await as(a)("GET", `/me/rooms/${e.id}`)).body.state, "closed");
  assert.equal((await report(a, e, b.member)).status, 201);
  assert.equal((await report(c, e, a.member)).status, 201);
  assert.equal((await report(stranger, e, a.member)).status, 404);
});

test("report a person: no room, no report; a deleted account's card is gone", async () => {
  const owner = await join();
  const e = await meetup(owner), f = await meetup(owner);
  const a = await guest(e), b = await guest(e), c = await guest(f), d = await guest(f);
  await t.db.update(events).set({ status: "draft" }).where(eq(events.id, e.id));
  assert.equal((await report(a, e, b.member)).status, 404);
  await t.db.update(events).set({ inRoom: false }).where(eq(events.id, f.id));
  assert.equal((await report(c, f, d.member)).status, 404);
  await t.db.update(events).set({ inRoom: true }).where(eq(events.id, f.id));
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now() - DAY), deletionDueAt: new Date(t.now() - 1) }).where(eq(users.id, d.me.id));
  await runDeletions(t.db, t.notify, t.now());
  assert.equal((await report(c, f, d.member)).status, 404);
});

test("two person reports at once: one row", async () => {
  const owner = await join();
  const e = await meetup(owner);
  const a = await guest(e), b = await guest(e);
  const [x, y] = await Promise.all([report(a, e, b.member, "spam"), report(a, e, b.member, "scam")]);
  assert.deepEqual([x.status, y.status].sort(), [200, 201]);
  assert.equal(x.body.id, y.body.id);
  assert.equal((await t.db.select().from(reports).where(eq(reports.subjectUserId, b.me.id))).length, 1);
});

test("report a person: every try counts toward the 10 a day", async () => {
  const owner = await join();
  const e = await meetup(owner);
  const a = await guest(e), b = await guest(e);
  for (let i = 0; i < 9; i++) assert.equal((await report(a, e, crypto.randomUUID())).status, 404);
  assert.equal((await report(a, e, b.member)).status, 201);
  const many = await report(a, e, b.member);
  assert.equal(many.status, 429);
  assert.equal(many.body.error, "tooMany");
});

test("Galaxy: person reports show the person and the room; open count per person; never on one's own host or about oneself", async () => {
  const owner = await join(), q = await withFeature("queues"), q2 = await withFeature("queues");
  const e = await meetup(owner), e2 = await meetup(owner);
  const a = await guest(e), b = await guest(e), c = await guest(e), d = await guest(e);
  const ab = (await report(a, e, b.member)).body.id as string;
  t.tick(1000);
  const cb = (await report(c, e, b.member)).body.id as string;
  const ad = (await report(a, e, d.member)).body.id as string;
  const ev = (await as(a)("POST", "/reports", { eventId: e.id, reason: "unsafe" })).body.id as string;
  // b again, from another room: counted on b too.
  await guest(e2, a);
  const b2 = await guest(e2, b);
  const ab2 = (await report(a, e2, b2.member)).body.id as string;

  const list = (await as(q)("GET", "/galaxy/reports")).body.reports as any[];
  const byId = new Map(list.map((r) => [r.id, r]));
  const [lab, lcb, lad, lev, lab2] = [ab, cb, ad, ev, ab2].map((id) => byId.get(id));
  assert.equal(lab.subject.kind, "person");
  assert.equal(lab.subject.id, e.id);
  const [ee] = await t.db.select({ title: events.title }).from(events).where(eq(events.id, e.id));
  assert.equal(lab.subject.name, ee!.title);
  const [bName] = await t.db.select({ name: users.name }).from(users).where(eq(users.id, b.me.id));
  assert.deepEqual(lab.subject.person, { userId: b.me.id, name: bName!.name, memberId: b.member, line: "Building a climbing gym app" });
  assert.equal(lab2.subject.person.memberId, b2.member);
  assert.equal(lab.openOnSubject, 3);
  assert.equal(lcb.openOnSubject, 3);
  assert.equal(lab2.openOnSubject, 3);
  assert.equal(lad.openOnSubject, 1);
  assert.equal(lev.subject.kind, "event");
  assert.equal(lev.openOnSubject, 1); // the person reports in its room aren't on the event

  const one = await as(q)("GET", `/galaxy/reports/${ab}`);
  assert.deepEqual(one.body.subject, lab.subject);
  const done = await as(q)("POST", `/galaxy/reports/${ab}/resolve`, { note: "Card removed" });
  assert.equal(done.body.status, "resolved");
  assert.equal(done.body.openOnSubject, 2);
  const [log] = await t.db.select().from(auditLog).where(eq(auditLog.actorId, q.me.id));
  assert.equal(log!.targetUser, null); // off b's People page
  assert.deepEqual(log!.data, { reportId: ab, eventId: e.id, subjectUserId: b.me.id });

  // A report about a staff member: they never see or decide it; another does.
  const qe = await guest(e, q2);
  const aq = (await report(a, e, qe.member)).body.id as string;
  assert.equal((await as(q2)("GET", `/galaxy/reports/${aq}`)).status, 404);
  const mine = await as(q2)("POST", `/galaxy/reports/${aq}/resolve`, {});
  assert.equal(mine.status, 403);
  assert.equal(mine.body.error, "self");
  assert.ok(!((await as(q2)("GET", "/galaxy/reports")).body.reports as any[]).some((r) => r.id === aq));
  assert.equal((await as(q)("GET", `/galaxy/reports/${aq}`)).status, 200);

  // A room on q2's own host: q2 never sees or decides its reports; q does.
  const own = await meetup(q2);
  const x = await guest(own), y = await guest(own);
  const xy = (await report(x, own, y.member)).body.id as string;
  assert.equal((await as(q2)("GET", `/galaxy/reports/${xy}`)).status, 404);
  assert.equal((await as(q2)("POST", `/galaxy/reports/${xy}/resolve`, {})).body.error, "ownHost");
  assert.ok(!((await as(q2)("GET", "/galaxy/reports")).body.reports as any[]).some((r) => r.id === xy));
  assert.equal((await as(q)("POST", `/galaxy/reports/${xy}/dismiss`, {})).status, 200);
});
