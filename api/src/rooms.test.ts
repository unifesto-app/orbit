import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, or } from "drizzle-orm";
import { testApp } from "./testkit.ts";
import { auditLog, bookings, deliveries, events, hosts, inboxItems, roomAsks, roomMembers, staffGrants, ticketTypes, userBlocks, users } from "./db/schema.ts";
import { runDeletions } from "./auth/deletion.ts";

// inRoom (Feature 3, R1): the room as a guest sees it, asks and blocks, Galaxy's Rooms, and account deletion.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `7${String(3_000_000 + ++n * 13).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

type P = { p: string; access: string; me: { id: string } };
const everyone: P[] = [];
const join = async () => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: `Guest ${n}`, dob: "2000-05-01", device });
  const u = { p, ...s.body } as P;
  await t.db.update(users).set({ email: `g${n}@example.com`, emailVerifiedAt: new Date() }).where(eq(users.id, u.me.id));
  everyone.push(u);
  return u;
};

// No account id, phone or email anywhere in a room response, reach aside (checked on its own).
const noContacts = (body: unknown) => {
  const strip = JSON.parse(JSON.stringify(body ?? null), (k, v) => (k === "reach" ? undefined : v));
  const s = JSON.stringify(strip);
  for (const u of everyone) {
    assert.ok(!s.includes(u.me.id), "a user id leaked");
    assert.ok(!s.includes(u.p), "a phone leaked");
  }
  assert.ok(!/@example\.com/.test(s), "an email leaked");
};
const as = (u: P) => async (m: string, path: string, body?: unknown) => {
  const r = await t.call(m, path, body, u.access);
  if (path.startsWith("/me/rooms")) noContacts(r.body);
  return r;
};

