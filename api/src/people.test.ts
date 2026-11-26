import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { auditLog, eventPeople, events, festItems, hosts, staffGrants } from "./db/schema.ts";

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
    ["PUT", `/galaxy/events/${e.id}/people`, { shown: [], people: [] }],
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

  const set = await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [], people: [{ personId: p2.id, role: "Host" }, { personId: p1.id, role: "Judge" }] });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.people.map((p: any) => [p.name, p.role]), [["Vikram Sen", "Host"], ["Asha Rao", "Judge"]]);
  assert.equal((await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [p2.id, p1.id], people: [{ personId: ZERO, role: "Judge" }] })).status, 400);
  assert.equal((await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [p2.id, p1.id], people: [{ personId: p1.id, role: "A" }, { personId: p1.id, role: "B" }] })).status, 400);
  // A page that showed an older list (or two saves racing from one page) is refused, not overwritten.
  const old = await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [p1.id, p2.id], people: [] });
  assert.equal(old.status, 409);
  assert.equal(old.body.error, "stale");
  const race = await Promise.all([1, 2].map(() => as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [p2.id, p1.id], people: [{ personId: p2.id, role: "Host" }] })));
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const [logged] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "events.people"), eq(auditLog.targetHost, h.id)));
  assert.equal(logged!.actorId, st.me.id);
  // Replace: one left, the other's gone.
  await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [p2.id], people: [{ personId: p1.id, role: "Speaker" }] });
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
  assert.equal((await as(st)("PUT", `/galaxy/events/${own.id}/people`, { shown: [], people: [] })).status, 403);
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

test("staff never act on their own host's fest, its people or an act of theirs; acts must be public and live; 100 at most", async () => {
  const a = await join(), st = await staff();
  const fest = await publish(a, (await start(a)).id);
  const own = await start(st);
  const mine = await publish(st, own.id);
  // Their own fest: every fest route.
  const [it] = await t.db.insert(festItems).values({ ...item, kind: "Competition", eventId: mine.id, position: 0 }).returning();
  for (const [m, path, body] of [
    ["POST", `/galaxy/events/${mine.id}/fest-items`, item],
    ["PATCH", `/galaxy/fest-items/${it!.id}`, { title: "X" }],
    ["DELETE", `/galaxy/fest-items/${it!.id}`],
    ["PUT", `/galaxy/events/${mine.id}/fest-items/order`, { ids: [it!.id] }],
  ] as [string, string, unknown?][])
    assert.equal((await as(st)(m, path, body)).status, 403, `${m} ${path}`);
  // Their own host as the act on someone else's fest.
  assert.equal((await as(st)("POST", `/galaxy/events/${fest.id}/fest-items`, { ...item, actHostId: own.id })).status, 403);
  const ok = (await as(st)("POST", `/galaxy/events/${fest.id}/fest-items`, item)).body;
  assert.equal((await as(st)("PATCH", `/galaxy/fest-items/${ok.id}`, { actHostId: own.id })).status, 403);
  // A host the page wouldn't show.
  const quiet = await start(a);
  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, quiet.id));
  assert.equal((await as(st)("PATCH", `/galaxy/fest-items/${ok.id}`, { actHostId: quiet.id })).body.error, "actHidden");
  // A person on their own host's event.
  const p = (await as(st)("POST", "/galaxy/persons", { name: "Neha", headline: "MC" })).body;
  await t.db.insert(eventPeople).values({ eventId: mine.id, personId: p.id, role: "Host", position: 0 });
  assert.equal((await as(st)("PATCH", `/galaxy/persons/${p.id}`, { name: "N" })).status, 403);
  assert.equal((await as(st)("DELETE", `/galaxy/persons/${p.id}`)).status, 403);
  // Full at 100.
  await t.db.insert(festItems).values(Array.from({ length: 99 }, (_, i) => ({ ...item, kind: "Food" as const, eventId: fest.id, position: i + 1 })));
  const full = await as(st)("POST", `/galaxy/events/${fest.id}/fest-items`, item);
  assert.equal(full.status, 409);
  assert.equal(full.body.error, "full");
  // Logged against the host, nobody told.
  const [fe] = await t.db.select({ hostId: events.hostId }).from(events).where(eq(events.id, fest.id));
  const logs = await t.db.select({ action: auditLog.action, host: auditLog.targetHost }).from(auditLog).where(eq(auditLog.actorId, st.me.id));
  assert.ok(logs.some((l) => l.action === "festItems.add" && l.host === fe!.hostId));
  assert.ok(logs.some((l) => l.action === "persons.add" && l.host === null));
});

test("the person sheet shows listed events only, the latest 12 past; fest items go once it isn't a fest", async () => {
  const a = await join(), st = await staff();
  const h = await start(a);
  const p = (await as(st)("POST", "/galaxy/persons", { name: "Kiran", headline: "Judge" })).body;
  const on = (eventId: string) => t.db.insert(eventPeople).values({ eventId, personId: p.id, role: "Judge", position: 0 });
  const shown = await publish(a, h.id);
  await on(shown.id);
  const link = await publish(a, h.id);
  await t.db.update(events).set({ visibility: "link" }).where(eq(events.id, link.id));
  const cancelled = await publish(a, h.id);
  await t.db.update(events).set({ status: "cancelled" }).where(eq(events.id, cancelled.id));
  const draft = (await as(a)("POST", `/hosts/${h.id}/events`, { title: "Draft" })).body;
  const paused = await start(a);
  const elsewhere = await publish(a, paused.id);
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, paused.id));
  for (const id of [link.id, cancelled.id, draft.id, elsewhere.id]) await on(id);
  assert.deepEqual((await t.call("GET", `/public/people/${p.id}`)).body.appearances.map((x: any) => x.event.id), [shown.id]);

  // 13 past events: the latest 12, newest first.
  const past: string[] = [];
  for (let i = 0; i < 13; i++) {
    const e = await publish(a, h.id);
    await t.db.update(events).set({ startsAt: new Date(t.now() - (i + 2) * DAY), endsAt: new Date(t.now() - (i + 2) * DAY + HOUR) }).where(eq(events.id, e.id));
    await on(e.id);
    past.push(e.id);
  }
  const all = (await t.call("GET", `/public/people/${p.id}`)).body.appearances.map((x: any) => x.event.id);
  assert.deepEqual(all, [shown.id, ...past.slice(0, 12)]);

  // A fest's items show while it's a fest.
  await as(st)("POST", `/galaxy/events/${shown.id}/fest-items`, item);
  assert.equal((await t.call("GET", `/public/events/${shown.slug}`)).body.festItems.length, 1);
  await t.db.update(events).set({ category: "comedy" }).where(eq(events.id, shown.id));
  assert.deepEqual((await t.call("GET", `/public/events/${shown.slug}`)).body.festItems, []);
});
