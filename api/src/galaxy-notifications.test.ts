import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { auditLog, deliveries, inboxItems, staffGrants, users } from "./db/schema.ts";
import { testApp } from "./testkit.ts";

// Galaxy's Notifications (PR 7): kill switches through the pipeline and the worker, and the delivery log.
let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const DAY = 24 * 3600_000;
let n = 0;
const phone = () => `7${String(3_000_000 + ++n * 13).padStart(9, "0")}`;
type P = { p: string; access: string; me: { id: string } };
const join = async (): Promise<P> => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body };
};
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const give = async (u: P, feature: "platform" | "people") =>
  t.db.insert(staffGrants).values({ userId: u.me.id, feature, addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
const token = () => `secret-token-${++n}`;
const addDevice = async (u: P) => assert.equal((await as(u)("PUT", "/me/push-device", { app: "orbit", platform: "ios", env: "sandbox", token: token() })).status, 204);
const rowsOf = (userId: string, kind: string) => t.db.select().from(deliveries).where(and(eq(deliveries.userId, userId), eq(deliveries.kind, kind)));
const fakePush = () => {
  const got: unknown[] = [];
  const one = async (d: unknown) => (got.push(d), "pid");
  return { push: { ios: one, android: one } as any, got };
};

test("only Platform changes switches; People reads; anyone else finds nothing", async () => {
  const plain = as(await join());
  const people = await join();
  await give(people, "people");
  for (const [m, path] of [
    ["GET", "/galaxy/notifications/kinds"],
    ["GET", "/galaxy/notifications/deliveries?q=9876543210"],
    ["PUT", "/galaxy/notifications/switches/hostAnnouncement/push"],
  ] as const)
    assert.equal((await plain(m, path, m === "PUT" ? { off: true, reason: "Test it" } : undefined)).status, 404, path);
  assert.equal((await t.call("GET", "/galaxy/notifications/kinds")).status, 401);
  const kinds = await as(people)("GET", "/galaxy/notifications/kinds");
  assert.equal(kinds.status, 200);
  const ann = kinds.body.kinds.find((k: any) => k.kind === "hostAnnouncement");
  assert.deepEqual([ann.group, ann.level, ann.channels, ann.off], ["events", "normal", ["email", "push", "inbox"], {}]);
  assert.equal((await as(people)("PUT", "/galaxy/notifications/switches/hostAnnouncement/push", { off: true, reason: "Test it" })).status, 404);
});

test("a Must kind has no switch; unknown kinds and channels it doesn't use are 404; a reason is needed", async () => {
  const st = await join();
  await give(st, "platform");
  const put = (k: string, ch: string, b: unknown = { off: true, reason: "Broken" }) => as(st)("PUT", `/galaxy/notifications/switches/${k}/${ch}`, b);
  const must = await put("signInMethodChanged", "push");
  assert.deepEqual([must.status, must.body.error], [409, "alwaysOn"]);
  assert.equal((await put("nope", "push")).status, 404);
  assert.equal((await put("welcome", "push")).status, 404); // welcome is email only
  assert.equal((await put("hostAnnouncement", "whatsapp")).status, 404);
  assert.equal((await put("hostAnnouncement", "push", { off: true, reason: "" })).status, 400);
});

test("a kind's push off: new notices skip push as killSwitch, the inbox still lands, queued rows skip; audit and email", async () => {
  const st = await join();
  await give(st, "platform");
  const a = await join();
  await addDevice(a);
  // Queued before the switch: the worker skips it once the switch is off.
  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data: {}, key: "one" });
  const [early] = (await rowsOf(a.me.id, "hostAnnouncement")).filter((d) => d.channel === "push");
  assert.equal(early!.status, "queued");

  const r = await as(st)("PUT", "/galaxy/notifications/switches/hostAnnouncement/push", { off: true, reason: "APNs is down" });
  assert.equal(r.status, 200);
  const [audit] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "notifications.switch"), eq(auditLog.actorId, st.me.id)));
  assert.deepEqual([audit!.reason, audit!.data], ["APNs is down", { kind: "hostAnnouncement", channel: "push", off: true }]);
  assert.ok(t.notices.some((x) => x.kind === "staffRiskyAction" && (x.to as any).userId === st.me.id && (x.data as any).reason === "APNs is down"));

  const { push, got } = fakePush();
  await t.deliver(push);
  assert.equal(got.length, 0);
  const after = (await rowsOf(a.me.id, "hostAnnouncement")).find((d) => d.id === early!.id)!;
  assert.deepEqual([after.status, after.reason], ["skipped", "killSwitch"]);

  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data: {}, key: "two" });
  const two = (await rowsOf(a.me.id, "hostAnnouncement")).filter((d) => d.dedupeKey.endsWith(":two"));
  assert.deepEqual(two.filter((d) => d.channel === "push").map((d) => [d.status, d.reason]), [["skipped", "killSwitch"]]);
  assert.notEqual(two.find((d) => d.channel === "email")!.reason, "killSwitch"); // email is its own switch
  assert.equal((await t.db.select().from(inboxItems).where(eq(inboxItems.userId, a.me.id))).length, 2);
  // Another kind's push is untouched.
  await t.notify({ to: { userId: a.me.id }, kind: "signInMethodChanged", data: { method: "passkey", change: "added" } });
  assert.equal((await rowsOf(a.me.id, "signInMethodChanged")).find((d) => d.channel === "push")!.status, "queued");

  const kinds = await as(st)("GET", "/galaxy/notifications/kinds");
  assert.equal(kinds.body.kinds.find((k: any) => k.kind === "hostAnnouncement").off.push.reason, "APNs is down");

  // Back on: the next one queues.
  assert.equal((await as(st)("PUT", "/galaxy/notifications/switches/hostAnnouncement/push", { off: false, reason: "APNs is back" })).status, 200);
  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data: {}, key: "three" });
  const three = (await rowsOf(a.me.id, "hostAnnouncement")).find((d) => d.dedupeKey.endsWith(":three") && d.channel === "push")!;
  assert.equal(three.status, "queued");
});