const withQueues = async (u?: P) => {
  const s = u ?? (await join());
  await t.db.insert(staffGrants).values({ userId: s.me.id, feature: "queues", addedBy: s.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return s;
};

let k = 0;
type E = { id: string; hostId: string; tt: string };
// A published meetup with inRoom on, started an hour ago, ending in an hour.
const meetup = async (owner: P, over: Partial<typeof events.$inferInsert> = {}): Promise<E> => {
  const h = (await as(owner)("POST", "/hosts", { name: `Founders ${++k}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
  assert.ok(h.id);
  const [e] = await t.db
    .insert(events)
    .values({ hostId: h.id, slug: `meet-${k}`, status: "published", title: `Founders Meetup ${k}`, category: "meetups", inRoom: true, startsAt: new Date(t.now() - HOUR), endsAt: new Date(t.now() + HOUR), createdBy: owner.me.id, publishedAt: new Date(t.now() - DAY), ...over })
    .returning();
  const [tt] = await t.db.insert(ticketTypes).values({ eventId: e!.id, name: "General" }).returning();
  return { id: e!.id, hostId: h.id, tt: tt!.id };
};
const book = async (u: P, e: E, admitted = 1) =>
  (await t.db.insert(bookings).values({ userId: u.me.id, eventId: e.id, ticketTypeId: e.tt, quantity: 2, qr: crypto.randomUUID(), code: crypto.randomUUID(), admitted }).returning())[0]!;
const card = (line = "Building a climbing gym app") => ({ line, reach: [{ label: "Instagram", value: "@climber" }] });
const room = (e: E) => `/me/rooms/${e.id}`;
// A guest let in who has joined: their member id.
const guest = async (e: E, u?: P) => {
  const g = u ?? (await join());
  await book(g, e);
  const r = await as(g)("PUT", `${room(e)}/card`, card());
  assert.equal(r.status, 200);
  assert.equal(r.body.state, "in");
  return { ...g, member: r.body.me.id as string };
};
type G = Awaited<ReturnType<typeof guest>>;
const ids = async (u: P, e: E) => ((await as(u)("GET", room(e))).body.members as { id: string }[]).map((m) => m.id);
const VIEW_KEYS = ["closesAt", "event", "me", "members", "state"];

test("401 signed out; 404 with no room", async () => {
  const owner = await join(), a = await join();
  const e = await meetup(owner);
  assert.equal((await t.call("GET", room(e))).status, 401);
  assert.equal((await t.call("PUT", `${room(e)}/card`, card())).status, 401);
  assert.equal((await t.call("POST", `${room(e)}/asks`, { memberId: crypto.randomUUID() })).status, 401);

  const comedy = await meetup(owner, { category: "comedy" });
  const off = await meetup(owner, { inRoom: false });
  const draft = await meetup(owner, { status: "draft" });
  const paused = await meetup(owner);
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, paused.hostId));
  for (const x of [comedy, off, draft, paused]) {
    await book(a, x);
    assert.equal((await as(a)("GET", room(x))).status, 404);
    assert.equal((await as(a)("PUT", `${room(x)}/card`, card())).status, 404);
  }
  assert.equal((await as(a)("GET", `/me/rooms/${crypto.randomUUID()}`)).status, 404);
  assert.equal((await as(a)("GET", "/me/rooms/nope")).status, 404);
});

test("door, out, closed, removed and barred show nobody and no counts", async () => {
  const owner = await join(), staff = await withQueues();
  const e = await meetup(owner);
  await guest(e);
  await guest(e);
  const shut = async (u: P, state: string, x = e) => {
    const r = await as(u)("GET", room(x));
    assert.equal(r.status, 200);
    assert.equal(r.body.state, state);
    assert.deepEqual(Object.keys(r.body).sort(), VIEW_KEYS);
    assert.deepEqual(Object.keys(r.body.event).sort(), ["endsAt", "id", "slug", "startsAt", "title"]);
    assert.deepEqual(r.body.members, []);
    return r.body;
  };

  const stranger = await join(); // no booking
  await shut(stranger, "out");
  assert.equal((await as(stranger)("PUT", `${room(e)}/card`, card())).body.error, "out");
  const notIn = await join();
  await book(notIn, e, 0); // booked, not checked in: the room opens when they're let in
  await shut(notIn, "out");
  const door = await join();
  await book(door, e);
  assert.equal((await shut(door, "door")).me, null);

  const removed = await guest(e);
  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${removed.member}/remove`, { reason: "Spam links" }, staff.access)).status, 200);
  assert.equal((await shut(removed, "removed")).me, null);
  const barred = await guest(e);
  await t.db.update(users).set({ inRoomBarredAt: new Date(t.now()) }).where(eq(users.id, barred.me.id));
  await shut(barred, "barred");

  // Closed at the end + 7 days exactly, and it moves with the end.
  const late = await meetup(owner);
  const g = await join();
  await book(g, late);
  await t.db.update(events).set({ startsAt: new Date(t.now() - 9 * DAY), endsAt: new Date(t.now() - 7 * DAY) }).where(eq(events.id, late.id));
  const body = await shut(g, "closed", late);
  assert.equal(body.closesAt, new Date(t.now()).toISOString());
  assert.equal((await as(g)("PUT", `${room(late)}/card`, card())).body.error, "closed");
  await t.db.update(events).set({ endsAt: new Date(t.now() - 7 * DAY + 1) }).where(eq(events.id, late.id));
  assert.equal((await as(g)("GET", room(late))).body.state, "door");
  assert.equal((await as(g)("PUT", `${room(late)}/card`, card())).body.state, "in");
});

test("closed: a past member keeps only their connections, with reach; nothing else", async () => {
  const owner = await join(), staff = await withQueues();
  const e = await meetup(owner);
  const a = await guest(e), b = await guest(e), c = await guest(e), gone = await guest(e), blocked = await guest(e), removed = await guest(e), stranger = await join();
  await book(stranger, e);
  const connect = async (from: G, to: G) => {
    const q = (await as(from)("POST", `${room(e)}/asks`, { memberId: to.member })).body.askId as string;
    assert.equal((await as(to)("POST", `${room(e)}/asks/${q}/accept`)).status, 200);
  };
  for (const x of [b, gone, blocked, removed]) await connect(a, x);
  await as(c)("POST", `${room(e)}/asks`, { memberId: a.member }); // asked, never answered
  await t.call("POST", `/galaxy/rooms/${e.id}/members/${removed.member}/remove`, { reason: "Spam links" }, staff.access);
  await as(b)("DELETE", room(e)); // left before the close: connections stay
  await t.db.update(users).set({ deletedAt: new Date(t.now()) }).where(eq(users.id, gone.me.id));
  await t.db.insert(userBlocks).values({ blockerId: blocked.me.id, blockedId: a.me.id, createdAt: new Date() });
  await t.db.update(events).set({ startsAt: new Date(t.now() - 9 * DAY), endsAt: new Date(t.now() - 7 * DAY) }).where(eq(events.id, e.id));
  // No live check after the close: a cancelled booking doesn't matter.
  await t.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.userId, a.me.id));

  const seen = (await as(a)("GET", room(e))).body;
  assert.equal(seen.state, "closed");
  assert.deepEqual(Object.keys(seen).sort(), VIEW_KEYS);
  assert.deepEqual(seen.members.map((m: any) => m.id).sort(), [b.member, removed.member].sort());
  const bm = seen.members.find((m: any) => m.id === b.member);
  assert.equal(bm.ask, "connected");
  assert.deepEqual(bm.reach, card().reach);
  // b left, and still has a.
  assert.deepEqual((await as(b)("GET", room(e))).body.members.map((m: any) => m.id), [a.member]);
  // Unconnected, never joined, removed: nothing.
  for (const u of [c, stranger, removed]) assert.deepEqual((await as(u)("GET", room(e))).body.members, [], "leaked after close");
  assert.equal((await as(removed)("GET", room(e))).body.state, "removed");
  // No new asks, accepts or blocks once closed.
  assert.equal((await as(c)("POST", `${room(e)}/asks`, { memberId: b.member })).body.error, "closed");
  const pending = (await t.db.select().from(roomAsks).where(and(eq(roomAsks.fromMember, c.member), eq(roomAsks.status, "pending"))))[0]!;
  assert.equal((await as(a)("POST", `${room(e)}/asks/${pending.id}/accept`)).body.error, "closed");
  assert.equal((await as(a)("POST", `${room(e)}/members/${b.member}/block`)).body.error, "closed");
});

