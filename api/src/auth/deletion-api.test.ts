import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { testApp } from "../testkit.ts";
import { hosts, legalAcceptances, sessions, staffGrants, teamRoles, users } from "../db/schema.ts";
import { runDeletions } from "./deletion.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const MIN = 60_000, DAY = 24 * 60 * MIN;
let n = 0;
const phone = () => `6${String(4_000_000 + ++n * 17).padStart(9, "0")}`;
const email = () => `d${++n}@example.com`;

const verify = async (to: string, extra: object = {}) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(to.includes("@") ? to : `+91${to}`), device, ...extra });
};
type A = { p: string; access: string; device: string; me: { id: string }; email?: string };
const join = async (withEmail = false) => {
  const p = phone();
  const v = await verify(p);
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  const a = { p, ...s.body } as A;
  if (withEmail) {
    a.email = email();
    await t.db.update(users).set({ email: a.email, emailVerifiedAt: new Date() }).where(eq(users.id, a.me.id));
  }
  return a;
};
const as = (access: string) => (m: string, path: string, body?: unknown) => t.call(m, path, body, access);
const signBackIn = async (a: A) => (await verify(a.p, { device: { ...device, id: a.device } })).body.access as string;
const row = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0]!;
const run = () => runDeletions(t.db, async (x) => void t.notices.push(x), t.now());
const hostOf = async (a: A) => (await as(a.access)("POST", "/hosts", { name: "Club", kind: "other", city: "Hyderabad" })).body;
const request = async (a: A) => as(a.access)("POST", "/me/deletion");
const statusOf = async (id: string) => (await t.db.select().from(hosts).where(eq(hosts.id, id)))[0]!.status;

test("the deletion screen", async () => {
  const a = await join();
  const r = await as(a.access)("GET", "/me/deletion");
  assert.equal(r.status, 200);
  for (const k of ["deleted", "scrubbed", "kept"]) assert.ok(r.body[k].length > 0, k);
  assert.deepEqual(r.body.blockers, []);
});

test("blockers: an owned host; the only Staff holder", async () => {
  const a = await join();
  const h = await hostOf(a);
  const g = await as(a.access)("GET", "/me/deletion");
  assert.equal(g.body.blockers[0].kind, "ownsHost");
  assert.equal(g.body.blockers[0].hostId, h.id);
  const p = await request(a);
  assert.equal(p.status, 409);
  assert.equal(p.body.error, "blocked");

  const o = await join();
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.platformOwner, true));
  await t.db.update(users).set({ platformOwner: true }).where(eq(users.id, o.me.id));
  assert.deepEqual((await as(o.access)("GET", "/me/deletion")).body.blockers, [{ kind: "onlyStaffHolder" }]);
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.id, o.me.id));
});

test("request: needs fresh, ends sessions, then pending", async () => {
  const a = await join();
  t.tick(11 * MIN);
  const stale = await request(a);
  assert.equal(stale.status, 403);
  assert.equal(stale.body.error, "needsFresh");
  const access = await signBackIn(a); // a code sign-in is fresh
  const r = await as(access)("POST", "/me/deletion");
  assert.equal(r.status, 200);
  assert.equal(r.body.dueAt, new Date(t.now() + 30 * DAY).toISOString());
  assert.equal((await as(access)("GET", "/me")).status, 401);
  assert.equal((await as(a.access)("GET", "/me")).status, 401);
  assert.ok(t.notices.some((x) => x.kind === "deletionScheduled" && (x.to as any).userId === a.me.id));
  const again = await as(await signBackIn(a))("POST", "/me/deletion");
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "pending");
});

test("keep my account", async () => {
  const a = await join();
  await request(a);
  const back = as(await signBackIn(a));
  assert.ok((await back("GET", "/me")).body.deletionDue);
  assert.equal((await back("POST", "/me/deletion/keep")).status, 200);
  assert.equal((await back("GET", "/me")).body.deletionDue, null);
  const second = await back("POST", "/me/deletion/keep");
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "notPending");
});

