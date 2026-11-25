import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import type { NoticeKind } from "@orbit/contract";
import { NotSent } from "./auth/senders.ts";
import { deliveries, inboxItems, users } from "./db/schema.ts";
import type { Notice } from "./http.ts";
import { emailFor, inboxFor } from "./notification-emails.ts";
import { pruneNotifications } from "./notifications.ts";
import { testApp } from "./testkit.ts";

// Notifications PR 1 against a real database: notify's rows, the worker's sends and retries, and the wording.
type Sent = { to: string; subject: string; text: string; html: string; replyTo?: string };
let mailed: Sent[] = [];
let sender: ((to: string, m: Omit<Sent, "to">) => Promise<void>) | null = null; // a test's own sender, else kept in `mailed`
let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp({ mail: async (to, m) => (sender ? sender(to, m) : void mailed.push({ to, ...m })) })));
after(() => t.close());
beforeEach(async () => {
  await t.db.delete(deliveries);
  await t.db.delete(inboxItems);
  mailed = [];
  sender = null;
});

const device = { name: "iPhone", client: "app" as const };
const MIN = 60_000, DAY = 24 * 60 * MIN;
let n = 0;
const phone = () => `6${String(4_000_000 + ++n * 17).padStart(9, "0")}`;
const email = () => `n${++n}@example.com`;
const key = (to: string) => (to.includes("@") ? to : `+91${to}`);
const verify = async (to: string, extra: object = {}) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(key(to)), device, ...extra });
};
type A = { p: string; access: string; me: { id: string }; email?: string };
// A new account by phone; `withEmail` puts a verified email on it.
const join = async (withEmail = false): Promise<A> => {
  const p = phone();
  const v = await verify(p);
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  const a: A = { p, ...s.body };
  if (withEmail) {
    a.email = email();
    await t.db.update(users).set({ email: a.email, emailVerifiedAt: new Date(t.now()) }).where(eq(users.id, a.me.id));
  }
  return a;
};
const inbox = (userId: string) => t.db.select().from(inboxItems).where(eq(inboxItems.userId, userId));
const rows = (kind: string) => t.db.select().from(deliveries).where(eq(deliveries.kind, kind));
const row = async (id: string) => (await t.db.select().from(deliveries).where(eq(deliveries.id, id)))[0]!;
const queue = async (to: Notice["to"], kind: NoticeKind = "accountLifted") => {
  await t.notify({ to, kind, data: {} });
  return (await rows(kind)).find((d) => d.status === "queued")!;
};

test("route to row: a sign-in change writes the inbox item, a queued email and a skipped push, then sends", async () => {
  const a = await join(true);
  t.tick(30_000);
  const np = phone();
  assert.equal((await t.call("POST", "/auth/code", { to: np })).status, 200); // a code to the new number
  const code = t.lastCode(key(np));
  assert.equal((await t.call("PUT", "/me/phone", { to: np, code }, a.access)).status, 200);

  const items = (await inbox(a.me.id)).filter((i) => i.kind === "signInMethodChanged");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.app, "orbit");
  assert.deepEqual(items[0]!.opens, { to: "security" });
  assert.equal(items[0]!.fromName, "Orbit");
  const sent = await rows("signInMethodChanged");
  const mail = sent.find((d) => d.channel === "email")!;
  assert.deepEqual([mail.status, mail.target, mail.inboxItemId], ["queued", a.email, items[0]!.id]);
  const push = sent.find((d) => d.channel === "push")!;
  assert.deepEqual([push.status, push.reason, push.target], ["skipped", "noDevice", ""]);

  assert.equal(await t.deliver(), 1);
  const after = await row(mail.id);
  assert.equal(after.status, "sent");
  assert.ok(after.sentAt);
  assert.equal(after.lockedUntil, null);
  assert.equal(mailed.length, 1);
  assert.equal(mailed[0]!.to, a.email);
  assert.equal(mailed[0]!.replyTo, "hello@heyorbit.in");
  assert.equal(mailed[0]!.subject, "Your Orbit sign-in changed");
});

test("dedupe: the same key twice writes and sends once; no key writes twice", async () => {
  const a = await join(true);
  const n1: Notice = { to: { userId: a.me.id }, kind: "signInMethodChanged", data: { method: "passkey", change: "added" }, key: "pk-1" };
  await t.notify(n1);
  await t.notify(n1);
  assert.equal((await inbox(a.me.id)).length, 1);
  assert.equal((await rows("signInMethodChanged")).filter((d) => d.channel === "email").length, 1);
  await t.deliver();
  await t.deliver();
  assert.equal(mailed.length, 1);

  const { key: _, ...unkeyed } = n1;
  await t.notify(unkeyed);
  await t.notify(unkeyed);
  assert.equal((await inbox(a.me.id)).length, 3);
  assert.equal((await rows("signInMethodChanged")).filter((d) => d.channel === "email").length, 3);
});

