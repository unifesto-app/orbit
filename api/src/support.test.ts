import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { testApp } from "./testkit.ts";
import { auditLog, inboxItems, staffGrants, supportMessages, supportThreads, users } from "./db/schema.ts";
import { runDeletions } from "./auth/deletion.ts";

// Help and support (X16): Write to us, the person's thread, and Galaxy's Support inbox.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(8_500_000 + ++n * 13).padStart(9, "0")}`;
const DAY = 24 * 3600_000;

const join = async (name = "Riya Kapoor") => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name, dob: "2000-05-01", device });
  return s.body as { access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const staff = async () => {
  const s = await join("Meera Rao");
  await t.db.insert(staffGrants).values({ userId: s.me.id, feature: "queues", addedBy: s.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return s;
};
const send = async (u: P, body: string, app = "orbit") => {
  t.tick(1000);
  return as(u)("POST", "/me/support", { app, body });
};

test("send: a thread per app, a second message appends, 400 on an empty body, 401 signed out", async () => {
  const a = await join();
  assert.equal((await t.call("POST", "/me/support", { app: "orbit", body: "Hi" })).status, 401);
  assert.equal((await as(a)("POST", "/me/support", { app: "orbit", body: "   " })).status, 400);
  assert.equal((await as(a)("POST", "/me/support", { app: "crew", body: "Hi" })).status, 400);
  assert.equal((await as(a)("POST", "/me/support", { app: "orbit", body: "x".repeat(2001) })).status, 400);

  const one = await send(a, "My ticket didn't show up");
  assert.equal(one.status, 201);
  const two = await send(a, "It's for Open Mic Night");
  assert.equal(two.body.threadId, one.body.threadId);
  const other = await send(a, "Venue question", "station");
  assert.notEqual(other.body.threadId, one.body.threadId);

  const mine = await as(a)("GET", "/me/support?app=orbit");
  assert.equal(mine.body.thread.id, one.body.threadId);
  assert.deepEqual(mine.body.thread.messages.map((m: { body: string; from: string }) => [m.from, m.body]), [
    ["person", "My ticket didn't show up"],
    ["person", "It's for Open Mic Night"],
  ]);
  assert.equal((await as(a)("GET", "/me/support?app=launch")).body.thread, null);
  assert.equal((await as(a)("GET", "/me/support?app=nope")).status, 400);
});

test("GET /me/support shows only your own thread", async () => {
  const a = await join(), b = await join();
  await send(a, "Mine");
  assert.equal((await as(b)("GET", "/me/support?app=orbit")).body.thread, null);
  await send(b, "Theirs");
  const got = await as(b)("GET", "/me/support?app=orbit");
  assert.deepEqual(got.body.thread.messages.map((m: { body: string }) => m.body), ["Theirs"]);
});

test("20 a day, then 429 until tomorrow", async () => {
  const a = await join();
  for (let i = 0; i < 20; i++) assert.equal((await send(a, `Message ${i}`)).status, 201);
  const many = await send(a, "One more");
  assert.equal(many.status, 429);
  assert.equal(many.body.error, "tooMany");
  t.tick(DAY);
  assert.equal((await send(a, "Next day")).status, 201);
});

test("Galaxy: non-holders get 404 on every route", async () => {
  const a = await join();
  const { threadId } = (await send(a, "Hello")).body;
  for (const [m, path, body] of [
    ["GET", "/galaxy/support"],
    ["GET", `/galaxy/support/${threadId}`],
    ["POST", `/galaxy/support/${threadId}/reply`, { body: "Hi" }],
    ["POST", `/galaxy/support/${threadId}/status`, { status: "closed" }],
  ] as const)
    assert.equal((await as(a)(m, path, body)).status, 404, path);
});

test("Galaxy: list, view, reply (answered, logged, a supportReply in the right app), close, reopen", async () => {
  const s = await staff();
  const a = await join("Arjun Mehta");
  const { threadId } = (await send(a, "Payout question", "launch")).body;

  const list = await as(s)("GET", "/galaxy/support");
  const row = list.body.threads.find((r: { id: string }) => r.id === threadId);
  assert.equal(row.app, "launch");
  assert.equal(row.status, "open");
  assert.equal(row.preview, "Payout question");
  assert.equal(row.person.name, "Arjun Mehta");
  assert.match(row.person.phone, /^\+91 ••••••\d{4}$/);
  assert.equal((await as(s)("GET", "/galaxy/support?status=nope")).status, 400);
  assert.equal((await as(s)("GET", `/galaxy/support/${crypto.randomUUID()}`)).status, 404);

  assert.equal((await as(s)("POST", `/galaxy/support/${threadId}/reply`, { body: " " })).status, 400);
  t.tick(1000);
  const r = await as(s)("POST", `/galaxy/support/${threadId}/reply`, { body: "Payouts go every Monday." });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "answered");
  assert.deepEqual(r.body.messages.map((m: { from: string; name: string | null }) => [m.from, m.name]), [
    ["person", null],
    ["staff", "Meera"],
  ]);
  const notice = t.notices.filter((x) => x.kind === "supportReply").at(-1)!;
  assert.deepEqual(notice.to, { userId: a.me.id });
  assert.deepEqual(notice.data, { threadId, app: "launch" });
  const [item] = await t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, a.me.id), eq(inboxItems.kind, "supportReply")));
  assert.equal(item!.app, "launch");
  assert.deepEqual(item!.opens, { to: "help" });
  assert.ok((await t.db.select().from(auditLog).where(and(eq(auditLog.actorId, s.me.id), eq(auditLog.action, "support.reply")))).length);
  assert.equal((await as(s)("GET", "/galaxy/support?status=answered")).body.threads[0].id, threadId);
  assert.equal((await as(a)("GET", "/me/support?app=launch")).body.thread.messages.at(-1).body, "Payouts go every Monday.");

  // The person writes again: open again.
  await send(a, "Thanks, and the fee?", "launch");
  assert.equal((await as(s)("GET", `/galaxy/support/${threadId}`)).body.status, "open");

  // Closed: the next message starts a new thread; the old one can't reopen while that one is live.
  const closed = await as(s)("POST", `/galaxy/support/${threadId}/status`, { status: "closed" });
  assert.equal(closed.body.status, "closed");
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.action, "support.close"))).length, 1);
  assert.equal((await as(s)("POST", `/galaxy/support/${threadId}/status`, { status: "answered" })).status, 400);
  const fresh = await send(a, "New question", "launch");
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.body.threadId, threadId);
  assert.equal((await as(a)("GET", "/me/support?app=launch")).body.thread.id, fresh.body.threadId);
  const refused = await as(s)("POST", `/galaxy/support/${threadId}/status`, { status: "open" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "newerThread");
  // A reply to it still goes, and it stays closed.
  t.tick(1000);
  assert.equal((await as(s)("POST", `/galaxy/support/${threadId}/reply`, { body: "Fee is 5%." })).body.status, "closed");

  // With the newer one closed, the old one reopens; a reply to a closed thread reopens it as answered.
  await as(s)("POST", `/galaxy/support/${fresh.body.threadId}/status`, { status: "closed" });
  assert.equal((await as(s)("POST", `/galaxy/support/${threadId}/status`, { status: "open" })).body.status, "open");
  await as(s)("POST", `/galaxy/support/${threadId}/status`, { status: "closed" });
  await as(s)("POST", `/galaxy/support/${fresh.body.threadId}/reply`, { body: "Answered." });
  const [again] = await t.db.select().from(supportThreads).where(eq(supportThreads.id, fresh.body.threadId));
  assert.equal(again!.status, "answered");
});

test("account deletion takes the person's threads and their messages", async () => {
  const s = await staff();
  const a = await join();
  const { threadId } = (await send(a, "Delete me after this")).body;
  await as(s)("POST", `/galaxy/support/${threadId}/reply`, { body: "Done." });
  await t.db.update(users).set({ deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, a.me.id));
  assert.equal(await runDeletions(t.db, async () => {}, t.now()), 1);
  assert.equal((await t.db.select().from(supportThreads).where(eq(supportThreads.userId, a.me.id))).length, 0);
  assert.equal((await t.db.select().from(supportMessages).where(eq(supportMessages.threadId, threadId))).length, 0);
});