test("who a member sees: every exclusion, the host mark, check-in undo ends access", async () => {
  const owner = await join();
  const e = await meetup(owner);
  const host = await guest(e, owner); // the host's own Admin, checked in like anyone
  const a = await guest(e), left = await guest(e), removed = await guest(e), blocked = await guest(e), blocker = await guest(e);
  const suspended = await guest(e), deleted = await guest(e), barred = await guest(e), cancelled = await guest(e), undone = await guest(e), ok = await guest(e);
  await join().then((u) => book(u, e)); // let in, never joined: not a member

  const first = (await as(a)("GET", room(e))).body;
  assert.equal(first.members.length, 11);
  assert.ok(!first.members.some((m: any) => m.id === a.member)); // never themselves
  assert.equal(first.members.find((m: any) => m.id === host.member).host, true);
  assert.equal(first.members.find((m: any) => m.id === ok.member).host, false);
  assert.deepEqual(first.me, { id: a.member, ...card() });
  for (const m of first.members) {
    assert.deepEqual(Object.keys(m).sort(), ["ask", "host", "id", "line", "name", "photo"]);
    assert.equal(m.ask, "none");
  }

  assert.equal((await as(left)("DELETE", room(e))).status, 204);
  await t.call("POST", `/galaxy/rooms/${e.id}/members/${removed.member}/remove`, { reason: "Spam links" }, (await withQueues()).access);
  await t.db.insert(userBlocks).values({ blockerId: a.me.id, blockedId: blocked.me.id, createdAt: new Date() });
  await t.db.insert(userBlocks).values({ blockerId: blocker.me.id, blockedId: a.me.id, createdAt: new Date() });
  await t.db.update(users).set({ suspendedAt: new Date(t.now()) }).where(eq(users.id, suspended.me.id));
  await t.db.update(users).set({ deletedAt: new Date(t.now()) }).where(eq(users.id, deleted.me.id));
  await t.db.update(users).set({ inRoomBarredAt: new Date(t.now()) }).where(eq(users.id, barred.me.id));
  await t.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.userId, cancelled.me.id));
  await t.db.update(bookings).set({ admitted: 0 }).where(eq(bookings.userId, undone.me.id));

  assert.deepEqual((await ids(a, e)).sort(), [host.member, ok.member].sort());
  // Blocks hide both ways.
  assert.ok(!(await ids(blocked, e)).includes(a.member));
  assert.ok(!(await ids(blocker, e)).includes(a.member));
  // A suspension that has run out shows them again.
  await t.db.update(users).set({ suspendedUntil: new Date(t.now() - 1) }).where(eq(users.id, suspended.me.id));
  assert.ok((await ids(a, e)).includes(suspended.member));

  // The viewer's own access ends with an undone check-in or a cancelled booking.
  for (const u of [undone, cancelled]) {
    const r = await as(u)("GET", room(e));
    assert.equal(r.body.state, "out");
    assert.deepEqual(r.body.members, []);
    assert.equal((await as(u)("POST", `${room(e)}/asks`, { memberId: ok.member })).status, 403);
  }
  // Checked in again, they're back.
  await t.db.update(bookings).set({ admitted: 1 }).where(eq(bookings.userId, undone.me.id));
  assert.equal((await as(undone)("GET", room(e))).body.state, "in");

  // Leaving: back at the door, and joining again clears it.
  assert.equal((await as(left)("GET", room(e))).body.state, "door");
  assert.equal((await as(left)("PUT", `${room(e)}/card`, card("Back again"))).body.state, "in");
  assert.ok((await ids(a, e)).includes(left.member));
});