test("recipients: a phone contact, an unknown email, a deleted account, an unproved email", async () => {
  const b = await join();
  await t.notify({ to: { contact: `+91${b.p}` }, kind: "signInMethodChanged", data: { method: "email", change: "added" } });
  assert.equal((await inbox(b.me.id)).length, 1);
  const mail = (await rows("signInMethodChanged")).find((d) => d.channel === "email")!;
  assert.deepEqual([mail.status, mail.reason, mail.userId, mail.contact], ["skipped", "noEmail", b.me.id, `+91${b.p}`]);

  await t.notify({ to: { contact: "nobody@example.com" }, kind: "teamInvite", data: { hostName: "Hyderabad Runners", role: "admin" } });
  const invite = await rows("teamInvite");
  assert.equal(invite.length, 1); // no push row: nobody to push to
  assert.deepEqual([invite[0]!.status, invite[0]!.target, invite[0]!.userId], ["queued", "nobody@example.com", null]);
  assert.equal((await t.db.select().from(inboxItems).where(eq(inboxItems.kind, "teamInvite"))).length, 0);

  const gone = await join(true);
  await t.db.update(users).set({ deletedAt: new Date(t.now()) }).where(eq(users.id, gone.me.id));
  await t.notify({ to: { userId: gone.me.id }, kind: "accountLifted", data: {} });
  assert.equal((await rows("accountLifted")).length, 0);

  const unproved = await join();
  await t.db.update(users).set({ email: email(), emailVerifiedAt: null }).where(eq(users.id, unproved.me.id));
  await t.notify({ to: { userId: unproved.me.id }, kind: "accountLifted", data: {} });
  const lifted = await rows("accountLifted");
  assert.deepEqual([lifted.length, lifted[0]!.status, lifted[0]!.reason], [1, "skipped", "noEmail"]);
});

test("account state: a suspended account gets Must kinds only", async () => {
  const a = await join(true);
  await t.db.update(users).set({ suspendedAt: new Date(t.now()), suspendedUntil: null }).where(eq(users.id, a.me.id));
  await t.notify({ to: { userId: a.me.id }, kind: "accountSuspended", data: { until: null, reason: "Spam" } });
  assert.equal((await rows("accountSuspended"))[0]!.status, "queued");
  await t.notify({ to: { userId: a.me.id }, kind: "teamRoleStarted", data: { hostName: "Hyderabad Runners", role: "crew" } });
  const started = await rows("teamRoleStarted");
  assert.deepEqual(started.map((d) => [d.channel, d.status, d.reason]), [["email", "skipped", "accountState"]]);
  assert.equal((await inbox(a.me.id)).length, 0);

  // Waiting for deletion counts too.
  const b = await join(true);
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now()) }).where(eq(users.id, b.me.id));
  await t.notify({ to: { userId: b.me.id }, kind: "teamLeft", data: { hostName: "Hyderabad Runners", name: "Asha" } });
  assert.equal((await rows("teamLeft"))[0]!.reason, "accountState");
});

test("retries: refused fails at once, not set up skips, throttled and unknown retry after 1, 5, 30 minutes then fail", async () => {
  const a = await join(true);
  const failWith = (reason: NotSent["reason"]) => (sender = async () => { throw new NotSent("email", reason, `554 rejected ${a.email}`); });

  failWith("refused");
  let d = await queue({ userId: a.me.id });
  await t.deliver();
  assert.deepEqual([(await row(d.id)).status, (await row(d.id)).reason, (await row(d.id)).tries], ["failed", "refused", 1]);

  await t.db.delete(deliveries);
  failWith("notSetUp");
  d = await queue({ userId: a.me.id });
  await t.deliver();
  assert.deepEqual([(await row(d.id)).status, (await row(d.id)).reason], ["skipped", "notSetUp"]);

  for (const reason of ["throttled", "unknown"] as const) {
    await t.db.delete(deliveries);
    failWith(reason);
    d = await queue({ userId: a.me.id });
    for (const [i, wait] of [1, 5, 30].entries()) {
      await t.deliver();
      const r = await row(d.id);
      assert.deepEqual([r.status, r.tries, r.runAt.getTime()], ["queued", i + 1, t.now() + wait * MIN], `${reason} try ${i + 1}`);
      assert.equal(await t.deliver(), 0); // not due yet
      t.tick(wait * MIN);
    }
    await t.deliver();
    const r = await row(d.id);
    assert.deepEqual([r.status, r.reason, r.tries], ["failed", reason, 4]);
  }

  // Any other error counts as unknown.
  await t.db.delete(deliveries);
  sender = async () => { throw new Error("socket hang up"); };
  d = await queue({ userId: a.me.id });
  await t.deliver();
  assert.deepEqual([(await row(d.id)).status, (await row(d.id)).reason], ["queued", "unknown"]);
});

