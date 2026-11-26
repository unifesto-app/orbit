import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import type { DoorGuests, ScanResult, Ticket } from "@orbit/contract";
import { testApp } from "./testkit.ts";
import { auditLog, bookings, staffGrants, teamRoles } from "./db/schema.ts";

// Check-in at the door (X5): scan, admit, undo, the guest list, and Galaxy's view and undo.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(7_000_000 + ++n * 17).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

const join = async (name = "Riya Kapoor") => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name, dob: "2000-05-01", device });
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
const poster = async (u: P, id: string) => {
  const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer();
  const form = new FormData();
  form.set("image", new File([png as BlobPart], "p.png", { type: "image/png" }));
  const res = await t.app.request(`/events/${id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  assert.equal(res.status, 200);
};

// A host (owned by `a`) and a published free event on it.
let hn = 0;
const newHost = async (a: P) => (await as(a)("POST", "/hosts", { name: `Door Club ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body.id as string;
const publish = async (a: P, hostId: string, o: { startsIn?: number; endsIn?: number } = {}) => {
  const e = (await as(a)("POST", `/hosts/${hostId}/events`, { title: "Open Mic Night" })).body as { id: string };
  await poster(a, e.id);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(o.startsIn ?? HOUR), endsAt: iso(o.endsIn ?? 3 * HOUR), place })).status, 200);
  const tier = (await as(a)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 })).body.id as string;
  assert.equal((await as(a)("POST", `/events/${e.id}/publish`)).status, 200);
  return { id: e.id, hostId, tier };
};
type E = Awaited<ReturnType<typeof publish>>;
const book = async (u: P, e: E, quantity = 1) => {
  const r = await as(u)("POST", `/events/${e.id}/book`, { ticketTypeId: e.tier, quantity });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as Ticket;
};
const crewOn = async (a: P, hostId: string) => {
  const c = await join("Kabir Singh");
  const at = new Date(t.now());
  await t.db.insert(teamRoles).values({ hostId, role: "crew", contact: `+91${c.p}`, userId: c.me.id, addedBy: a.me.id, addedAt: at, acceptedAt: at, startedAt: at });
  return c;
};
const scan = (u: P, e: E, text: string) => as(u)("POST", `/hosts/${e.hostId}/check-in/scan`, { eventId: e.id, text });
const admit = (u: P, e: E, id: string, total: number) => as(u)("POST", `/hosts/${e.hostId}/check-in/${id}/admit`, { total });
const undo = (u: P, e: E, id: string, total: number) => as(u)("POST", `/hosts/${e.hostId}/check-in/${id}/undo`, { total });
const row = async (id: string) => (await t.db.select().from(bookings).where(eq(bookings.id, id)))[0]!;

test("a ticket for one is in at the scan; the second scan says already, when and who", async () => {
  const a = await join("Asha Rao"), g = await join("Meera Pillai");
  const e = await publish(a, await newHost(a));
  const crew = await crewOn(a, e.hostId);
  const tk = await book(g, e);
  const r = await scan(crew, e, tk.qr!);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body as ScanResult;
  assert.equal(s.result, "in");
  assert.ok(s.result === "in" && s.guest.name === "Meera Pillai" && s.guest.admitted === 1 && s.guest.checkedInAt);
  const b = await row(tk.id);
  assert.equal(b.checkedInBy, crew.me.id);
  // The code works too, with spaces, dashes and lower case.
  const code = `${tk.code!.slice(0, 4).toLowerCase()}-${tk.code!.slice(4)} `;
  const again = (await scan(a, e, code)).body as ScanResult;
  assert.equal(again.result, "already");
  assert.ok(again.result === "already" && again.by === "Kabir" && again.guest.checkedInAt === b.checkedInAt!.toISOString());
  // The holder's ticket shows it.
  const mine = (await as(g)("GET", `/me/tickets/${tk.id}`)).body as Ticket;
  assert.equal(mine.admitted, 1);
  assert.equal(mine.checkedInAt, b.checkedInAt!.toISOString());
});

