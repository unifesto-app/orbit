import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, like } from "drizzle-orm";
import { fillVars, unknownVars } from "@orbit/contract";
import { auditLog, deliveries, inboxItems, staffGrants, users } from "./db/schema.ts";
import { fill, varsOf } from "./notification-emails.ts";
import { testApp } from "./testkit.ts";

// Galaxy's wording (PR 8): placeholders, the routes, and saved wording through notify and the worker.

test("fill and unknownVars", () => {
  const v = varsOf("eventTomorrow");
  assert.equal(fill("{title} at {startsAt}, {nope}", v, { title: "Jam", startsAt: "2026-12-05T13:30:00.000Z" }), "Jam at 7:00 pm, {nope}");
  assert.equal(fill("Hi {title}", v, {}), "Hi ");
  assert.equal(fill("{method}", varsOf("signInMethodChanged"), { method: "google" }), "Google");
  assert.equal(fillVars("{a} {a} { b } {}", { a: "x" }), "x x { b } {}");
  assert.deepEqual(unknownVars("{title} {x} {x} {startsAt} {y}", Object.keys(v)), ["x", "y"]);
  assert.deepEqual(unknownVars("no braces", []), []);
});

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const DAY = 24 * 3600_000;
let n = 0;
type P = { p: string; access: string; me: { id: string } };
const join = async (): Promise<P> => {
  const p = `7${String(4_000_000 + ++n * 13).padStart(9, "0")}`;
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return { p, ...s.body };
};
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const platform = async () => {
  const u = await join();
  await t.db.insert(staffGrants).values({ userId: u.me.id, feature: "platform", addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return u;
};
const addDevice = async (u: P) =>
  assert.equal((await as(u)("PUT", "/me/push-device", { app: "orbit", platform: "ios", env: "sandbox", token: `tok-${++n}` })).status, 204);
const fakePush = () => {
  const got: { title: string; body: string }[] = [];
  const one = async (_: unknown, m: { title: string; body: string }) => (got.push(m), "pid");
  return { push: { ios: one, android: one } as any, got };
};
const T = "/galaxy/notifications/templates";

test("Platform only; unknown kinds and channels a kind doesn't use are 404", async () => {
  const people = await join();
  await t.db.insert(staffGrants).values({ userId: people.me.id, feature: "people", addedBy: people.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  for (const [m, path] of [
    ["GET", `${T}/hostAnnouncement`],
    ["PUT", `${T}/hostAnnouncement/push`],
    ["DELETE", `${T}/hostAnnouncement/push`],
    ["POST", `${T}/hostAnnouncement/push/test`],
  ] as const)
    assert.equal((await as(people)(m, path, m === "GET" ? undefined : { title: "x", body: "y", readAt: null })).status, 404, `${m} ${path}`);
  const st = await platform();
  assert.equal((await as(st)("GET", `${T}/nope`)).status, 404);
  assert.equal((await as(st)("PUT", `${T}/welcome/push`, { body: "x", readAt: null })).status, 404); // welcome is email only
  const g = await as(st)("GET", `${T}/hostAnnouncement`);
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.channels.map((c: any) => [c.channel, c.saved]), [["email", null], ["push", null], ["inbox", null]]);
  assert.equal(g.body.vars.hostName, "Open Mic Club");
  assert.deepEqual(g.body.channels[1].code, { title: "Open Mic Club", body: "Doors open at 6:30, half an hour early." });
  assert.equal(g.body.channels[0].code.subject, "Open Mic Club about Open Mic Night");
});

test("unknown variable 400; channel fields; stale readAt 409; audit rows", async () => {
  const st = await platform();
  const put = (ch: string, b: object) => as(st)("PUT", `${T}/eventTomorrow/${ch}`, b);
  const bad = await put("push", { title: "{title}", body: "At {when} and {where}", readAt: null });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /\{when\}, \{where\}/);
  assert.equal((await put("push", { body: "No title", readAt: null })).status, 400);
  assert.equal((await put("push", { title: "x", body: "y".repeat(301), readAt: null })).status, 400);
  assert.equal((await put("inbox", { body: "y".repeat(1001), readAt: null })).status, 400);

  const one = await put("push", { title: "{title}", body: "Tomorrow, {startsAt}", readAt: null });
  assert.equal(one.status, 200);
  assert.equal((await put("push", { title: "a", body: "b", readAt: null })).status, 409); // someone saved since an empty read
  t.tick(1000);
  const two = await put("push", { title: "{title} soon", body: "b", readAt: one.body.updatedAt });
  assert.equal(two.status, 200);
  assert.equal((await put("push", { title: "c", body: "d", readAt: one.body.updatedAt })).status, 409);
  const g = await as(st)("GET", `${T}/eventTomorrow`);
  assert.deepEqual(g.body.channels.find((c: any) => c.channel === "push").saved, {
    subject: null,
    title: "{title} soon",
    body: "b",
    updatedAt: two.body.updatedAt,
    by: "Riya Kapoor",
  });
  const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.actorId, st.me.id), eq(auditLog.action, "notifications.wording")));
  assert.equal(audits.length, 2);
  assert.equal((await as(st)("DELETE", `${T}/eventTomorrow/push`)).status, 204);
  assert.equal((await t.db.select().from(auditLog).where(and(eq(auditLog.actorId, st.me.id), eq(auditLog.action, "notifications.wordingReset")))).length, 1);
});