test("a row stuck in sending is claimed again once its lock has passed, not before", async () => {
  const a = await join(true);
  const d = await queue({ userId: a.me.id });
  await t.db.update(deliveries).set({ status: "sending", lockedUntil: new Date(t.now() + MIN) }).where(eq(deliveries.id, d.id));
  assert.equal(await t.deliver(), 0);
  assert.equal((await row(d.id)).status, "sending");
  await t.db.update(deliveries).set({ lockedUntil: new Date(t.now() - 1000) }).where(eq(deliveries.id, d.id));
  assert.equal(await t.deliver(), 1);
  assert.equal((await row(d.id)).status, "sent");
  assert.equal(mailed.length, 1);
});

test("rollback: a notice written in a transaction goes with it", async () => {
  const a = await join(true);
  await assert.rejects(
    t.db.transaction(async (tx) => {
      await t.notify({ to: { userId: a.me.id }, kind: "signInMethodChanged", data: { method: "google", change: "added" } }, tx);
      throw new Error("rolled back");
    }),
    /rolled back/,
  );
  assert.equal((await inbox(a.me.id)).length, 0);
  assert.equal((await rows("signInMethodChanged")).length, 0);
  assert.equal(await t.deliver(), 0);
  assert.equal(mailed.length, 0);
});

test("concurrency: three workers at once send each of 50 emails exactly once", async () => {
  for (let i = 0; i < 50; i++) await t.notify({ to: { contact: `c${i}@example.com` }, kind: "accountLifted", data: {} });
  sender = async (to, m) => {
    await new Promise((r) => setTimeout(r, 2));
    mailed.push({ to, ...m });
  };
  while ((await Promise.all([t.deliver(), t.deliver(), t.deliver()])).some((x) => x > 0));
  assert.equal(mailed.length, 50);
  assert.equal(new Set(mailed.map((m) => m.to)).size, 50);
  const all = await rows("accountLifted");
  assert.ok(all.every((d) => d.status === "sent" && d.tries === 1));
});

test("welcome: once on sign-up with an email; recorded as undelivered by phone alone", async () => {
  const e = email(), p = phone();
  const v = await verify(e);
  assert.equal(v.body.step, "phone");
  const v2 = await verify(p, { signup: v.body.signup });
  assert.equal(v2.body.step, "aboutYou");
  const s = await t.call("POST", "/auth/signup", { signup: v2.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  const w = (await rows("welcome")).filter((d) => d.userId === s.body.me.id);
  assert.deepEqual(w.map((d) => [d.channel, d.status, d.target]), [["email", "queued", e]]);
  assert.equal(w[0]!.dedupeKey, `welcome:${s.body.me.id}:welcome`);
  await t.deliver();
  assert.equal(mailed.find((m) => m.to === e)?.subject, "Welcome to Orbit");

  const b = await join();
  const bw = (await rows("welcome")).filter((d) => d.userId === b.me.id);
  assert.deepEqual(bw.map((d) => [d.status, d.reason]), [["skipped", "noEmail"]]);
});

test("cleanup: inbox items and deliveries over 180 days old go", async () => {
  const a = await join();
  const at = (days: number) => new Date(t.now() - days * DAY);
  for (const days of [181, 179]) {
    const [item] = await t.db
      .insert(inboxItems)
      .values({ userId: a.me.id, app: "orbit", kind: "accountLifted", type: "account", fromName: "Orbit", text: "x", dedupeKey: `old-${days}`, createdAt: at(days) })
      .returning();
    await t.db.insert(deliveries).values({ kind: "accountLifted", channel: "email", dedupeKey: `old-${days}`, payload: {}, status: "sent", runAt: at(days), createdAt: at(days), inboxItemId: item!.id });
  }
  await pruneNotifications(t.db, t.now());
  assert.deepEqual((await rows("accountLifted")).map((d) => d.dedupeKey), ["old-179"]);
  assert.deepEqual((await t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, a.me.id), eq(inboxItems.kind, "accountLifted")))).map((i) => i.dedupeKey), ["old-179"]);
});

