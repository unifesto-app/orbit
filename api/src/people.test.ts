import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { auditLog, eventActs, eventPeople, events, festItems, hosts, staffGrants, teamRoles } from "./db/schema.ts";

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
const cr = (personId: string, role: string) => ({ personId, role });

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
    ["PUT", `/galaxy/events/${e.id}/acts`, { hostIds: [] }],
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
  // % and _ are letters to the search, not wildcards.
  await mk("Rate 50%_off");
  for (const q of ["%25", "_", "%25_"]) {
    const found = (await as(st)("GET", `/galaxy/persons?q=${q}`)).body.persons.map((p: any) => p.name);
    assert.deepEqual(found, ["Rate 50%_off"], q);
  }

  const set = await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [], people: [{ personId: p2.id, role: "Host" }, { personId: p1.id, role: "Judge" }] });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.people.map((p: any) => [p.name, p.role]), [["Vikram Sen", "Host"], ["Asha Rao", "Judge"]]);
  assert.equal((await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [cr(p2.id, "Host"), cr(p1.id, "Judge")], people: [{ personId: ZERO, role: "Judge" }] })).status, 400);
  assert.equal((await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [cr(p2.id, "Host"), cr(p1.id, "Judge")], people: [{ personId: p1.id, role: "A" }, { personId: p1.id, role: "B" }] })).status, 400);
  // A page that showed an older list (or two saves racing from one page) is refused, not overwritten.
  const old = await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [cr(p1.id, "Judge"), cr(p2.id, "Host")], people: [] });
  assert.equal(old.status, 409);
  assert.equal(old.body.error, "stale");
  // A role changed since counts too.
  assert.equal((await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [cr(p2.id, "Host"), cr(p1.id, "Speaker")], people: [] })).body.error, "stale");
  const race = await Promise.all([1, 2].map(() => as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [cr(p2.id, "Host"), cr(p1.id, "Judge")], people: [{ personId: p2.id, role: "Host" }] })));
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const [logged] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "events.people"), eq(auditLog.targetHost, h.id)));
  assert.equal(logged!.actorId, st.me.id);
  // Replace: one left, the other's gone.
  await as(st)("PUT", `/galaxy/events/${e.id}/people`, { shown: [cr(p2.id, "Host")], people: [{ personId: p1.id, role: "Speaker" }] });
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
  // The act unchanged on a host since paused doesn't block other edits (Galaxy's form sends it back as it was).
  assert.equal((await as(st)("PATCH", `/galaxy/fest-items/${i1.id}`, { title: "Battle of Bands", actHostId: band.id })).status, 200);

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
  // An item already crediting their host: no edit (whatever the body), delete or reorder.
  const [theirs] = await t.db.insert(festItems).values({ ...item, kind: "Competition", eventId: fest.id, position: 1, actHostId: own.id }).returning();
  assert.equal((await as(st)("PATCH", `/galaxy/fest-items/${theirs!.id}`, { title: "Y" })).status, 403);
  assert.equal((await as(st)("DELETE", `/galaxy/fest-items/${theirs!.id}`)).status, 403);
  assert.equal((await as(st)("PUT", `/galaxy/events/${fest.id}/fest-items/order`, { ids: [theirs!.id, ok.id] })).status, 403);
  await t.db.delete(festItems).where(eq(festItems.id, theirs!.id));
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