test("a group ticket asks; admit counts up, the same total twice changes nothing, never down, never past it", async () => {
  const a = await join(), g = await join();
  const e = await publish(a, await newHost(a));
  const tk = await book(g, e, 4);
  const s = (await scan(a, e, tk.qr!)).body as ScanResult;
  assert.equal(s.result, "ask");
  assert.ok(s.result === "ask" && s.guest.quantity === 4 && s.guest.admitted === 0 && s.guest.id === tk.id);
  assert.equal((await row(tk.id)).admitted, 0); // asking admits nobody
  const first = await admit(a, e, tk.id, 2);
  assert.equal(first.status, 200);
  assert.equal(first.body.admitted, 2);
  const when = (await row(tk.id)).checkedInAt!.toISOString();
  t.tick(60_000);
  assert.equal((await admit(a, e, tk.id, 2)).body.admitted, 2);
  assert.equal((await admit(a, e, tk.id, 1)).body.admitted, 2); // never lowers
  assert.equal((await row(tk.id)).checkedInAt!.toISOString(), when); // the first time stays
  assert.equal((await admit(a, e, tk.id, 9)).body.admitted, 4); // never past the ticket
  assert.equal(((await scan(a, e, tk.qr!)).body as ScanResult).result, "already");
  assert.equal((await admit(a, e, tk.id, 11)).status, 400);
});

test("two phones at once never count past the ticket", async () => {
  const a = await join(), g = await join(), h = await join();
  const e = await publish(a, await newHost(a));
  const crew = await crewOn(a, e.hostId);
  const group = await book(g, e, 3);
  const rs = await Promise.all([admit(a, e, group.id, 3), admit(crew, e, group.id, 3), admit(a, e, group.id, 2)]);
  for (const r of rs) assert.equal(r.status, 200);
  assert.equal((await row(group.id)).admitted, 3);
  const one = await book(h, e);
  const [x, y] = await Promise.all([scan(a, e, one.qr!), scan(crew, e, one.qr!)]);
  assert.deepEqual([x.body.result, y.body.result].sort(), ["already", "in"]);
  assert.equal((await row(one.id)).admitted, 1);
});

test("undo lowers only; at 0 nobody's in and when and who go", async () => {
  const a = await join(), g = await join();
  const e = await publish(a, await newHost(a));
  const tk = await book(g, e, 3);
  await admit(a, e, tk.id, 3);
  assert.equal((await undo(a, e, tk.id, 5)).body.admitted, 3); // never raises
  assert.equal((await undo(a, e, tk.id, 1)).body.admitted, 1);
  assert.ok((await row(tk.id)).checkedInAt);
  const zero = await undo(a, e, tk.id, 0);
  assert.equal(zero.body.admitted, 0);
  assert.equal(zero.body.checkedInAt, null);
  const b = await row(tk.id);
  assert.equal(b.checkedInAt, null);
  assert.equal(b.checkedInBy, null);
});

test("refusals name nobody: unknown, another event, another host, cancelled, early, ended", async () => {
  const a = await join(), g = await join("Secret Person"), o = await join();
  const hostId = await newHost(a);
  const e = await publish(a, hostId);
  const other = await publish(a, hostId);
  const elsewhere = await publish(o, await newHost(o));
  const leak = (r: { status: number; body: unknown }, result: string) => {
    assert.equal(r.status, 200);
    assert.equal((r.body as ScanResult).result, result);
    assert.ok(!JSON.stringify(r.body).includes("Secret"), JSON.stringify(r.body));
    assert.ok(!("guest" in (r.body as object)));
  };
  leak(await scan(a, e, "ZZZZZZZZ"), "unknown");
  leak(await scan(a, e, "nonsense"), "unknown");
  leak(await scan(a, e, "x".repeat(32)), "unknown");
  leak(await scan(a, e, (await book(g, other)).qr!), "wrongEvent");
  const theirs = await book(g, elsewhere);
  leak(await scan(a, e, theirs.qr!), "unknown"); // another host's ticket is no ticket here
  assert.equal((await admit(a, e, theirs.id, 1)).status, 404);
  const gone = await book(g, e);
  assert.equal((await as(g)("POST", `/me/tickets/${gone.id}/cancel`)).status, 200);
  leak(await scan(a, e, gone.qr!), "cancelled");
  assert.equal((await admit(a, e, gone.id, 1)).body.error, "cancelled");

  const later = await publish(a, hostId, { startsIn: 3 * DAY, endsIn: 3 * DAY + 2 * HOUR });
  const early = await book(g, later);
  leak(await scan(a, later, early.qr!), "early");
  assert.equal((await admit(a, later, early.id, 1)).body.error, "early");

  const soon = await publish(a, hostId, { startsIn: HOUR, endsIn: 2 * HOUR });
  const done = await book(g, soon);
  t.tick(5 * HOUR + 60_000);
  leak(await scan(a, soon, done.qr!), "ended");
  assert.equal((await admit(a, soon, done.id, 1)).status, 409);
});