test("day 30: scrubbed, sessions gone, legal rows stay, number free again", async () => {
  const a = await join(true);
  const legal = (await t.db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, a.me.id))).length;
  await request(a);
  t.tick(30 * DAY + MIN);
  assert.ok((await run()) >= 1); // earlier tests' pending accounts fall due too
  const u = await row(a.me.id);
  assert.ok(u.deletedAt);
  for (const k of ["name", "phone", "email", "dob"] as const) assert.equal(u[k], null, k);
  assert.equal((await t.db.select().from(sessions).where(eq(sessions.userId, a.me.id))).length, 0);
  assert.equal((await t.db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, a.me.id))).length, legal);
  assert.ok(legal > 0);
  assert.ok(t.notices.some((x) => x.kind === "accountDeleted" && (x.to as any).contact === a.email));
  assert.equal((await verify(a.p)).body.step, "aboutYou");
  assert.equal(await run(), 0);

  const b = await join(); // no email: the last word goes to the phone
  await request(b);
  t.tick(30 * DAY + MIN);
  await run();
  assert.ok(t.notices.some((x) => x.kind === "accountDeleted" && (x.to as any).contact === `+91${b.p}`));
});

test("blocked on day 30", async () => {
  const a = await join();
  await request(a);
  const [h] = await t.db.insert(hosts).values({ name: "Late", slug: `late-${n++}`, kind: "other", city: "Hyderabad", ownerId: a.me.id, createdBy: a.me.id }).returning();
  assert.ok(h);
  t.tick(30 * DAY + MIN);
  assert.equal(await run(), 0);
  assert.ok(t.notices.some((x) => x.kind === "deletionBlocked" && (x.to as any).userId === a.me.id));
  const u = await row(a.me.id);
  assert.equal(u.deletedAt, null);
  assert.equal(u.phone, `+91${a.p}`);
});

const deletedNotices = (contact: string) => t.notices.filter((x) => x.kind === "accountDeleted" && (x.to as any).contact === contact).length;

test("a kept account is skipped, and two runs at once delete once", async () => {
  const a = await join(true);
  await request(a);
  const back = as(await signBackIn(a));
  assert.equal((await back("POST", "/me/deletion/keep")).status, 200); // Keep wins before the sweep's turn
  t.tick(30 * DAY + MIN);
  await run();
  assert.equal((await row(a.me.id)).deletedAt, null);
  assert.equal((await row(a.me.id)).phone, `+91${a.p}`);

  const b = await join(true);
  await request(b);
  t.tick(30 * DAY + MIN);
  await Promise.all([run(), run()]);
  assert.ok((await row(b.me.id)).deletedAt);
  assert.equal(deletedNotices(b.email!), 1);
});

test("a blocker on day 30 cancels the request, with one notice", async () => {
  const a = await join();
  await request(a);
  await t.db.insert(hosts).values({ name: "Late", slug: `late-${n++}`, kind: "other", city: "Hyderabad", ownerId: a.me.id, createdBy: a.me.id });
  t.tick(30 * DAY + MIN);
  await run();
  const count = () => t.notices.filter((x) => x.kind === "deletionBlocked" && (x.to as any).userId === a.me.id).length;
  assert.equal(count(), 1);
  assert.equal((await row(a.me.id)).deletionDueAt, null);
  assert.equal((await as(await signBackIn(a))("GET", "/me")).body.deletionDue, null);
  await run();
  assert.equal(count(), 1);
});

test("the scrub reaches roles, suspension reason, waiting grants and ownership", async () => {
  const owner = await join(true), holder = await join(), b = await join(), c = await join();
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.platformOwner, true));
  await t.db.update(users).set({ platformOwner: true, suspensionReason: "old reason" }).where(eq(users.id, owner.me.id));
  await t.db.insert(staffGrants).values({ userId: holder.me.id, feature: "staff", addedBy: holder.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  const h = await hostOf(b);
  const inv = await as(b.access)("POST", `/hosts/${h.id}/team`, { to: owner.p });
  await as(owner.access)("POST", `/invites/${inv.body.id}/accept`);
  await as(b.access)("POST", `/hosts/${h.id}/team/${inv.body.id}/confirm`);
  const [waiting] = await t.db.insert(staffGrants).values({ userId: c.me.id, feature: "hosts", addedBy: owner.me.id, addedAt: new Date(t.now()) }).returning();

  assert.equal((await request(owner)).status, 200);
  t.tick(30 * DAY + MIN);
  await run();
  const seats = await t.db.select().from(teamRoles).where(eq(teamRoles.userId, owner.me.id));
  assert.ok(seats.length > 0 && seats.every((s) => s.contact === "deleted"));
  const u = await row(owner.me.id);
  assert.equal(u.suspensionReason, null);
  assert.equal(u.platformOwner, false);
  assert.ok((await t.db.select().from(staffGrants).where(eq(staffGrants.id, waiting!.id)))[0]!.endedAt);
});

