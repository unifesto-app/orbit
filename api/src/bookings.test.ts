import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { CODE_ALPHABET, type MyTickets, type Ticket } from "@orbit/contract";
import { testApp } from "./testkit.ts";
import { bookings, events, hosts, ticketTypes, users } from "./db/schema.ts";
import { runDeletions } from "./auth/deletion.ts";

// Free registration and tickets (Booking and tickets doc; P10.1, P12.1, P12.2).

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(6_000_000 + ++n * 13).padStart(9, "0")}`;
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
const start = async (u: P) => (await as(u)("POST", "/hosts", { name: `Jam Circle ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string; slug: string };
const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
const png = () => sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer();
const poster = async (u: P, id: string) => {
  const form = new FormData();
  form.set("image", new File([(await png()) as BlobPart], "p.png", { type: "image/png" }));
  const res = await t.app.request(`/events/${id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  assert.equal(res.status, 200);
};

// A published event with one ticket type (more with `more`), online too so it has a link; answers its tier ids.
const SECRET = "https://meet.example.com/secret-room";
const hostOf = new Map<string, { id: string }>(); // one host each: a person may only start a few
const publish = async (u: P, tier: object = {}, o: { startsIn?: number; endsIn?: number; more?: object[]; own?: boolean; noLink?: boolean } = {}) => {
  const h = o.own ? await start(u) : (hostOf.get(u.me.id) ?? hostOf.set(u.me.id, await start(u)).get(u.me.id)!);
  const e = (await as(u)("POST", `/hosts/${h.id}/events`, { title: "Open Mic Night" })).body as { id: string; slug: string };
  await poster(u, e.id);
  const set = await as(u)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(o.startsIn ?? DAY), endsAt: iso(o.endsIn ?? DAY + 2 * HOUR), place, ...(o.noLink ? {} : { online: true, onlineLink: SECRET }) });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const tiers: string[] = [];
  for (const body of [{ name: "General", pricePaise: 0, ...tier }, ...(o.more ?? [])]) {
    const r = await as(u)("POST", `/events/${e.id}/tickets`, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    tiers.push(r.body.id);
  }
  const p = await as(u)("POST", `/events/${e.id}/publish`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return { ...e, hostId: h.id, tiers };
};
type E = Awaited<ReturnType<typeof publish>>;
const book = (u: P, e: E, quantity = 1, tier = e.tiers[0]) => as(u)("POST", `/events/${e.id}/book`, { ticketTypeId: tier, quantity });
const mine = async (u: P) => (await as(u)("GET", "/me/tickets")).body as MyTickets;
const left = async (e: E, i = 0) => (await t.call("GET", `/public/events/${e.slug}`)).body.tiers[i].left as number | null;

test("book a free ticket: 201 with the ticket, tokens shaped as the doc says, source kept", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, { quantity: 50 });
  const r = await book(b, e, 2);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const tk = r.body as Ticket;
  assert.equal(tk.status, "confirmed");
  assert.equal(tk.quantity, 2);
  assert.deepEqual(tk.ticketType, { id: e.tiers[0], name: "General", pricePaise: 0 });
  assert.equal(tk.event.id, e.id);
  assert.equal(tk.qr!.length, 32);
  assert.equal(tk.link!.length, 32);
  assert.match(tk.qr!, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(tk.code!.length, 8);
  for (const ch of tk.code!) assert.ok(CODE_ALPHABET.includes(ch), ch);
  assert.notEqual(tk.qr, tk.link);
  assert.equal(tk.cancelledAt, null);
  const [row] = await t.db.select().from(bookings).where(eq(bookings.id, tk.id));
  assert.equal(row!.source, "orbit");
  // A client can't set its own source (d16): whatever it sends, the booking is Orbit's.
  const other = await publish(a);
  const claimed = await as(b)("POST", `/events/${other.id}/book`, { ticketTypeId: other.tiers[0], quantity: 1, source: "host" });
  assert.equal(claimed.status, 201);
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.id, claimed.body.id)))[0]!.source, "orbit");
  assert.equal(await left(e), 48);
  // Not signed in: no booking.
  assert.equal((await t.call("POST", `/events/${e.id}/book`, { ticketTypeId: e.tiers[0], quantity: 1 })).status, 401);
});

test("quantity: 1 up to the type's per-person limit and never 0 or over 10", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, { perPersonLimit: 3 });
  assert.equal((await book(b, e, 0)).status, 400);
  assert.equal((await book(b, e, 11)).status, 400);
  const over = await book(b, e, 4);
  assert.equal(over.status, 409);
  assert.equal(over.body.error, "tooMany");
  assert.equal((await book(b, e, 3)).status, 201);
  const e10 = await publish(a);
  assert.equal((await book(b, e10, 10)).status, 201);
});

test("one live booking per type; another type of the same event is a second booking", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, {}, { more: [{ name: "Front row", pricePaise: 0 }] });
  assert.equal((await book(b, e)).status, 201);
  const again = await book(b, e);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "booked");
  assert.equal(again.body.message, "You already have a ticket for this.");
  assert.equal((await book(b, e, 1, e.tiers[1])).status, 201);
  assert.equal((await mine(b)).upcoming.length, 2);
});

test("never oversold: two people at once for the last seat, one gets it", async () => {
  const a = await join(), b = await join(), c = await join();
  const e = await publish(a, { quantity: 1 });
  const [x, y] = await Promise.all([book(b, e), book(c, e)]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  const lost = x.status === 409 ? x : y;
  assert.equal(lost.body.error, "fewLeft");
  assert.equal(lost.body.message, "Sold out");
  assert.equal(await left(e), 0);
});

test("fewer left than asked says how many; none left is Sold out", async () => {
  const a = await join(), b = await join(), c = await join();
  const e = await publish(a, { quantity: 3 });
  assert.equal((await book(b, e, 2)).status, 201);
  const few = await book(c, e, 2);
  assert.equal(few.status, 409);
  assert.equal(few.body.message, "Only 1 left");
  assert.equal(few.body.left, 1);
  assert.equal((await book(c, e, 1)).status, 201);
  const out = await book(await join(), e, 1);
  assert.equal(out.body.message, "Sold out");
});

test("the sales window: before it opens and after it closes", async () => {
  const a = await join(), b = await join();
  const early = await publish(a, { salesStartAt: iso(HOUR) });
  const r = await book(b, early);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "notOpen");
  assert.match(r.body.message, /^Booking opens /);
  t.tick(HOUR);
  assert.equal((await book(b, early)).status, 201);
  const late = await publish(a, { salesEndAt: iso(HOUR) });
  t.tick(HOUR);
  const closed = await book(b, late);
  assert.equal(closed.status, 409);
  assert.equal(closed.body.message, "Booking has closed");
});

test("refused: cancelled, ended, draft, off-the-air host, unknown tier, a paid tier", async () => {
  const a = await join(), b = await join();
  const gone = await publish(a);
  assert.equal((await as(a)("POST", `/events/${gone.id}/cancel`, { reason: "Rain" })).status, 200);
  assert.equal((await book(b, gone)).body.error, "cancelled");

  const ended = await publish(a, {}, { startsIn: HOUR, endsIn: 2 * HOUR });
  t.tick(2 * HOUR);
  const r = await book(b, ended);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "ended");

  const h = await start(a);
  const d = (await as(a)("POST", `/hosts/${h.id}/events`, { title: "Draft" })).body;
  const dt = (await as(a)("POST", `/events/${d.id}/tickets`, { name: "General", pricePaise: 0 })).body;
  assert.equal((await as(b)("POST", `/events/${d.id}/book`, { ticketTypeId: dt.id, quantity: 1 })).status, 404);

  const paused = await publish(a, {}, { own: true });
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, paused.hostId));
  assert.equal((await book(b, paused)).status, 404);

  const other = await publish(a);
  assert.equal((await book(b, other, 1, gone.tiers[0])).status, 404); // another event's tier
  assert.equal((await as(b)("POST", "/events/not-a-uuid/book", { ticketTypeId: other.tiers[0], quantity: 1 })).status, 404);

  const paid = await publish(a, { pricePaise: 29900 });
  const p = await book(b, paid);
  assert.equal(p.status, 409);
  assert.equal(p.body.error, "paidLater");
  assert.equal(p.body.message, "Paying in the app is coming soon.");
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.userId, b.me.id))).length, 0);
});

test("upcoming soonest first until the end time; past newest first with cancelled ones", async () => {
  const a = await join(), b = await join();
  const later = await publish(a, {}, { startsIn: 3 * DAY, endsIn: 3 * DAY + HOUR });
  const soon = await publish(a, {}, { startsIn: HOUR, endsIn: 2 * HOUR });
  const dropped = await publish(a, {}, { startsIn: 2 * DAY, endsIn: 2 * DAY + HOUR });
  for (const e of [later, soon, dropped]) assert.equal((await book(b, e)).status, 201);
  const d = (await mine(b)).upcoming.find((x) => x.event.id === dropped.id)!;
  assert.equal((await as(b)("POST", `/me/tickets/${d.id}/cancel`)).status, 200);
  let m = await mine(b);
  assert.deepEqual(m.upcoming.map((x) => x.event.id), [soon.id, later.id]);
  assert.deepEqual(m.past.map((x) => [x.event.id, x.status]), [[dropped.id, "cancelled"]]);
  // On now still counts as upcoming; at the end time it's past.
  t.tick(HOUR + 1);
  assert.deepEqual((await mine(b)).upcoming.map((x) => x.event.id), [soon.id, later.id]);
  t.tick(HOUR - 1);
  m = await mine(b);
  assert.deepEqual(m.upcoming.map((x) => x.event.id), [later.id]);
  assert.deepEqual(m.past.map((x) => x.event.id), [dropped.id, soon.id]); // newest event first
  assert.equal(m.past[0]!.qr, null);
  assert.equal(m.past[0]!.code, null);
  assert.equal(m.past[0]!.link, null);
  assert.ok(m.past[1]!.qr); // an ended, confirmed booking keeps its tokens
});

test("cancel before the start frees the seat, and they can book again; after the start it's refused", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, { quantity: 5 }, { startsIn: HOUR, endsIn: 3 * HOUR });
  const tk = (await book(b, e, 2)).body as Ticket;
  assert.equal(await left(e), 3);
  const c = await as(b)("POST", `/me/tickets/${tk.id}/cancel`);
  assert.equal(c.status, 200);
  assert.equal(c.body.status, "cancelled");
  assert.ok(c.body.cancelledAt);
  assert.equal(c.body.link, null);
  assert.equal(c.body.onlineLink, null);
  assert.equal(await left(e), 5);
  assert.equal((await as(b)("POST", `/me/tickets/${tk.id}/cancel`)).body.error, "notNow");
  const again = (await book(b, e, 1)).body as Ticket;
  assert.notEqual(again.id, tk.id);
  t.tick(HOUR);
  const late = await as(b)("POST", `/me/tickets/${again.id}/cancel`);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "started");
});

test("a paid booking can't be cancelled here", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const tk = (await book(b, e)).body as Ticket;
  // None exist yet: made by hand.
  await t.db.update(ticketTypes).set({ pricePaise: 29900 }).where(eq(ticketTypes.id, e.tiers[0]!));
  const r = await as(b)("POST", `/me/tickets/${tk.id}/cancel`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "notFree");
});

test("only the holder reads or cancels a ticket; the online link only on your own confirmed one, never public", async () => {
  const a = await join(), b = await join(), c = await join();
  const e = await publish(a);
  const tk = (await book(b, e)).body as Ticket;
  assert.equal(tk.onlineLink, SECRET);
  const read = await as(b)("GET", `/me/tickets/${tk.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.onlineLink, SECRET);
  assert.equal(read.body.code, tk.code);
  assert.equal((await as(c)("GET", `/me/tickets/${tk.id}`)).status, 404);
  assert.equal((await as(c)("POST", `/me/tickets/${tk.id}/cancel`)).status, 404);
  assert.equal((await as(b)("GET", "/me/tickets/nope")).status, 404);
  assert.deepEqual(await mine(c), { upcoming: [], past: [] });
  for (const path of [`/public/events/${e.slug}`, "/public/discover", "/public/search?q=open"]) {
    const body = JSON.stringify((await t.call("GET", path)).body);
    assert.ok(!body.includes(SECRET), path);
    assert.ok(!body.includes(tk.qr!) && !body.includes(tk.code!), path);
  }
});