test("only a started seat on the host: anyone else is a 404", async () => {
  const a = await join(), g = await join(), stranger = await join();
  const e = await publish(a, await newHost(a));
  const tk = await book(g, e);
  assert.equal((await scan(stranger, e, tk.qr!)).status, 404);
  assert.equal((await scan(g, e, tk.qr!)).status, 404);
  assert.equal((await admit(stranger, e, tk.id, 1)).status, 404);
  assert.equal((await as(stranger)("GET", `/hosts/${e.hostId}/events/${e.id}/guests`)).status, 404);
  // A crew seat that ended is no seat.
  const crew = await crewOn(a, e.hostId);
  await t.db.update(teamRoles).set({ endedAt: new Date(t.now()), endReason: "removed" }).where(and(eq(teamRoles.hostId, e.hostId), eq(teamRoles.userId, crew.me.id)));
  assert.equal((await scan(crew, e, tk.qr!)).status, 404);
  assert.equal((await row(tk.id)).admitted, 0);
});

test("guests: the list with counts, and search by name, phone, email or code", async () => {
  const a = await join(), g = await join("Zoya Akhtar"), h = await join("Imran Khan");
  const e = await publish(a, await newHost(a));
  const crew = await crewOn(a, e.hostId);
  const zt = await book(g, e, 2);
  const it = await book(h, e);
  await admit(crew, e, zt.id, 1);
  const list = (q = "") => as(crew)("GET", `/hosts/${e.hostId}/events/${e.id}/guests${q}`);
  const all = (await list()).body as DoorGuests;
  assert.deepEqual([all.booked, all.in], [3, 1]);
  assert.deepEqual(all.guests.map((x) => x.name), ["Imran Khan", "Zoya Akhtar"]);
  assert.ok(!JSON.stringify(all).includes(h.p)); // no contacts
  assert.deepEqual(((await list("?q=zoya")).body as DoorGuests).guests.map((x) => x.id), [zt.id]);
  assert.deepEqual(((await list(`?q=${h.p.slice(-6)}`)).body as DoorGuests).guests.map((x) => x.id), [it.id]);
  assert.deepEqual(((await list(`?q=${it.code!.toLowerCase()}`)).body as DoorGuests).guests.map((x) => x.id), [it.id]);
  assert.equal(((await list("?q=%25%25")).body as DoorGuests).guests.length, 0); // a wildcard is a character
  assert.equal((await list("?q=z")).status, 400);
});

test("Galaxy: open doors with counts, who's in, and an undo that's logged; never on their own host", async () => {
  const a = await join(), g = await join("Nina Gupta");
  const e = await publish(a, await newHost(a));
  const tk = await book(g, e, 2);
  await admit(a, e, tk.id, 2);
  const st = await join();
  await t.db.insert(staffGrants).values({ userId: st.me.id, feature: "hosts", addedBy: st.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  assert.equal((await as(g)("GET", "/galaxy/check-in")).status, 404); // without Hosts, Galaxy isn't there
  const list = (await as(st)("GET", "/galaxy/check-in")).body;
  const mine = list.events.find((x: { id: string }) => x.id === e.id);
  assert.equal(mine.booked, 2);
  assert.equal(mine.in, 2);
  const page = (await as(st)("GET", `/galaxy/check-in/${e.id}`)).body;
  assert.equal(page.guests.length, 1);
  assert.equal(page.guests[0].name, "Nina Gupta");
  assert.equal((await as(st)("POST", `/galaxy/check-in/${tk.id}/undo`, { total: 0 })).status, 400); // a reason is needed
  const r = await as(st)("POST", `/galaxy/check-in/${tk.id}/undo`, { total: 0, reason: "Scanned by mistake" });
  assert.equal(r.status, 200);
  assert.equal(r.body.admitted, 0);
  const [log] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "checkin.undo"), eq(auditLog.actorId, st.me.id)));
  assert.deepEqual(log!.data, { bookingId: tk.id, from: 2, to: 0 });
  assert.equal(log!.targetHost, e.hostId);
  assert.ok(t.notices.some((x) => x.kind === "staffRiskyAction" && x.data?.action === "checkin.undo"));
  assert.equal((await as(st)("GET", `/galaxy/check-in/${e.id}`)).body.guests.length, 0);
  // Staff on the host's team can't act on it.
  const at = new Date(t.now());
  await t.db.insert(teamRoles).values({ hostId: e.hostId, role: "crew", contact: `+91${st.p}`, userId: st.me.id, addedBy: a.me.id, addedAt: at, acceptedAt: at, startedAt: at });
  await admit(a, e, tk.id, 1);
  assert.equal((await as(st)("POST", `/galaxy/check-in/${tk.id}/undo`, { total: 0, reason: "Scanned by mistake" })).status, 403);
  assert.equal((await row(tk.id)).admitted, 1);
});
