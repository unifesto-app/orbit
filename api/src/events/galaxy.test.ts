import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "../testkit.ts";
import { auditLog, bookings, staffGrants } from "../db/schema.ts";

// Galaxy's Events (X1): the list, one event, unpublish and cancel; and the host's fee plan.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(7_000_000 + ++n * 11).padStart(9, "0")}`;
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
const staff = async () => {
  const s = await join();
  await t.db.insert(staffGrants).values({ userId: s.me.id, feature: "hosts", addedBy: s.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return s;
};
let hn = 0;
const start = async (u: P) => (await as(u)("POST", "/hosts", { name: `Punchline ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
// Typed by hand, as Event Partner sends it: no coordinates.
const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad" };

// A published event with one free ticket type.
const publish = async (u: P, hostId: string) => {
  const e = (await as(u)("POST", `/hosts/${hostId}/events`, { title: "Open Mic Night" })).body as { id: string; slug: string };
  const form = new FormData();
  form.set("image", new File([(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer()) as BlobPart], "p.png", { type: "image/png" }));
  const up = await t.app.request(`/events/${e.id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  assert.equal(up.status, 200);
  const set = await as(u)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(DAY), endsAt: iso(DAY + 2 * HOUR), place });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.place.lat, null);
  const tier = await as(u)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 });
  assert.equal((await as(u)("POST", `/events/${e.id}/publish`)).status, 200);
  return { ...e, tier: tier.body.id as string };
};
const R = { reason: "Checked with the host" };

test("Galaxy's event routes are for holders of Hosts only", async () => {
  const a = await join(), nobody = await join();
  const e = await publish(a, (await start(a)).id);
  for (const [m, path, body] of [
    ["GET", "/galaxy/events"],
    ["GET", `/galaxy/events/${e.id}`],
    ["POST", `/galaxy/events/${e.id}/unpublish`, R],
    ["POST", `/galaxy/events/${e.id}/cancel`, R],
  ] as [string, string, unknown?][]) {
    assert.equal((await as(nobody)(m, path, body)).status, 404, path);
    assert.equal((await as(a)(m, path, body)).status, 404, path); // the host's own Admin isn't staff
    assert.equal((await t.call(m, path, body)).status, 401, path);
  }
});

test("the list filters by status and host, newest first; one event comes with its tickets and counts", async () => {
  const a = await join(), st = await staff();
  const h = await start(a);
  const e = await publish(a, h.id);
  t.tick(1000);
  const d = (await as(a)("POST", `/hosts/${h.id}/events`, { title: "Later draft" })).body;
  const all = await as(st)("GET", `/galaxy/events?host=${h.id}`);
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.events.map((x: any) => x.id), [d.id, e.id]);
  assert.equal(all.body.total, 2);
  assert.equal(all.body.events[1].host.id, h.id);
  assert.deepEqual((await as(st)("GET", `/galaxy/events?host=${h.id}&status=draft`)).body.events.map((x: any) => x.id), [d.id]);
  assert.equal((await as(st)("GET", "/galaxy/events?status=bogus")).status, 400);
  assert.equal((await as(st)("GET", "/galaxy/events?host=nope")).status, 400);

  const one = await as(st)("GET", `/galaxy/events/${e.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.event.slug, e.slug);
  assert.equal(one.body.tickets.length, 1);
  assert.equal(one.body.tickets[0].sold, 0);
  assert.equal(one.body.bookings, 0);
  assert.equal((await as(st)("GET", "/galaxy/events/not-a-uuid")).status, 404);
});

test("unpublish is refused once anyone has booked, and goes back to draft otherwise, logged", async () => {
  const a = await join(), b = await join(), st = await staff();
  const h = await start(a);
  const booked = await publish(a, h.id);
  assert.equal((await as(b)("POST", `/events/${booked.id}/book`, { ticketTypeId: booked.tier, quantity: 1 })).status, 201);
  const no = await as(st)("POST", `/galaxy/events/${booked.id}/unpublish`, R);
  assert.equal(no.status, 409);
  assert.equal(no.body.error, "hasBookings");
  assert.equal((await as(st)("GET", `/galaxy/events/${booked.id}`)).body.tickets[0].sold, 1);
  // A cancelled booking still counts: its holder had a ticket to a live event.
  await t.db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.eventId, booked.id));
  assert.equal((await as(st)("POST", `/galaxy/events/${booked.id}/unpublish`, R)).status, 409);

  const e = await publish(a, h.id);
  assert.equal((await as(st)("POST", `/galaxy/events/${e.id}/unpublish`, {})).status, 400);
  const ok = await as(st)("POST", `/galaxy/events/${e.id}/unpublish`, R);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, "draft");
  assert.equal((await as(st)("POST", `/galaxy/events/${e.id}/unpublish`, R)).status, 409);
  const [log] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "events.unpublish"), eq(auditLog.targetHost, h.id)));
  assert.equal(log!.actorId, st.me.id);
  assert.equal(log!.reason, R.reason);
  assert.ok(t.notices.some((x) => x.kind === "staffRiskyAction" && x.data?.action === "events.unpublish"));
  // Staff on the host's team never act on it.
  const own = await start(st);
  const mine = await publish(st, own.id);
  assert.equal((await as(st)("POST", `/galaxy/events/${mine.id}/unpublish`, R)).status, 403);
});

test("Galaxy cancels as the host does: its bookings with it", async () => {
  const a = await join(), b = await join(), st = await staff();
  const e = await publish(a, (await start(a)).id);
  assert.equal((await as(b)("POST", `/events/${e.id}/book`, { ticketTypeId: e.tier, quantity: 2 })).status, 201);
  const r = await as(st)("POST", `/galaxy/events/${e.id}/cancel`, { reason: "The venue closed" });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "cancelled");
  assert.equal(r.body.cancelReason, "The venue closed");
  const [bk] = await t.db.select().from(bookings).where(eq(bookings.eventId, e.id));
  assert.equal(bk!.status, "cancelledByHost");
  assert.equal((await as(st)("POST", `/galaxy/events/${e.id}/cancel`, R)).body.error, "notNow");
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.action, "events.cancel"))).length, 1);
});

test("a host's Admins pick its fee plan; 3% + 2% until they do", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  assert.equal((await as(a)("GET", `/hosts/${h.id}`)).body.feePlan, "3+2");
  const r = await as(a)("PATCH", `/hosts/${h.id}`, { feePlan: "5+0" });
  assert.equal(r.status, 200);
  assert.equal(r.body.feePlan, "5+0");
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { feePlan: "4+1" })).status, 400);
  assert.equal((await as(out)("PATCH", `/hosts/${h.id}`, { feePlan: "3+2" })).status, 404);
});