test("acts: staff set them in order; a hidden act drops off the page but staff see it marked; logged", async () => {
  const a = await join(), b = await join(), st = await staff();
  const h = await start(a);
  const e = await publish(a, h.id, "comedy");
  const x = await start(b), y = await start(b);
  let now: string[] = [];
  const put = async (ids: string[], shown = now, id = e.id) => {
    const r = await as(st)("PUT", `/galaxy/events/${id}/acts`, { shown, hostIds: ids });
    if (r.status === 200) now = ids;
    return r;
  };
  const set = await put([y.id, x.id]);
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.acts.map((r: any) => [r.hostId, r.shown, r.addedBy.id]), [[y.id, true, st.me.id], [x.id, true, st.me.id]]);
  let pub = (await t.call("GET", `/public/events/${e.slug}`)).body;
  assert.deepEqual(pub.acts.map((r: any) => r.id), [y.id, x.id]);
  assert.equal(pub.acts[0].slug, y.slug);
  // A page that showed an older list is refused, not overwritten.
  const old = await put([x.id], []);
  assert.equal(old.status, 409);
  assert.equal(old.body.error, "stale");

  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, y.id));
  pub = (await t.call("GET", `/public/events/${e.slug}`)).body;
  assert.deepEqual(pub.acts.map((r: any) => r.id), [x.id]);
  const staffSees = (await as(st)("GET", `/galaxy/events/${e.id}/lineup`)).body.acts;
  assert.deepEqual(staffSees.map((r: any) => [r.hostId, r.shown]), [[y.id, false], [x.id, true]]);
  assert.ok(staffSees[0].name && staffSees[0].slug); // staff see a hidden act in full
  // Lists carry no acts: the full read only.
  const list = (await t.call("GET", "/public/events")).body;
  assert.ok(!JSON.stringify(list).includes('"acts"'));

  // An act on the list that has gone hidden doesn't block reordering; adding a hidden host, the event's own host, an
  // unknown one or the same one twice is refused.
  assert.equal((await put([x.id, y.id])).status, 200);
  assert.equal((await put([x.id])).status, 200);
  assert.equal((await put([x.id, y.id])).body.error, "actHidden");
  assert.equal((await put([h.id])).body.error, "ownAct");
  assert.equal((await put([ZERO])).body.error, "noHost");
  assert.equal((await put([x.id, x.id])).status, 400);
  // Staff on an act (added or already on) can't touch the list.
  const mine = await start(st);
  assert.equal((await put([mine.id])).status, 403);
  await t.db.insert(eventActs).values({ eventId: e.id, hostId: mine.id, position: 2 });
  assert.equal((await put([x.id], [x.id, mine.id])).status, 403);
  await t.db.delete(eventActs).where(eq(eventActs.hostId, mine.id));
  // Their own host's event, an unknown one.
  const own = await publish(st, mine.id);
  assert.equal((await put([], [], own.id)).status, 403);
  assert.equal((await put([], [], ZERO)).status, 404);

  // Staff take acts off after the start and on a cancelled event.
  await t.db.update(events).set({ startsAt: new Date(t.now() - HOUR) }).where(eq(events.id, e.id));
  await t.db.update(hosts).set({ visibility: "public" }).where(eq(hosts.id, y.id));
  assert.equal((await put([x.id, y.id])).status, 200);
  assert.equal((await put([y.id])).status, 200);
  await t.db.update(events).set({ status: "cancelled" }).where(eq(events.id, e.id));
  assert.equal((await put([])).status, 200);

  const logs = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "events.acts"), eq(auditLog.targetHost, h.id))); // one clock in tests, so no order
  assert.equal(logs.length, 6);
  assert.ok(logs.every((l) => l.actorId === st.me.id));
  const logged = (from: string[], to: string[]) => logs.some((l) => isDeepStrictEqual(l.data, { eventId: e.id, from, to }));
  assert.ok(logged([], [y.id, x.id]));
  assert.ok(logged([x.id, y.id], [y.id]));
  await t.db.delete(events).where(eq(events.id, e.id));
  assert.equal((await t.db.select().from(eventActs).where(eq(eventActs.eventId, e.id))).length, 0);
});