test("asks: rules, reach only once connected, decline is silent", async () => {
  const owner = await join();
  const e = await meetup(owner), other = await meetup(owner);
  const a = await guest(e), b = await guest(e), c = await guest(e), blocked = await guest(e), x = await guest(other);
  await t.db.update(roomMembers).set({ reach: [{ label: "Phone", value: `+91${b.p}` }, { label: "Email", value: "b@example.com" }] }).where(eq(roomMembers.id, b.member));
  await t.db.insert(userBlocks).values({ blockerId: blocked.me.id, blockedId: a.me.id, createdAt: new Date() });
  const ask = (u: P, memberId: string) => as(u)("POST", `${room(e)}/asks`, { memberId });

  assert.equal((await ask(a, "nope")).status, 400);
  for (const id of [a.member, x.member, blocked.member, crypto.randomUUID()]) {
    const r = await ask(a, id);
    assert.equal(r.status, 404); // self, another room, blocked, unknown: all the same
    assert.equal(r.body.error, "notFound");
  }

  const before = t.notices.length;
  const one = await ask(a, b.member);
  assert.equal(one.status, 201);
  assert.equal(one.body.ask, "asked");
  assert.equal(one.body.reach, undefined);
  const askId = one.body.askId as string;
  assert.deepEqual(t.notices.slice(before).map((n) => [n.kind, (n.to as any).userId]), [["inRoomAsk", b.me.id]]);
  // Again, or from the other side: the same ask.
  const again = await ask(a, b.member);
  assert.equal(again.status, 200);
  assert.equal(again.body.askId, askId);
  const back = await ask(b, a.member);
  assert.equal(back.body.askId, askId);
  assert.equal(back.body.ask, "incoming");
  assert.equal((await t.db.select().from(roomAsks).where(eq(roomAsks.eventId, e.id))).length, 1);
  assert.equal(t.notices.length, before + 1);

  // inRoomAsk: push and inbox, never email.
  const sent = await t.db.select().from(deliveries).where(and(eq(deliveries.userId, b.me.id), eq(deliveries.kind, "inRoomAsk")));
  assert.deepEqual(sent.map((d) => d.channel), ["push"]);
  assert.equal((await t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, b.me.id), eq(inboxItems.kind, "inRoomAsk")))).length, 1);
  await t.deliver();
  assert.ok(!t.mails.some((m) => m.subject === "Someone wants to connect"));

  // Only the one asked answers.
  assert.equal((await as(a)("POST", `${room(e)}/asks/${askId}/accept`)).status, 404);
  assert.equal((await as(c)("POST", `${room(e)}/asks/${askId}/accept`)).status, 404);
  assert.equal((await as(x)("POST", `/me/rooms/${other.id}/asks/${askId}/accept`)).status, 404);
  const yes = await as(b)("POST", `${room(e)}/asks/${askId}/accept`);
  assert.equal(yes.status, 200);
  assert.equal(yes.body.ask, "connected");
  assert.deepEqual(yes.body.reach, card().reach);
  assert.ok(t.notices.some((n) => n.kind === "inRoomConnected" && (n.to as any).userId === a.me.id));
  assert.equal((await as(b)("POST", `${room(e)}/asks/${askId}/decline`)).status, 409);
  // Reach now shows to both, and to nobody else.
  const seen = (await as(a)("GET", room(e))).body.members as any[];
  assert.equal(seen.find((m) => m.id === b.member).reach[0].value, `+91${b.p}`);
  assert.equal(seen.find((m) => m.id === c.member).reach, undefined);
  const cSees = JSON.stringify((await t.call("GET", room(e), undefined, c.access)).body);
  assert.ok(!cSees.includes(b.p) && !cSees.includes("b@example.com"));

  // Declined: the asker still sees "asked", can't ask again, and nobody is told.
  const q = (await ask(c, a.member)).body.askId as string;
  const count = t.notices.length;
  const no = await as(a)("POST", `${room(e)}/asks/${q}/decline`);
  assert.equal(no.body.ask, "declined");
  assert.equal(no.body.reach, undefined);
  const retry = await ask(c, a.member);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.ask, "asked");
  assert.equal(t.notices.length, count);
  assert.equal(((await as(c)("GET", room(e))).body.members as any[]).find((m) => m.id === a.member).ask, "asked");

  // The daily cap: new asks only.
  const d = await guest(e);
  await t.store.incr(`roomAsk:${a.me.id}`, DAY, 30);
  const many = await ask(a, d.member);
  assert.equal(many.status, 429);
  assert.equal(many.body.error, "tooMany");
  assert.equal((await ask(a, b.member)).status, 200); // an existing pair still answers
});