test("invitees deleted on one host: invites end, contacts scrubbed", async () => {
  const owner = await join(), x = await join(), y = await join(), z = await join(true);
  const h = await hostOf(owner);
  const invs = [
    await as(owner.access)("POST", `/hosts/${h.id}/team`, { to: x.p }),
    await as(owner.access)("POST", `/hosts/${h.id}/team`, { to: y.p }),
    await as(owner.access)("POST", `/hosts/${h.id}/team`, { to: z.p }),
    await as(owner.access)("POST", `/hosts/${h.id}/team`, { to: z.email }),
  ];
  for (const i of invs) assert.equal(i.status, 201);
  for (const p of [x, y, z]) assert.equal((await request(p)).status, 200);
  t.tick(30 * DAY + MIN);
  await run();
  for (const p of [x, y, z]) assert.ok((await row(p.me.id)).deletedAt);
  for (const i of invs) {
    const [s] = await t.db.select().from(teamRoles).where(eq(teamRoles.id, i.body.id));
    assert.equal(s!.contact, "deleted");
    assert.ok(s!.endedAt);
    assert.equal(s!.endReason, "deleted");
  }
});

test("a held deletion tells the email once", async () => {
  const a = await join(true);
  const dev = { ...device, id: "dev-B" };
  const v = await verify(a.p, { device: dev });
  const c = await t.call("POST", "/auth/confirm", { ticket: v.body.ticket, me: true, device: dev });
  assert.equal((await as(c.body.access)("POST", "/me/deletion")).body.error, "held");
  const sent = t.notices.filter((x) => x.kind === "signInMethodChangeHeld" && (x.to as any).contact === a.email);
  assert.equal(sent.length, 1);
  assert.equal((sent[0]!.data as any).change, "delete");
});

test("a deleted account can't be given staff or suspended", async () => {
  const s = await join(), gone = await join();
  await t.db.insert(staffGrants).values(["staff", "people"].map((feature) => ({ userId: s.me.id, feature: feature as any, addedBy: s.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) })));
  await request(gone);
  t.tick(30 * DAY + MIN);
  await run();
  assert.ok((await row(gone.me.id)).deletedAt);
  const g = await as(s.access)("POST", "/galaxy/staff/grants", { userId: gone.me.id, features: ["hosts"], reason: "for the team" });
  assert.equal(g.status, 404);
  const sus = await as(s.access)("POST", `/galaxy/people/${gone.me.id}/suspend`, { reason: "why not", until: null });
  assert.equal(sus.status, 404);
});

test("a deleted Admin leaves a host with only a suspended Admin on hold", async () => {
  const owner = await join(), b = await join();
  const h = await hostOf(owner);
  const inv = await as(owner.access)("POST", `/hosts/${h.id}/team`, { to: b.p });
  await as(b.access)("POST", `/invites/${inv.body.id}/accept`);
  await as(owner.access)("POST", `/hosts/${h.id}/team/${inv.body.id}/confirm`);
  await t.db.update(users).set({ suspendedAt: new Date(t.now()), suspendedUntil: null }).where(eq(users.id, owner.me.id));
  assert.equal(await statusOf(h.id), "live");
  await request(b);
  t.tick(30 * DAY + MIN);
  assert.ok((await run()) >= 1);
  assert.equal(await statusOf(h.id), "suspended");
  assert.ok((await t.db.select().from(teamRoles).where(eq(teamRoles.userId, b.me.id)))[0]!.endReason === "deleted");
});