test("acts: a host's Admins set them until the event starts; ten at most; hidden acts are only an id to them", async () => {
  const a = await join(), other = await join(), crew = await join(), st = await staff();
  const h = await start(a);
  const e = await publish(a, h.id, "comedy");
  const acts: string[] = [];
  for (let i = 0; i < 11; i++) acts.push((await start(i % 2 ? other : await join())).id); // 5 hosts a day each
  let now: string[] = [];
  const put = async (ids: string[], u = a, id = e.id, shown = now) => {
    const r = await as(u)("PUT", `/events/${id}/acts`, { shown, hostIds: ids });
    if (r.status === 200) now = ids;
    return r;
  };
  const get = () => as(a)("GET", `/events/${e.id}/acts`);

  const first = acts.slice(0, 3).reverse();
  const ok = await put(first);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.map((r: any) => r.hostId), first);
  assert.deepEqual((await get()).body.map((r: any) => r.hostId), first);
  assert.deepEqual((await t.call("GET", `/public/events/${e.slug}`)).body.acts.map((r: any) => r.id), first);
  // Stale: a page that showed another list.
  const old = await put([], a, e.id, []);
  assert.equal(old.status, 409);
  assert.equal(old.body.error, "stale");
  // Staff added one; a reorder keeps who added each and when.
  const st1 = await as(st)("PUT", `/galaxy/events/${e.id}/acts`, { shown: now, hostIds: [...now, acts[3]!] });
  assert.equal(st1.status, 200);
  now = [...now, acts[3]!];
  const before = await t.db.select().from(eventActs).where(eq(eventActs.eventId, e.id));
  t.tick(60_000);
  assert.equal((await put([...now].reverse())).status, 200);
  const after = await t.db.select().from(eventActs).where(eq(eventActs.eventId, e.id));
  for (const r of before) {
    const n = after.find((x) => x.hostId === r.hostId)!;
    assert.equal(n.addedBy, r.addedBy);
    assert.equal(n.addedAt.getTime(), r.addedAt.getTime());
  }
  assert.equal(after.find((x) => x.hostId === acts[3])!.addedBy, st.me.id);
  assert.equal(after.find((x) => x.hostId === acts[0])!.addedBy, a.me.id);

  assert.equal((await put(acts.slice(0, 10))).status, 200);
  assert.equal((await put(acts)).status, 400); // the 11th
  assert.equal((await put([h.id])).body.error, "ownAct");
  assert.equal((await put([ZERO])).body.error, "noHost");
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, acts[10]!));
  assert.equal((await put([acts[10]!])).body.error, "actHidden");
  // An act gone hidden: only its id to the team, and it doesn't block a reorder.
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, acts[0]!));
  const hidden = (await get()).body.find((r: any) => r.hostId === acts[0]);
  assert.deepEqual(hidden, { hostId: acts[0], shown: false });
  assert.equal((await put([...now].reverse())).status, 200);
  // Not theirs, a Crew seat on the host, or no such event: 404.
  await t.db.insert(teamRoles).values({ hostId: h.id, role: "crew", contact: "crew@example.com", userId: crew.me.id, addedBy: a.me.id, addedAt: new Date(t.now()), acceptedAt: new Date(t.now()), startedAt: new Date(t.now()) });
  for (const u of [other, crew]) {
    assert.equal((await put([], u)).status, 404);
    assert.equal((await as(u)("GET", `/events/${e.id}/acts`)).status, 404);
  }
  assert.equal((await put([], a, ZERO)).status, 404);
  assert.equal((await t.call("PUT", `/events/${e.id}/acts`, { shown: [], hostIds: [] })).status, 401);
  // A suspended host can't change anything.
  await t.db.update(hosts).set({ status: "suspended" }).where(eq(hosts.id, h.id));
  assert.equal((await put([])).body.error, "hostClosed");
  await t.db.update(hosts).set({ status: "live" }).where(eq(hosts.id, h.id));
  // Started: locked.
  await t.db.update(events).set({ startsAt: new Date(t.now() - HOUR) }).where(eq(events.id, e.id));
  const late = await put([]);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "started");
  assert.equal((await get()).body.length, 10);
  // Cancelled.
  await t.db.update(events).set({ status: "cancelled", startsAt: new Date(t.now() + DAY) }).where(eq(events.id, e.id));
  assert.equal((await put([])).body.error, "cancelled");
});