test("leaving drops pending asks; block hides both ways in every room and drops every ask", async () => {
  const owner = await join();
  const e1 = await meetup(owner), e2 = await meetup(owner);
  const a = await guest(e1), b = await guest(e1), c = await guest(e1);
  const a2 = await guest(e2, a), b2 = await guest(e2, b);
  assert.ok(a2.member !== a.member);
  const memberIn = async (u: P, e: E) => (await t.db.select().from(roomMembers).where(and(eq(roomMembers.userId, u.me.id), eq(roomMembers.eventId, e.id))))[0]!.id;
  const [a1m, b1m, a2m, b2m] = [await memberIn(a, e1), await memberIn(b, e1), await memberIn(a, e2), await memberIn(b, e2)];

  await as(c)("POST", `${room(e1)}/asks`, { memberId: a1m });
  assert.equal((await as(c)("DELETE", room(e1))).status, 204);
  assert.equal((await t.db.select().from(roomAsks).where(eq(roomAsks.eventId, e1.id))).length, 0);

  await as(a)("POST", `${room(e1)}/asks`, { memberId: b1m });
  const q2 = (await as(b)("POST", `${room(e2)}/asks`, { memberId: a2m })).body.askId as string;
  await as(a)("POST", `${room(e2)}/asks/${q2}/accept`);
  assert.equal((await as(a)("POST", `${room(e1)}/members/${a1m}/block`)).status, 404); // not themselves
  assert.equal((await as(a)("POST", `${room(e1)}/members/${b2m}/block`)).status, 404); // a card in another room
  assert.equal((await as(a)("POST", `${room(e1)}/members/${b1m}/block`)).status, 204);
  assert.equal((await t.db.select().from(roomAsks).where(or(eq(roomAsks.eventId, e1.id), eq(roomAsks.eventId, e2.id)))).length, 0);
  for (const [u, e, gone] of [[a, e1, b1m], [a, e2, b2m], [b, e1, a1m], [b, e2, a2m]] as const) assert.ok(!(await ids(u, e)).includes(gone));
  assert.equal((await as(b)("POST", `${room(e2)}/asks`, { memberId: a2m })).status, 404);
  assert.equal((await as(b)("POST", `${room(e2)}/members/${a2m}/block`)).status, 404); // already hidden
});

