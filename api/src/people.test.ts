import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { eventPeople, events, festItems, hosts, staffGrants } from "./db/schema.ts";

// People on events and what's inside a fest (X14): Galaxy writes, the public reads.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(7_100_000 + ++n * 11).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR;
const ZERO = "00000000-0000-4000-8000-000000000000";

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
const start = async (u: P) => (await as(u)("POST", "/hosts", { name: `Campus Fest ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string; slug: string };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad" };

const publish = async (u: P, hostId: string, category = "fests") => {
  const e = (await as(u)("POST", `/hosts/${hostId}/events`, { title: "Spring Fest" })).body as { id: string; slug: string };
  const form = new FormData();
  form.set("image", new File([(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer()) as BlobPart], "p.png", { type: "image/png" }));
  const up = await t.app.request(`/events/${e.id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  assert.equal(up.status, 200);
  assert.equal((await as(u)("PATCH", `/events/${e.id}`, { category, startsAt: iso(DAY), endsAt: iso(DAY + 2 * HOUR), place })).status, 200);
  await as(u)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 });
  assert.equal((await as(u)("POST", `/events/${e.id}/publish`)).status, 200);
  return e;
};
const item = { title: "Battle of Bands", kind: "Competition", when: "6:00 PM", where: "Main stage", about: "Bands play off." };

test("Galaxy's person and lineup routes are for holders of Hosts only", async () => {
  const a = await join(), nobody = await join();
  const e = await publish(a, (await start(a)).id);
  for (const [m, path, body] of [
    ["GET", "/galaxy/persons"],
    ["POST", "/galaxy/persons", { name: "Asha", headline: "Poet" }],
    ["PATCH", `/galaxy/persons/${ZERO}`, { name: "B" }],
    ["DELETE", `/galaxy/persons/${ZERO}`],
    ["GET", `/galaxy/events/${e.id}/lineup`],
    ["PUT", `/galaxy/events/${e.id}/people`, { people: [] }],
    ["POST", `/galaxy/events/${e.id}/fest-items`, item],
    ["PATCH", `/galaxy/fest-items/${ZERO}`, { title: "X" }],
    ["DELETE", `/galaxy/fest-items/${ZERO}`],
    ["PUT", `/galaxy/events/${e.id}/fest-items/order`, { ids: [] }],
  ] as [string, string, unknown?][]) {
    assert.equal((await as(nobody)(m, path, body)).status, 404, path);
    assert.equal((await as(a)(m, path, body)).status, 404, path); // the host's own Admin isn't staff
    assert.equal((await t.call(m, path, body)).status, 401, path);
  }
});

test("staff set the lineup and replace it; the public reads it in order, and the person's appearances", async () => {
  const a = await join(), st = await staff();
  const h = await start(a);
  const e = await publish(a, h.id, "comedy");
  const mk = async (name: string) => (await as(st)("POST", "/galaxy/persons", { name, headline: "Speaker" })).body as { id: string };
  const p1 = await mk("Asha Rao"), p2 = await mk("Vikram Sen");
  assert.equal((await as(st)("POST", "/galaxy/persons", { name: "", headline: "x" })).status, 400);
  assert.equal((await as(st)("GET", "/galaxy/persons?q=ash")).body.persons.length, 1);

  const set = await as(st)("PUT", `/galaxy/events/${e.id}/people`, { people: [{ personId: p2.id, role: "Host" }, { personId: p1.id, role: "Judge" }] });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.people.map((p: any) => [p.name, p.role]), [["Vikram Sen", "Host"], ["Asha Rao", "Judge"]]);
  assert.equal((await as(st)("PUT", `/galaxy/events/${e.id}/people`, { people: [{ personId: ZERO, role: "Judge" }] })).status, 400);
  assert.equal((await as(st)("PUT", `/galaxy/events/${e.id}/people`, { people: [{ personId: p1.id, role: "A" }, { personId: p1.id, role: "B" }] })).status, 400);
  // Replace: one left, the other's gone.
  await as(st)("PUT", `/galaxy/events/${e.id}/people`, { people: [{ personId: p1.id, role: "Speaker" }] });
  const pub = await t.call("GET", `/public/events/${e.slug}`);
  assert.deepEqual(pub.body.people, [{ id: p1.id, name: "Asha Rao", headline: "Speaker", role: "Speaker" }]);
  assert.deepEqual(pub.body.festItems, []);

  const r = await t.call("GET", `/public/people/${p1.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.appearances.map((x: any) => [x.role, x.event.id]), [["Speaker", e.id]]);
  assert.equal((await t.call("GET", `/public/people/${p2.id}`)).body.appearances.length, 0);
  assert.equal((await t.call("GET", "/public/people/nope")).status, 404);
  assert.equal((await t.call("GET", `/public/people/${ZERO}`)).status, 404);
  // A private host's event stays off the person's sheet.
  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, h.id));
  assert.equal((await t.call("GET", `/public/people/${p1.id}`)).body.appearances.length, 0);
  // Deleting the person takes them off the event.
  assert.equal((await as(st)("DELETE", `/galaxy/persons/${p1.id}`)).status, 204);
  assert.equal((await t.db.select().from(eventPeople).where(eq(eventPeople.eventId, e.id))).length, 0);
  // Staff never act on a host they're on.
  const own = await publish(st, (await start(st)).id);
  assert.equal((await as(st)("PUT", `/galaxy/events/${own.id}/people`, { people: [] })).status, 403);
});

test("fest items: fests only, ordered, act shown while its host is public and live; event delete cascades", async () => {
  const a = await join(), b = await join(), st = await staff();
  const fest = await publish(a, (await start(a)).id);
  const other = await publish(a, (await start(a)).id, "comedy");
  assert.equal((await as(st)("POST", `/galaxy/events/${other.id}/fest-items`, item)).body.error, "notFest");
  const band = await start(b);
  const i1 = (await as(st)("POST", `/galaxy/events/${fest.id}/fest-items`, { ...item, actHostId: band.id })).body;
  const i2 = (await as(st)("POST", `/galaxy/events/${fest.id}/fest-items`, { ...item, title: "Food court", kind: "Food" })).body;
  assert.equal((await as(st)("POST", `/galaxy/events/${fest.id}/fest-items`, { ...item, actHostId: ZERO })).status, 400);
  assert.equal((await as(st)("POST", `/galaxy/events/${fest.id}/fest-items`, { ...item, kind: "Party" })).status, 400);

  let pub = (await t.call("GET", `/public/events/${fest.slug}`)).body;
  assert.deepEqual(pub.festItems.map((x: any) => x.title), ["Battle of Bands", "Food court"]);
  assert.equal(pub.festItems[0].act.id, band.id);
  assert.equal(pub.festItems[1].act, null);
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, band.id));
  assert.equal((await t.call("GET", `/public/events/${fest.slug}`)).body.festItems[0].act, null);

  assert.equal((await as(st)("PUT", `/galaxy/events/${fest.id}/fest-items/order`, { ids: [i2.id] })).status, 409);
  const ord = await as(st)("PUT", `/galaxy/events/${fest.id}/fest-items/order`, { ids: [i2.id, i1.id] });
  assert.equal(ord.status, 200);
  pub = (await t.call("GET", `/public/events/${fest.slug}`)).body;
  assert.deepEqual(pub.festItems.map((x: any) => x.title), ["Food court", "Battle of Bands"]);

  const ed = await as(st)("PATCH", `/galaxy/fest-items/${i2.id}`, { prize: "₹10,000" });
  assert.equal(ed.body.prize, "₹10,000");
  assert.equal((await as(st)("PATCH", `/galaxy/fest-items/${ZERO}`, { prize: "x" })).status, 404);
  assert.equal((await as(st)("DELETE", `/galaxy/fest-items/${i2.id}`)).status, 204);
  assert.equal((await as(st)("GET", `/galaxy/events/${fest.id}/lineup`)).body.festItems.length, 1);

  await t.db.delete(events).where(eq(events.id, fest.id));
  assert.equal((await t.db.select().from(festItems).where(eq(festItems.eventId, fest.id))).length, 0);
});