test("a host's cancel cancels the free bookings with it", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, { quantity: 10 });
  const tk = (await book(b, e, 2)).body as Ticket;
  assert.equal((await as(a)("POST", `/events/${e.id}/cancel`, { reason: "Venue flooded" })).status, 200);
  const r = (await as(b)("GET", `/me/tickets/${tk.id}`)).body as Ticket;
  assert.equal(r.status, "cancelledByHost");
  assert.equal(r.qr, null);
  assert.equal(r.onlineLink, null);
  assert.equal(r.event.status, "cancelled");
  const m = await mine(b);
  assert.equal(m.upcoming.length, 0);
  assert.equal(m.past[0]!.status, "cancelledByHost");
});

test("a ticket type with bookings: price locked, quantity not below taken, can't be deleted", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, { quantity: 10 }, { more: [{ name: "Spare", pricePaise: 0 }] });
  const tid = e.tiers[0];
  // No bookings yet: free to change.
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${tid}`, { quantity: 8 })).status, 200);
  const tk = (await book(b, e, 3)).body as Ticket;
  const price = await as(a)("PATCH", `/events/${e.id}/tickets/${tid}`, { pricePaise: 9900 });
  assert.equal(price.status, 409);
  assert.equal(price.body.error, "hasBookings");
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${tid}`, { pricePaise: 0, name: "Entry" })).status, 200); // same price passes
  const low = await as(a)("PATCH", `/events/${e.id}/tickets/${tid}`, { quantity: 2 });
  assert.equal(low.status, 409);
  assert.equal(low.body.error, "belowTaken");
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${tid}`, { quantity: 3 })).status, 200);
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${tid}`, { quantity: null })).status, 200);
  const del = await as(a)("DELETE", `/events/${e.id}/tickets/${tid}`);
  assert.equal(del.status, 409);
  assert.equal(del.body.error, "hasBookings");
  // Cancelled, the price frees again but the type still can't go: its bookings keep it.
  assert.equal((await as(b)("POST", `/me/tickets/${tk.id}/cancel`)).status, 200);
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${tid}`, { pricePaise: 9900 })).status, 200);
  assert.equal((await as(a)("DELETE", `/events/${e.id}/tickets/${tid}`)).body.error, "hasBookings");
  assert.equal((await as(a)("DELETE", `/events/${e.id}/tickets/${e.tiers[1]}`)).status, 204);
});

test("TierCard.left counts confirmed bookings; null with no limit", async () => {
  const a = await join(), b = await join(), c = await join();
  const e = await publish(a, { quantity: 20 }, { more: [{ name: "Open", pricePaise: 0 }] });
  await book(b, e, 4);
  await book(c, e, 1);
  await book(c, e, 2, e.tiers[1]);
  assert.equal(await left(e, 0), 15);
  assert.equal(await left(e, 1), null);
  const near = (await t.call("GET", "/public/discover")).body;
  const card = [...near.near, ...near.elsewhere].find((x: { id: string }) => x.id === e.id);
  assert.equal(card.tiers[0].left, 15);
});

test("deleting the account cancels upcoming bookings and keeps past ones", async () => {
  const a = await join(), b = await join();
  const past = await publish(a, {}, { startsIn: HOUR, endsIn: 2 * HOUR });
  const next = await publish(a, { quantity: 5 }, { startsIn: 5 * DAY, endsIn: 5 * DAY + HOUR });
  const old = (await book(b, past)).body as Ticket;
  const soon = (await book(b, next, 2)).body as Ticket;
  t.tick(3 * HOUR);
  await t.db.update(users).set({ deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, b.me.id));
  assert.equal(await runDeletions(t.db, async () => {}, t.now()), 1);
  const rows = new Map((await t.db.select().from(bookings).where(eq(bookings.userId, b.me.id))).map((r) => [r.id, r]));
  assert.equal(rows.get(old.id)!.status, "confirmed");
  assert.equal(rows.get(soon.id)!.status, "cancelled");
  assert.equal(rows.get(soon.id)!.link, null);
  assert.equal(await left(next), 5);
});

test("a ticket's event is drawn even once its host is off the air", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  const tk = (await book(b, e)).body as Ticket;
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, e.hostId));
  const r = await as(b)("GET", `/me/tickets/${tk.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.event.id, e.id);
  assert.ok((await t.db.select().from(events).where(eq(events.id, e.id))).length);
});