test("a member's photo goes by member id", async () => {
  const owner = await join();
  const e = await meetup(owner);
  const a = await guest(e), b = await guest(e);
  const key = `users/${b.me.id}/${"x".repeat(22)}.webp`;
  await t.media.files.put(key, new Uint8Array([1, 2, 3]), "image/webp");
  await t.db.update(users).set({ photo: `${t.media.url}/${key}` }).where(eq(users.id, b.me.id));
  const m = ((await as(a)("GET", room(e))).body.members as any[]).find((x) => x.id === b.member);
  assert.equal(m.photo, `${t.media.url}/rooms/${b.member}`);
  const res = await t.app.request(`/media/rooms/${b.member}`);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([1, 2, 3]));
  await as(b)("DELETE", room(e));
  assert.equal((await t.app.request(`/media/rooms/${b.member}`)).status, 404);
  assert.equal((await t.app.request(`/media/rooms/${a.member}`)).status, 404); // no photo
});

test("removed can't rejoin, barred can't join", async () => {
  const owner = await join(), staff = await withQueues();
  const e = await meetup(owner), other = await meetup(owner);
  const a = await guest(e), b = await guest(e);
  await book(b, other);
  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${a.member}/remove`, { reason: "Spam links" }, staff.access)).status, 200);
  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${a.member}/remove`, { reason: "Spam links" }, staff.access)).status, 409);
  assert.equal((await as(a)("DELETE", room(e))).status, 204);
  const r = await as(a)("PUT", `${room(e)}/card`, card());
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "removed");
  assert.equal((await as(a)("GET", room(e))).body.state, "removed");

  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${b.member}/bar`, { reason: "Harassment" }, staff.access)).status, 200);
  assert.equal((await as(b)("PUT", `/me/rooms/${other.id}/card`, card())).body.error, "barred");
  assert.equal((await as(b)("GET", room(e))).body.state, "barred");
  assert.equal((await t.call("POST", `/galaxy/rooms/unbar/${b.me.id}`, { reason: "Appeal accepted" }, staff.access)).status, 200);
  assert.equal((await as(b)("PUT", `/me/rooms/${other.id}/card`, card())).body.state, "in");
});

test("Galaxy: Queues only, own host refused, logged, people told", async () => {
  const owner = await join(), plain = await join(), q = await withQueues();
  const e = await meetup(owner);
  const a = await guest(e), b = await guest(e);
  const ownerStaff = await withQueues(owner); // on the host's team

  for (const u of [plain, a]) {
    assert.equal((await t.call("GET", "/galaxy/rooms", undefined, u.access)).status, 404);
    assert.equal((await t.call("GET", `/galaxy/rooms/${e.id}`, undefined, u.access)).status, 404);
    assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${b.member}/remove`, { reason: "Spam links" }, u.access)).status, 404);
    assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${b.member}/bar`, { reason: "Spam links" }, u.access)).status, 404);
    assert.equal((await t.call("POST", `/galaxy/rooms/unbar/${b.me.id}`, { reason: "Spam links" }, u.access)).status, 404);
  }
  // Their own host's room: not listed, not shown, not acted on.
  assert.ok(!(await t.call("GET", "/galaxy/rooms", undefined, ownerStaff.access)).body.rooms.some((r: any) => r.eventId === e.id));
  assert.equal((await t.call("GET", `/galaxy/rooms/${e.id}`, undefined, ownerStaff.access)).status, 404);
  for (const act of ["remove", "bar"]) {
    const r = await t.call("POST", `/galaxy/rooms/${e.id}/members/${b.member}/${act}`, { reason: "Spam links" }, ownerStaff.access);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "ownHost");
  }

  const list = (await t.call("GET", "/galaxy/rooms", undefined, q.access)).body.rooms as any[];
  const row = list.find((r) => r.eventId === e.id);
  assert.equal(row.members, 2);
  assert.equal(row.removed, 0);
  const one = await t.call("GET", `/galaxy/rooms/${e.id}`, undefined, q.access);
  assert.equal(one.status, 200);
  assert.equal(one.body.members.length, 2);
  assert.equal(one.body.members[0].userId, a.me.id);
  assert.equal(one.body.members[0].letIn, true);
  assert.equal((await t.call("GET", `/galaxy/rooms/${crypto.randomUUID()}`, undefined, q.access)).status, 404);
  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${b.member}/remove`, { reason: "x" }, q.access)).status, 400);

  const before = t.notices.length;
  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${a.member}/remove`, { reason: "Spam links" }, q.access)).status, 200);
  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${b.member}/bar`, { reason: "Harassment" }, q.access)).status, 200);
  assert.equal((await t.call("POST", `/galaxy/rooms/${e.id}/members/${b.member}/bar`, { reason: "Harassment" }, q.access)).status, 409);
  assert.equal((await t.call("POST", `/galaxy/rooms/unbar/${q.me.id}`, { reason: "Lifting mine" }, q.access)).body.error, "self");
  assert.equal((await t.call("POST", `/galaxy/rooms/unbar/${b.me.id}`, { reason: "Appeal accepted" }, q.access)).status, 200);
  assert.equal((await t.call("POST", `/galaxy/rooms/unbar/${b.me.id}`, { reason: "Appeal accepted" }, q.access)).status, 409);
  const toPerson = t.notices.slice(before).filter((n) => n.kind !== "staffRiskyAction");
  assert.deepEqual(toPerson.map((n) => [n.kind, (n.to as any).userId]), [["inRoomCardRemoved", a.me.id], ["inRoomBarred", b.me.id]]);
  assert.equal(toPerson[0]!.data!.reason, "Spam links");

  const logged = await t.db.select().from(auditLog).where(eq(auditLog.actorId, q.me.id));
  assert.deepEqual(logged.map((l) => l.action).sort(), ["rooms.bar", "rooms.remove", "rooms.unbar", "rooms.view"]);
  assert.equal(logged.find((l) => l.action === "rooms.remove")!.targetUser, a.me.id);
  assert.equal(logged.find((l) => l.action === "rooms.view")!.targetHost, e.hostId);

  const after = (await t.call("GET", `/galaxy/rooms/${e.id}`, undefined, q.access)).body;
  assert.equal(after.room.members, 1);
  assert.equal(after.room.removed, 1);
  assert.ok(after.members[0].removedAt);
  assert.equal(after.members[0].removedBy, (await t.db.select().from(users).where(eq(users.id, q.me.id)))[0]!.name);
});

