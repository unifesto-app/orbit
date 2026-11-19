import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { DEFAULT_CONTENT } from "@orbit/contract";
import { testApp } from "./testkit.ts";
import { appContent, auditLog, staffGrants, users } from "./db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(5_000_000 + ++n * 11).padStart(9, "0")}`;
const e164 = (p: string) => `+91${p}`;
const DAY = 24 * 3600_000;

const verify = async (to: string) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(e164(to)), device });
};
const join = async (p = phone()) => {
  const v = await verify(p);
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body } as { p: string; access: string; refresh: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const give = async (u: P, ...features: string[]) => {
  for (const feature of features as any[])
    await t.db.insert(staffGrants).values({ userId: u.me.id, feature, addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
};
const audits = async (action: string) => (await t.db.select().from(auditLog)).filter((a) => a.action === action);
const staff = async () => {
  const u = await join();
  await give(u, "platform");
  return as(u);
};
const clear = async () => {
  await t.db.delete(appContent);
};
const ad = (o: Record<string, unknown> = {}) => ({ kicker: "Offer", title: "Title", line: "A line", colour: "forest", href: "/search", places: ["home"], ...o });

test("1 public read of an empty table is the defaults, cached a minute", async () => {
  await clear();
  const r = await t.app.request("/public/app-content");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, max-age=60");
  assert.deepEqual(await r.json(), DEFAULT_CONTENT);
});

test("2 only staff with platform get in", async () => {
  await clear();
  assert.equal((await t.call("GET", "/galaxy/app-content")).status, 401);
  assert.equal((await t.call("PUT", "/galaxy/app-content/asks", { value: [], at: null })).status, 401);
  const plain = as(await join());
  assert.equal((await plain("GET", "/galaxy/app-content")).status, 404);
  assert.equal((await plain("PUT", "/galaxy/app-content/asks", { value: [], at: null })).status, 404);
  const p = await join();
  await give(p, "people");
  assert.equal((await as(p)("GET", "/galaxy/app-content")).status, 404);
  const ok = await (await staff())("GET", "/galaxy/app-content");
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.saved, { ads: null, help: null, asks: null });
});

test("3 first save shows on both reads, names the saver, and is audited", async () => {
  await clear();
  const s = await staff();
  const before = (await audits("content.set")).length;
  const r = await s("PUT", "/galaxy/app-content/asks", { value: ["Jazz tonight"], at: null });
  assert.equal(r.status, 200);
  assert.equal(new Date(r.body.at).toISOString(), r.body.at);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.asks, ["Jazz tonight"]);
  const g = await s("GET", "/galaxy/app-content");
  assert.deepEqual(g.body.content.asks, ["Jazz tonight"]);
  assert.equal(g.body.saved.asks.by, "Riya Kapoor");
  assert.equal(g.body.saved.asks.at, r.body.at);
  const rows = await audits("content.set");
  assert.equal(rows.length, before + 1);
  assert.deepEqual(rows.at(-1)!.data, { key: "asks", value: ["Jazz tonight"] });
});

test("4 stale saves get 409 and write nothing", async () => {
  await clear();
  const a = await staff();
  const first = await a("PUT", "/galaxy/app-content/asks", { value: ["One"], at: null });
  assert.equal(first.status, 200);
  const dup = await a("PUT", "/galaxy/app-content/asks", { value: ["Two"], at: null });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, "changed");
  t.tick(1000);
  const b = await a("PUT", "/galaxy/app-content/asks", { value: ["Three"], at: first.body.at });
  assert.equal(b.status, 200);
  const old = await a("PUT", "/galaxy/app-content/asks", { value: ["Four"], at: first.body.at });
  assert.equal(old.status, 409);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.asks, ["Three"]);
  assert.equal((await audits("content.set")).filter((x) => (x.data as any).key === "asks" && ["Two", "Four"].includes((x.data as any).value[0])).length, 0);
});

test("5 bad saves are refused", async () => {
  await clear();
  const s = await staff();
  assert.equal((await s("PUT", "/galaxy/app-content/nope", { value: [], at: null })).status, 404);
  const evil = await s("PUT", "/galaxy/app-content/ads", { value: [ad({ href: "https://evil.test" })], at: null });
  assert.equal(evil.status, 400);
  assert.equal(evil.body.error, "invalid");
  assert.match(evil.body.message, /^Ad 1:/);
  assert.equal((await s("PUT", "/galaxy/app-content/ads", { value: [ad({ colour: "#ff0000" })], at: null })).status, 400);
  assert.equal((await s("PUT", "/galaxy/app-content/asks", { value: ["a", "b", "c", "d", "e", "f", "g"], at: null })).status, 400);
  assert.equal((await s("PUT", "/galaxy/app-content/asks", { value: ["x".repeat(33 * 1024)], at: null })).status, 400);
  // A name every object has is still nothing here, never a server error.
  for (const k of ["constructor", "toString", "__proto__"]) assert.equal((await s("PUT", `/galaxy/app-content/${k}`, { value: [], at: null })).status, 404, k);
  assert.equal((await s("PUT", "/galaxy/app-content/ads", { value: [ad({ href: "constructor" })], at: null })).status, 400);
  // An end before its start.
  const backwards = await s("PUT", "/galaxy/app-content/ads", { value: [ad({ starts: "2026-11-25T21:00:00+05:30", ends: "2026-11-25T18:00:00+05:30" })], at: null });
  assert.equal(backwards.status, 400);
  assert.match(backwards.body.message, /^Ad 1: End it after it starts/);
  assert.equal((await s("PUT", "/galaxy/app-content/asks", { value: ["Jams", "jams"], at: null })).status, 400);
  assert.equal((await t.db.select().from(appContent)).length, 0);
  assert.equal((await audits("content.set")).filter((x) => (x.data as any).key === "ads").length, 0);
});

test("5b an ad keeps its start and end, India time and all", async () => {
  await clear();
  const s = await staff();
  const timed = ad({ starts: "2026-11-25T18:00:00+05:30", ends: "2026-11-25T21:00:00+05:30" });
  assert.equal((await s("PUT", "/galaxy/app-content/ads", { value: [timed], at: null })).status, 200);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.ads, [timed]);
});

test("6 a stored list that no longer reads falls back to its default", async () => {
  await clear();
  await t.db.insert(appContent).values({ key: "help", value: "garbage", updatedAt: new Date(t.now()) });
  await t.db.insert(appContent).values({ key: "asks", value: ["Kept"], updatedAt: new Date(t.now()) });
  const r = (await t.call("GET", "/public/app-content")).body;
  assert.deepEqual(r.help, DEFAULT_CONTENT.help);
  assert.deepEqual(r.asks, ["Kept"]);
});

test("7 saved values come back trimmed", async () => {
  await clear();
  const s = await staff();
  assert.equal((await s("PUT", "/galaxy/app-content/asks", { value: ["  Padded  "], at: null })).status, 200);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.asks, ["Padded"]);
});