test("saved push and inbox wording is what goes out; DELETE restores the code's", async () => {
  const st = await platform();
  const a = await join();
  await addDevice(a);
  const data = { eventId: crypto.randomUUID(), title: "Jam Night", hostName: "Loud Club", text: "Bring a friend." };
  assert.equal((await as(st)("PUT", `${T}/hostAnnouncement/push`, { title: "News from {hostName}", body: "{title}: {text}", readAt: null })).status, 200);
  assert.equal((await as(st)("PUT", `${T}/hostAnnouncement/inbox`, { body: "{hostName} says: {text}", readAt: null })).status, 200);
  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data, key: "w1" });
  const [item] = await t.db.select().from(inboxItems).where(eq(inboxItems.userId, a.me.id));
  assert.equal(item!.text, "Loud Club says: Bring a friend.");
  const f = fakePush();
  await t.deliver(f.push);
  assert.deepEqual(f.got.map((m) => [m.title, m.body]), [["News from Loud Club", "Jam Night: Bring a friend."]]);

  await as(st)("DELETE", `${T}/hostAnnouncement/push`);
  await as(st)("DELETE", `${T}/hostAnnouncement/inbox`);
  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data, key: "w2" });
  const g = fakePush();
  await t.deliver(g.push);
  assert.deepEqual(g.got.map((m) => [m.title, m.body]), [["Loud Club", "Bring a friend."]]);
  const items = await t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, a.me.id), eq(inboxItems.dedupeKey, `hostAnnouncement:${a.me.id}:w2`)));
  assert.equal(items[0]!.text, "Bring a friend.");
});

test("a saved email wording is what the worker sends", async () => {
  const st = await platform();
  const a = await join();
  await t.db.update(users).set({ email: `w${n}@example.com`, emailVerifiedAt: new Date(t.now()) }).where(eq(users.id, a.me.id));
  assert.equal((await as(st)("PUT", `${T}/hostVerified/email`, { subject: "{hostName} has the tick", body: "Well done, {hostName}.", readAt: null })).status, 200);
  await t.notify({ to: { userId: a.me.id }, kind: "hostVerified", data: { hostName: "Loud Club" } });
  t.mails.length = 0;
  await t.deliver();
  const m = t.mails.find((x) => x.to === `w${n}@example.com`)!;
  assert.equal(m.subject, "Loud Club has the tick");
  assert.match(m.text, /Well done, Loud Club\./);
  await as(st)("DELETE", `${T}/hostVerified/email`);
});

test("a test send reaches only the caller, with the draft and the samples", async () => {
  const st = await platform();
  const other = await join();
  await addDevice(st);
  await addDevice(other);
  const send = (ch: string, b: object) => as(st)("POST", `${T}/hostAnnouncement/${ch}/test`, b);
  assert.equal((await send("push", { title: "{nope}", body: "x" })).status, 400);
  const r = await send("push", { title: "Hi from {hostName}", body: "{text}" });
  assert.deepEqual([r.status, r.body.sent], [200, 1]);
  const f = fakePush();
  await t.deliver(f.push);
  assert.deepEqual(f.got.map((m) => [m.title, m.body]), [["Hi from Open Mic Club", "Doors open at 6:30, half an hour early."]]);
  const rows = await t.db.select().from(deliveries).where(like(deliveries.dedupeKey, "test:%")); // other has a phone too
  assert.deepEqual(rows.map((d) => d.userId), [st.me.id]);

  const e = await send("email", { subject: "S {title}", body: "B" });
  assert.deepEqual([e.status, e.body.error], [409, "noEmail"]);
  await t.db.update(users).set({ email: `st${n}@example.com`, emailVerifiedAt: new Date(t.now()) }).where(eq(users.id, st.me.id));
  assert.equal((await send("email", { subject: "S {title}", body: "B" })).status, 200);
  t.mails.length = 0;
  await t.deliver();
  assert.deepEqual(t.mails.map((m) => [m.to, m.subject]), [[`st${n}@example.com`, "S Open Mic Night"]]);

  assert.equal((await send("inbox", { body: "Inbox {title}" })).status, 200);
  const items = await t.db.select().from(inboxItems).where(like(inboxItems.dedupeKey, "test:%"));
  assert.deepEqual(items.map((i) => [i.userId, i.text]), [[st.me.id, "Inbox Open Mic Night"]]);
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.action, "notifications.wordingTest"))).length, 3);
});