test("account deletion clears cards, asks and blocks", async () => {
  const owner = await join();
  const e = await meetup(owner);
  const a = await guest(e), b = await guest(e), c = await guest(e);
  await as(a)("POST", `${room(e)}/asks`, { memberId: b.member });
  await as(c)("POST", `${room(e)}/asks`, { memberId: a.member });
  await as(a)("POST", `${room(e)}/members/${c.member}/block`);
  await t.db.insert(userBlocks).values({ blockerId: b.me.id, blockedId: a.me.id, createdAt: new Date() });
  // c's ask went with the block; a's ask to b stays until the deletion.
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now() - DAY), deletionDueAt: new Date(t.now() - 1) }).where(eq(users.id, a.me.id));
  await runDeletions(t.db, t.notify, t.now());
  assert.equal((await t.db.select().from(roomMembers).where(eq(roomMembers.userId, a.me.id))).length, 0);
  assert.equal((await t.db.select().from(roomAsks).where(or(eq(roomAsks.fromMember, a.member), eq(roomAsks.toMember, a.member)))).length, 0);
  assert.equal((await t.db.select().from(userBlocks).where(or(eq(userBlocks.blockerId, a.me.id), eq(userBlocks.blockedId, a.me.id)))).length, 0);
  assert.deepEqual(await ids(b, e), [c.member]);
});