// The data each call site passes today (build plan section 8).
const SAMPLES: Partial<Record<NoticeKind, Record<string, unknown>>> = {
  welcome: { name: "Riya" },
  signInMethodChanged: { method: "passkey", change: "added", name: "iPhone" },
  signInMethodChangeHeld: { method: "account", change: "delete", until: "2026-12-03T10:00:00.000Z" },
  phoneMovedAway: { phone: "+919876543210" },
  deletionScheduled: { dueAt: "2026-12-26T10:00:00.000Z" },
  deletionCancelled: {},
  deletionBlocked: { blockers: [{ kind: "onlyStaffHolder" }] },
  accountDeleted: {},
  accountSuspended: { until: null, reason: "Spam" },
  accountLifted: {},
  teamInvite: { seatId: "s", hostId: "h", hostName: "Hyderabad Runners", role: "admin" },
  teamInviteWithdrawn: { hostId: "h", hostName: "Hyderabad Runners", contact: "+919876543210" },
  teamAccepted: { seatId: "s", hostId: "h", name: "Asha" },
  teamRoleStarted: { hostId: "h", hostName: "Hyderabad Runners", role: "crew" },
  teamRemoved: { hostId: "h", hostName: "Hyderabad Runners" },
  teamLeft: { hostId: "h", hostName: "Hyderabad Runners", name: "Asha" },
  hostStatus: { hostId: "h", hostName: "Hyderabad Runners", status: "paused" },
  hostVerified: { hostId: "h", hostName: "Hyderabad Runners" },
  hostUnverified: { hostId: "h", hostName: "Hyderabad Runners", reason: "Docs expired" },
  hostSuspended: { hostId: "h", hostName: "Hyderabad Runners", reason: "Reports" },
  hostLifted: { hostId: "h", hostName: "Hyderabad Runners" },
  hostParentSet: { hostId: "h", hostName: "Hyderabad Runners", parentId: "p", parentName: "Runners India" },
  slotReleased: { claimId: "c", hostId: "h", hostName: "Turf 9", start: "2026-11-26T12:30:00.000Z" },
  staffGrantAdded: { userId: "u", features: ["people", "hosts"], reason: "New hire", by: "b", startsAt: null, grants: ["g"] },
  staffGrantStarted: { userId: "u", feature: "people", reason: "New hire", by: "b" },
  staffGrantEnded: { userId: "u", feature: "people", reason: "Left", by: "b" },
  staffRiskyAction: { action: "people.suspend", userId: "u", reason: "Spam", by: "b" },
  staffHeavyPaging: { by: "b", pages: 200 },
};

test("wording: every called kind builds a subject, text and html; data is escaped; never an id", () => {
  for (const [kind, data] of Object.entries(SAMPLES) as [NoticeKind, Record<string, unknown>][]) {
    const e = emailFor(kind, data);
    assert.ok(e.subject && e.subject !== "A message from Orbit", kind);
    assert.ok(!/undefined|null|\[object|!/.test(e.subject + e.text), `${kind}: ${e.text}`);
    assert.ok(e.text.startsWith(e.subject) && e.text.includes("Terms: https://heyorbit.in/terms"), kind);
    assert.ok(e.html.startsWith("<!doctype html>") && !e.html.includes("See the role"), kind);
    assert.equal(e.replyTo, "hello@heyorbit.in");
    for (const id of ["seatId", "hostId", "userId", "by", "claimId", "parentId"]) {
      if (typeof data[id] === "string") assert.ok(!e.text.includes(` ${data[id]} `), `${kind} prints ${id}`);
    }
  }
  assert.match(emailFor("staffRiskyAction", SAMPLES.staffRiskyAction).text, /staff access on Orbit/);
  assert.match(emailFor("accountLifted").text, /can’t be switched off/);
  assert.match(emailFor("phoneMovedAway", SAMPLES.phoneMovedAway).text, /ending in 3210 /);
  assert.ok(!emailFor("phoneMovedAway", SAMPLES.phoneMovedAway).text.includes("9876543210"));
  assert.equal(emailFor("deletionScheduled", SAMPLES.deletionScheduled).subject, "Your Orbit account will be deleted on 26 Dec");
  assert.equal(emailFor("hostParentSet", { hostName: "Club" }).subject, "Club is no longer part of another host");
  assert.equal(emailFor("bookingConfirmed", {}).subject, "A message from Orbit"); // a kind with no wording yet

  const evil = "<script>alert(1)</script>";
  for (const e of [emailFor("hostSuspended", { hostName: evil, reason: evil }), emailFor("accountSuspended", { reason: evil })]) {
    assert.ok(!e.html.includes("<script>"));
    assert.ok(e.html.includes("&#60;script&#62;"));
  }
  assert.deepEqual(inboxFor("teamRemoved", SAMPLES.teamRemoved), { text: "You no longer have access to this team.", fromName: "Hyderabad Runners", opens: null });
  assert.deepEqual(inboxFor("hostVerified", SAMPLES.hostVerified).text, "Hyderabad Runners is verified");
});