test("the same person tapping twice at once: one 201, one 409 booked, never a 500", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, { quantity: 10 });
  const both = await Promise.all([book(b, e), book(b, e)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);
  assert.equal(both.find((r) => r.status === 409)!.body.error, "booked");
  assert.equal(await left(e), 9);
});

test("a host cutting the quantity while a booking lands never ends below the seats taken", async () => {
  const a = await join(), b = await join();
  for (let i = 0; i < 5; i++) {
    const e = await publish(a, { quantity: 5 });
    const [bk, cut] = await Promise.all([book(b, e, 3), as(a)("PATCH", `/events/${e.id}/tickets/${e.tiers[0]}`, { quantity: 2 })]);
    // Either the booking went first and the cut was refused, or the cut went first and the booking was.
    if (bk.status === 201) assert.equal(cut.body.error, "belowTaken");
    else assert.deepEqual([cut.status, bk.body.error], [200, "fewLeft"]);
    const tier = (await t.call("GET", `/public/events/${e.slug}`)).body.tiers[0];
    assert.ok(tier.left >= 0, JSON.stringify(tier));
  }
});

test("seats cancelled by the host don't count in left", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, { quantity: 10 });
  await book(b, e, 4);
  assert.equal(await left(e), 6);
  assert.equal((await as(a)("POST", `/events/${e.id}/cancel`, { reason: "Rain" })).status, 200);
  assert.equal(await left(e), 10);
});

test("onlineLink is null on an event with no online link", async () => {
  const a = await join(), b = await join();
  const e = await publish(a, {}, { noLink: true });
  const tk = (await book(b, e)).body as Ticket;
  assert.equal(tk.onlineLink, null);
  assert.equal((await as(b)("GET", `/me/tickets/${tk.id}`)).body.onlineLink, null);
});

test("a deleted account can't book: signed out", async () => {
  const a = await join(), b = await join();
  const e = await publish(a);
  await t.db.update(users).set({ deletedAt: new Date(t.now()) }).where(eq(users.id, b.me.id));
  const r = await book(b, e);
  assert.equal(r.status, 401);
  assert.equal((await t.db.select().from(bookings).where(eq(bookings.userId, b.me.id))).length, 0);
});
