import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { eventInterests, hosts, users } from "./db/schema.ts";

// Interests on the account (orbit-pm X13): the picked kinds of event, I'm interested and its public count, and vibes.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(6_000_000 + ++n * 11).padStart(9, "0")}`;
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
const start = async (u: P) => (await as(u)("POST", "/hosts", { name: `Punchline Collective ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
const draft = async (u: P, hostId: string) => (await as(u)("POST", `/hosts/${hostId}/events`, { title: "Open Mic Night" })).body as { id: string; slug: string };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
const publish = async (u: P, hostId: string) => {
  const e = await draft(u, hostId);
  const form = new FormData();
  const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer();
  form.set("image", new File([png as BlobPart], "p.png", { type: "image/png" }));
  const res = await t.app.request(`/events/${e.id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  assert.equal(res.status, 200);
  const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
  assert.equal((await as(u)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(DAY), endsAt: iso(DAY + 2 * HOUR), place })).status, 200);
  assert.equal((await as(u)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 })).status, 201);
  assert.equal((await as(u)("POST", `/events/${e.id}/publish`)).status, 200);
  return e;
};
const page = async (slug: string) => (await t.call("GET", `/public/events/${slug}`)).body as { interested: number; vibes: string[] };

test("interests: null until asked, [] once skipped, known slugs only, each once", async () => {
  const a = as(await join());
  assert.equal((await t.call("GET", "/me/interests")).status, 401);
  assert.deepEqual((await a("GET", "/me/interests")).body, { interests: null });
  assert.equal((await a("PUT", "/me/interests", { interests: [] })).status, 200);
  assert.deepEqual((await a("GET", "/me/interests")).body, { interests: [] });
  const put = await a("PUT", "/me/interests", { interests: ["gaming", "comedy", "gaming"] });
  assert.deepEqual(put.body, { interests: ["gaming", "comedy"] });
  assert.deepEqual((await a("GET", "/me/interests")).body, { interests: ["gaming", "comedy"] });
  for (const interests of [["nightlife"], "comedy", null, Array(11).fill("comedy")])
    assert.equal((await a("PUT", "/me/interests", { interests })).status, 400, JSON.stringify(interests));
  assert.deepEqual((await a("GET", "/me/interests")).body, { interests: ["gaming", "comedy"] });
});

test("interested: idempotent, only events that open, counted on the page without deleted or suspended accounts", async () => {
  const host = await join();
  const h = await start(host);
  const e = await publish(host, h.id);
  const d = await draft(host, h.id);
  const a = await join(), b = await join();
  assert.equal((await page(e.slug)).interested, 0);
  for (const id of [d.id, randomUUID(), "nope"]) assert.equal((await as(a)("PUT", `/me/interested/${id}`)).status, 404, id);
  assert.equal((await as(a)("PUT", `/me/interested/${e.id}`)).status, 204);
  assert.equal((await as(a)("PUT", `/me/interested/${e.id}`)).status, 204);
  assert.equal((await as(b)("PUT", `/me/interested/${e.id}`)).status, 204);
  assert.deepEqual((await as(a)("GET", "/me/interested")).body, { events: [e.id] });
  assert.equal((await page(e.slug)).interested, 2);
  await t.db.update(users).set({ suspendedAt: new Date(t.now() - 1000) }).where(eq(users.id, b.me.id));
  assert.equal((await page(e.slug)).interested, 1);
  await t.db.update(users).set({ suspendedAt: null, deletedAt: new Date() }).where(eq(users.id, b.me.id));
  assert.equal((await page(e.slug)).interested, 1);
  // A host off the air hides it from the list, never deletes it.
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, h.id));
  assert.deepEqual((await as(a)("GET", "/me/interested")).body, { events: [] });
  await t.db.update(hosts).set({ status: "live" }).where(eq(hosts.id, h.id));
  assert.equal((await as(a)("DELETE", `/me/interested/${e.id}`)).status, 204);
  assert.equal((await as(a)("DELETE", `/me/interested/${e.id}`)).status, 204);
  assert.deepEqual((await as(a)("GET", "/me/interested")).body, { events: [] });
  assert.equal((await page(e.slug)).interested, 0);
});

test("deleting the account clears interests and interested", async () => {
  const host = await join();
  const e = await publish(host, (await start(host)).id);
  const a = await join();
  await as(a)("PUT", "/me/interests", { interests: ["comedy"] });
  await as(a)("PUT", `/me/interested/${e.id}`);
  await t.db.update(users).set({ deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, a.me.id));
  const { runDeletions } = await import("./auth/deletion.ts");
  assert.equal(await runDeletions(t.db, async () => {}, t.now()), 1);
  assert.equal((await t.db.select().from(eventInterests).where(eq(eventInterests.userId, a.me.id))).length, 0);
  assert.equal((await t.db.select({ i: users.interests }).from(users).where(eq(users.id, a.me.id)))[0]!.i, null);
});

test("vibes: trimmed, each once, at most 6 of 1 to 24; on the team's read and the public page", async () => {
  const host = await join();
  const e = await publish(host, (await start(host)).id);
  assert.deepEqual((await page(e.slug)).vibes, []);
  const set = await as(host)("PATCH", `/events/${e.id}`, { vibes: [" Chill ", "chill", "Loud crowd"] });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.vibes, ["Chill", "Loud crowd"]);
  assert.deepEqual((await page(e.slug)).vibes, ["Chill", "Loud crowd"]);
  for (const vibes of [Array(7).fill("a").map((x, i) => x + i), ["x".repeat(25)], ["  "]])
    assert.equal((await as(host)("PATCH", `/events/${e.id}`, { vibes })).status, 400, JSON.stringify(vibes));
  assert.deepEqual((await as(host)("GET", `/events/${e.id}`)).body.vibes, ["Chill", "Loud crowd"]);
});
