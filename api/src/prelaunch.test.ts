import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { testApp } from "./testkit.ts";
import { auditLog, interest, staffGrants } from "./db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const join = async () => {
  const p = `8${String(5_000_000 + ++n * 11).padStart(9, "0")}`;
  t.tick(30_000);
  await t.call("POST", "/auth/code", { to: p });
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return s.body as { access: string; me: { id: string } };
};
// From a given address, as Caddy would set it.
const from = async (ip: string, body: unknown) =>
  (await t.app.request("/public/interest", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) })).status;

test("the waitlist counts people, not taps, and tells nobody who has joined", async () => {
  const meta = { country: "IN", userAgent: "Mozilla/5.0", utm: { utm_source: "instagram" }, screen: "390x844@3" };
  assert.equal((await t.call("POST", "/public/interest", { email: " Riya@Example.com ", meta })).status, 204);
  assert.equal((await t.call("POST", "/public/interest", { email: "riya@example.com" })).status, 204);
  assert.deepEqual((await t.call("GET", "/public/interest")).body, { count: 1 });
  const [row] = await t.db.select().from(interest);
  assert.equal(row!.email, "riya@example.com");
  assert.equal(row!.ip, "203.0.113.7"); // the request's address, never the body's
  assert.deepEqual(row!.utm, { utm_source: "instagram" }); // the first visit is kept
});

test("hostile input is refused quickly, never a 500", async () => {
  t.tick(60_000);
  const started = Date.now();
  assert.equal(await from("198.51.100.1", { email: `a@${".".repeat(5000)} x` }), 400);
  assert.equal(await from("198.51.100.1", { email: `a@${"b".repeat(9000)}.com` }), 400); // over the body cap
  assert.ok(Date.now() - started < 500);
  assert.equal(await from("198.51.100.1", { email: "a\u0000b@example.com" }), 400);
  assert.equal(await from("198.51.100.1", { email: "ok@example.com", meta: { userAgent: "x\u0000" } }), 400);
  assert.equal(await from("198.51.100.1", { email: "ok@example.com", meta: { utm: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"])) } }), 400);
});

test("ten sign-ups a minute from one address, one IPv6 /64 counting as one", async () => {
  t.tick(60_000);
  for (let i = 0; i < 10; i++) assert.equal(await from("192.0.2.9", { email: `v4-${i}@example.com` }), 204);
  assert.equal(await from("192.0.2.9", { email: "v4-late@example.com" }), 429);
  for (let i = 0; i < 10; i++) assert.equal(await from(`2001:db8:1:2::${i + 1}`, { email: `v6-${i}@example.com` }), 204);
  assert.equal(await from("2001:db8:1:2:ffff::1", { email: "v6-late@example.com" }), 429);
  assert.equal(await from("2001:db8:1:3::1", { email: "v6-other@example.com" }), 204); // another network
  assert.equal((await t.db.select().from(interest).where(eq(interest.email, "v6-late@example.com"))).length, 0);
});

test("only holders of People see the list, and each read is logged", async () => {
  const someone = await join();
  assert.equal((await t.call("GET", "/galaxy/prelaunch")).status, 401);
  assert.equal((await t.call("GET", "/galaxy/prelaunch", undefined, someone.access)).status, 404);
  const day = 24 * 3600_000;
  const grant = (feature: "hosts" | "people") =>
    t.db.insert(staffGrants).values({ userId: someone.me.id, feature, addedBy: someone.me.id, addedAt: new Date(t.now() - 2 * day), startsAt: new Date(t.now() - day) });
  await grant("hosts");
  assert.equal((await t.call("GET", "/galaxy/prelaunch", undefined, someone.access)).status, 404);
  await grant("people");
  const list = await t.call("GET", "/galaxy/prelaunch", undefined, someone.access);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, (await t.call("GET", "/public/interest")).body.count);
  assert.equal(list.body.people.length, 22); // under a page: every row so far
  assert.equal(list.body.people.at(-1).email, "riya@example.com"); // newest first
  assert.equal(list.body.people.at(-1).country, "IN");
  assert.equal(list.body.people.at(-1).region, undefined); // what the visit didn't give is left out
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.action, "prelaunch.list"))).length, 1);
});