test("the whole channel (*) stops Must kinds too; inbox off writes a skipped inbox row and no item", async () => {
  const st = await join();
  await give(st, "platform");
  const a = await join();
  await t.db.update(users).set({ email: `k${n}@example.com`, emailVerifiedAt: new Date(t.now()) }).where(eq(users.id, a.me.id));
  assert.equal((await as(st)("PUT", "/galaxy/notifications/switches/*/email", { off: true, reason: "SES is down" })).status, 200);
  await t.notify({ to: { userId: a.me.id }, kind: "accountLifted", data: {} });
  assert.deepEqual((await rowsOf(a.me.id, "accountLifted")).map((d) => [d.channel, d.status, d.reason]), [["email", "skipped", "killSwitch"]]);
  assert.equal((await as(st)("GET", "/galaxy/notifications/kinds")).body.all.email.reason, "SES is down");
  assert.equal((await as(st)("PUT", "/galaxy/notifications/switches/*/email", { off: false, reason: "SES is back" })).status, 200);

  assert.equal((await as(st)("PUT", "/galaxy/notifications/switches/hostAnnouncement/inbox", { off: true, reason: "Bad words" })).status, 200);
  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data: {}, key: "inbox" });
  assert.ok((await rowsOf(a.me.id, "hostAnnouncement")).some((d) => d.channel === "inbox" && d.reason === "killSwitch"));
  assert.equal((await t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, a.me.id), eq(inboxItems.kind, "hostAnnouncement")))).length, 0);
  await as(st)("PUT", "/galaxy/notifications/switches/hostAnnouncement/inbox", { off: false, reason: "Fixed" });
});

test("the delivery log finds a person by phone, masks the email and device, never returns a token, and is audited", async () => {
  const people = await join();
  await give(people, "people");
  const a = await join();
  const mail = `riya${n}@example.com`;
  await t.db.update(users).set({ email: mail, emailVerifiedAt: new Date(t.now()) }).where(eq(users.id, a.me.id));
  await addDevice(a);
  await t.notify({ to: { userId: a.me.id }, kind: "signInMethodChanged", data: { method: "passkey", change: "added" } });
  await t.notify({ to: { userId: a.me.id }, kind: "welcome", data: {} });

  const r = await as(people)("GET", `/galaxy/notifications/deliveries?q=${encodeURIComponent(`+91 ${a.p}`)}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.person, { id: a.me.id, name: "Riya Kapoor" });
  const rows = r.body.deliveries as any[];
  assert.ok(rows.length >= 3);
  const email = rows.find((d) => d.kind === "signInMethodChanged" && d.channel === "email");
  assert.deepEqual([email.status, email.to], ["queued", "r***@example.com"]);
  assert.equal(rows.find((d) => d.channel === "push").to, "ios · orbit");
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes("secret-token") && !raw.includes(mail));
  const [audit] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "notifications.search"), eq(auditLog.actorId, people.me.id)));
  assert.deepEqual([audit!.targetUser, (audit!.data as any).by], [a.me.id, "phone"]);
  assert.ok(!JSON.stringify(audit).includes(a.p));

  assert.equal((await as(people)("GET", `/galaxy/notifications/deliveries?q=${a.me.id}`)).body.deliveries.length, rows.length);
  assert.equal((await as(people)("GET", "/galaxy/notifications/deliveries?q=riya")).status, 400);
  const none = await as(people)("GET", "/galaxy/notifications/deliveries?q=nobody@example.com");
  assert.deepEqual(none.body, { person: null, deliveries: [] });
});
