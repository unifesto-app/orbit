import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { testApp } from "../testkit.ts";
import { auditLog, hosts, staffGrants, teamRoles, users } from "../db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(2_000_000 + ++n * 11).padStart(9, "0")}`;
const e164 = (p: string) => `+91${p}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

const verify = async (to: string, extra: object = {}) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(e164(to)), device, ...extra });
};
const join = async (p = phone()) => {
  const v = await verify(p);
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const me = async (u: P) => (await as(u)("GET", "/me", undefined)).body;
const startHost = async (u: P) => (await as(u)("POST", "/hosts", { name: "Punchline Collective", kind: "comedy-group", city: "Hyderabad" })).body;
// Only one platform owner may exist, so hand it over.
const makeOwner = async (u: P) => {
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.platformOwner, true));
  await t.db.update(users).set({ platformOwner: true }).where(eq(users.id, u.me.id));
};
const give = async (u: P, ...features: string[]) => {
  for (const feature of features as any[])
    await t.db.insert(staffGrants).values({ userId: u.me.id, feature, addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
};
const audits = async (action: string) => (await t.db.select().from(auditLog)).filter((a) => a.action === action);
// Adds a confirmed Admin to a host: invite, accept, confirm.
const addAdmin = async (owner: P, hostId: string, who: P) => {
  const inv = await as(owner)("POST", `/hosts/${hostId}/team`, { to: who.p });
  assert.equal((await as(who)("POST", `/invites/${inv.body.id}/accept`)).status, 200);
  assert.equal((await as(owner)("POST", `/hosts/${hostId}/team/${inv.body.id}/confirm`)).status, 200);
  return inv.body.id as string;
};

test("start a host", async () => {
  const a = await join();
  const bad = [{ kind: "nope", city: "Hyderabad" }, { kind: "comedy-group", city: "Atlantis" }];
  for (const b of bad) assert.equal((await as(a)("POST", "/hosts", { name: "X", ...b })).status, 400);
  const h = await startHost(a);
  assert.match(h.slug, /^punchline-collective-[0-9a-f]{6}$/);
  assert.deepEqual((await me(a)).teams, [{ hostId: h.id, owner: true, admin: true, events: {} }]);
  for (let i = 0; i < 4; i++) assert.equal((await as(a)("POST", "/hosts", { name: "More", kind: "other", city: "Hyderabad" })).status, 201);
  const r = await as(a)("POST", "/hosts", { name: "Sixth", kind: "other", city: "Hyderabad" });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "tooMany");
});

test("admin invite by phone: accept, then confirm", async () => {
  const a = await join(), b = await join();
  const h = await startHost(a);
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: b.p });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.status, "waiting");
  assert.ok(t.notices.some((x) => x.kind === "teamInvite" && (x.to as any).contact === e164(b.p)));
  assert.equal((await as(b)("GET", "/me/invites")).body.length, 1);
  assert.equal((await as(b)("POST", `/invites/${inv.body.id}/accept`)).body.status, "accepted");
  assert.deepEqual((await me(b)).teams, []);
  assert.ok(t.notices.some((x) => x.kind === "teamAccepted" && (x.to as any).userId === a.me.id));
  assert.equal((await as(a)("POST", `/hosts/${h.id}/team/${inv.body.id}/confirm`)).status, 200);
  assert.deepEqual((await me(b)).teams, [{ hostId: h.id, owner: false, admin: true, events: {} }]);
});

test("invite responses don't reveal accounts", async () => {
  const a = await join(), b = await join();
  const h = await startHost(a);
  const on = await as(a)("POST", `/hosts/${h.id}/team`, { to: b.p });
  const off = await as(a)("POST", `/hosts/${h.id}/team`, { to: phone() });
  const strip = ({ id, contact, ...rest }: any) => rest;
  assert.equal(on.status, off.status);
  assert.deepEqual(strip(on.body), strip(off.body));
});

test("who can do what on a team", async () => {
  const a = await join(), b = await join(), c = await join(), d = await join();
  const h = await startHost(a);
  await addAdmin(a, h.id, b);
  assert.equal((await as(c)("POST", `/hosts/${h.id}/team`, { to: phone() })).status, 404); // not on the team
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: c.p });
  const wrong = await as(d)("POST", `/invites/${inv.body.id}/accept`);
  assert.equal(wrong.status, 404);
  assert.equal(wrong.body.error, "notFound");
  assert.equal((await as(c)("POST", `/invites/${inv.body.id}/accept`)).status, 200);
  assert.equal((await as(b)("POST", `/hosts/${h.id}/team/${inv.body.id}/confirm`)).status, 404); // another Admin, not the adder
  assert.deepEqual((await me(c)).teams, []);
});

test("an invite expires after 14 days; re-inviting works", async () => {
  const a = await join(), b = await join();
  const h = await startHost(a);
  const old = await as(a)("POST", `/hosts/${h.id}/team`, { to: b.p });
  t.tick(14 * DAY + 1);
  const acc = await as(b)("POST", `/invites/${old.body.id}/accept`);
  assert.equal(acc.status, 409);
  const again = await as(a)("POST", `/hosts/${h.id}/team`, { to: b.p });
  assert.equal(again.status, 201);
  const [row] = await t.db.select().from(teamRoles).where(eq(teamRoles.id, old.body.id));
  assert.equal(row!.endReason, "expired");
});

test("removal and leaving", async () => {
  const a = await join(), b = await join(), c = await join();
  const h = await startHost(a);
  const sb = await addAdmin(a, h.id, b);
  await addAdmin(a, h.id, c);
  const seatA = (await t.db.select().from(teamRoles).where(eq(teamRoles.userId, a.me.id)))[0]!.id;
  const own = await as(b)("DELETE", `/hosts/${h.id}/team/${seatA}`);
  assert.equal(own.status, 403);
  assert.equal(own.body.error, "owner");
  const left = await as(a)("POST", `/hosts/${h.id}/leave`);
  assert.equal(left.status, 403);
  assert.equal(left.body.error, "owner");
  assert.equal((await as(c)("DELETE", `/hosts/${h.id}/team/${sb}`)).status, 204);
  assert.ok(t.notices.some((x) => x.kind === "teamRemoved" && (x.to as any).userId === b.me.id));
  assert.deepEqual((await me(b)).teams, []);
  assert.equal((await as(c)("POST", `/hosts/${h.id}/leave`)).status, 204);
  assert.deepEqual((await me(c)).teams, []);
});

test("staff: owner's grants start after 24 h; others' need a third holder", async () => {
  const owner = await join(), x = await join(), y = await join(), z = await join();
  await makeOwner(owner);
  const g = await as(owner)("POST", "/galaxy/staff/grants", { userId: x.me.id, features: ["staff", "people"], reason: "for the team" });
  assert.equal(g.status, 201);
  assert.equal((await me(x)).staff, null);
  t.tick(DAY + 1);
  assert.deepEqual((await me(x)).staff.features.sort(), ["people", "staff"]);

  // x (Staff) gives z a feature: waits for a confirm
  const gz = await as(x)("POST", "/galaxy/staff/grants", { userId: z.me.id, features: ["hosts"], reason: "for the team" });
  assert.equal(gz.body[0].status, "waitingConfirm");
  const id = gz.body[0].id;
  assert.equal((await as(x)("POST", `/galaxy/staff/grants/${id}/confirm`, { reason: "checked it" })).body.error, "self");
  await give(z, "staff"); // z holds Staff, but is the person
  const zs = await as(z)("POST", `/galaxy/staff/grants/${id}/confirm`, { reason: "checked it" });
  assert.equal(zs.status, 403);
  assert.equal(zs.body.error, "self");
  await give(y, "staff");
  assert.equal((await as(y)("POST", `/galaxy/staff/grants/${id}/confirm`, { reason: "checked it" })).status, 200);
  assert.ok((await me(z)).staff.features.includes("hosts"));

  assert.equal((await as(y)("DELETE", `/galaxy/staff/grants/${id}`, { reason: "left the team" })).status, 204);
  assert.ok(!(await me(z)).staff.features.includes("hosts"));

  const nobody = await join();
  assert.equal((await as(nobody)("GET", "/galaxy/staff")).status, 404);
  for (const a of ["staff.grant", "staff.confirm", "staff.end"]) assert.ok((await audits(a)).length >= 1, a);
});

test("people: suspend and lift", async () => {
  const owner = await join(), staff = await join(), a = await join(), b = await join(), peopleOnly = await join();
  await makeOwner(owner);
  await give(staff, "people", "staff");
  await give(peopleOnly, "people");
  const sole = await startHost(a);
  const shared = await startHost(a);
  await addAdmin(a, shared.id, b);
  const s = as(staff);
  assert.equal((await s("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "", until: null })).status, 400);
  const r = await s("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "fraud report", until: null });
  assert.equal(r.status, 200);
  const dead = await as(a)("GET", "/me");
  assert.equal(dead.status, 403);
  assert.equal(dead.body.error, "suspended");
  const status = async (id: string) => (await t.db.select().from(hosts).where(eq(hosts.id, id)))[0]!.status;
  assert.equal(await status(sole.id), "suspended");
  assert.equal(await status(shared.id), "live");
  const sus = (await audits("people.suspend")).find((x) => x.targetUser === a.me.id);
  assert.equal(sus?.reason, "fraud report");

  assert.equal((await s("POST", `/galaxy/people/${a.me.id}/lift`, { reason: "cleared" })).status, 200);
  assert.equal(await status(sole.id), "live");
  assert.equal((await audits("people.lift")).find((x) => x.targetUser === a.me.id)?.reason, "cleared");

  const self = await s("POST", `/galaxy/people/${staff.me.id}/suspend`, { reason: "oops", until: null });
  assert.equal(self.body.error, "self");
  const own = await s("POST", `/galaxy/people/${owner.me.id}/suspend`, { reason: "coup", until: null });
  assert.equal(own.body.error, "owner");
  const ns = await as(peopleOnly)("POST", `/galaxy/people/${staff.me.id}/suspend`, { reason: "nope", until: null });
  assert.equal(ns.status, 403);
  assert.equal(ns.body.error, "needsStaff");
  // The audit log records actions taken; a refused attempt changes nothing and writes nothing.
  assert.equal((await audits("people.suspend")).length, 1);
});

test("people: search", async () => {
  const staff = await join(), other = await join(), nobody = await join();
  await give(staff, "people");
  const r = await as(staff)("GET", `/galaxy/people?q=${encodeURIComponent(e164(other.p))}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].id, other.me.id);
  assert.equal(r.body[0].phone, e164(other.p));
  assert.equal((await audits("people.search")).length, 1);
  const lite = await join();
  await give(lite, "staff");
  const m = await as(lite)("GET", `/galaxy/people?q=${encodeURIComponent(e164(other.p))}`);
  assert.equal(m.body[0].phone, `+91 ••••••${other.p.slice(-4)}`);
  assert.equal((await as(staff)("GET", "/galaxy/people?q=ab")).status, 400);
  assert.equal((await as(nobody)("GET", "/galaxy/people?q=abcdef")).status, 404);
});

test("people: list and detail", async () => {
  const staff = await join(), lite = await join(), nobody = await join(), a = await join(), gone = await join();
  await give(staff, "people");
  await give(lite, "staff");
  await t.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.me.id));
  const l = await as(staff)("GET", "/galaxy/people");
  assert.equal(l.status, 200);
  assert.equal(l.body.page, 1);
  assert.ok(l.body.people.some((x: any) => x.id === a.me.id && x.phone === e164(a.p)));
  assert.ok(!l.body.people.some((x: any) => x.id === gone.me.id));
  assert.equal((await audits("people.list")).length, 1);
  for (const u of [lite, nobody]) {
    assert.equal((await as(u)("GET", "/galaxy/people")).status, 404);
    assert.equal((await as(u)("GET", `/galaxy/people/${a.me.id}`)).status, 404);
  }
  const d = await as(staff)("GET", `/galaxy/people/${a.me.id}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.phone, e164(a.p));
  assert.equal((await audits("people.view")).filter((x) => x.targetUser === a.me.id).length, 1);
  assert.equal((await audits("people.view")).length, 1);
  for (const id of [gone.me.id, "nope"]) {
    const r = await as(staff)("GET", `/galaxy/people/${id}`);
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "notFound");
  }
});

test("people: detail hides views, and staff access unless the viewer holds Staff", async () => {
  const owner = await join(), po = await join(), both = await join(), target = await join(), gone = await join();
  await makeOwner(owner);
  await give(po, "people");
  await give(both, "people", "staff");
  const first = await as(po)("GET", `/galaxy/people/${target.me.id}`);
  const second = await as(po)("GET", `/galaxy/people/${target.me.id}`);
  assert.equal(first.status, 200);
  assert.ok(!second.body.history.some((h: any) => h.action === "people.view"));
  assert.equal(second.body.staff, null);
  assert.equal(second.body.owner, null);

  const g = await as(owner)("POST", "/galaxy/staff/grants", { userId: target.me.id, features: ["hosts"], reason: "for the team" });
  assert.equal(g.status, 201);
  t.tick(DAY + 1);
  const full = await as(both)("GET", `/galaxy/people/${target.me.id}`);
  assert.ok(Array.isArray(full.body.staff));
  assert.ok(full.body.staff.includes("hosts"));
  assert.equal(full.body.owner, false);
  assert.ok(full.body.history.some((h: any) => h.action === "staff.grant"));
  assert.ok(!full.body.history.some((h: any) => h.action === "people.view"));
  const lite = await as(po)("GET", `/galaxy/people/${target.me.id}`);
  assert.ok(!lite.body.history.some((h: any) => h.action.startsWith("staff.")));
  assert.equal(lite.body.staff, null);

  await t.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.me.id));
  const found = await as(po)("GET", `/galaxy/people?q=${encodeURIComponent("Riya")}`);
  assert.equal(found.status, 200);
  assert.ok(!found.body.some((x: any) => x.id === gone.me.id));
  const byPhone = await as(both)("GET", `/galaxy/people?q=${encodeURIComponent(e164(gone.p))}`);
  assert.equal(byPhone.body.length, 0);
});

// ---------- after review ----------

const setStatus = (id: string, status: string) => t.db.update(hosts).set({ status: status as any }).where(eq(hosts.id, id));
const statusOf = async (id: string) => (await t.db.select().from(hosts).where(eq(hosts.id, id)))[0]!.status;
const grantIdOf = async (userId: string, feature: string) =>
  (await t.db.select().from(staffGrants).where(eq(staffGrants.userId, userId))).find((g) => g.feature === feature && !g.endedAt)!.id;

test("admins see who accepted", async () => {
  const a = await join(), b = await join();
  const h = await startHost(a);
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: b.p });
  assert.equal((await as(a)("GET", `/hosts/${h.id}/team`)).body.invites[0].acceptedBy, null);
  await as(b)("POST", `/invites/${inv.body.id}/accept`);
  assert.equal((await as(a)("GET", `/hosts/${h.id}/team`)).body.invites[0].acceptedBy, "Riya Kapoor");
});

test("one open place per person on a host", async () => {
  const a = await join(), x = await join();
  const mail = `x${++n}@example.com`;
  await t.db.update(users).set({ email: mail, emailVerifiedAt: new Date() }).where(eq(users.id, x.me.id));
  const h = await startHost(a);
  const byPhone = await as(a)("POST", `/hosts/${h.id}/team`, { to: x.p });
  const byMail = await as(a)("POST", `/hosts/${h.id}/team`, { to: mail });
  assert.equal((await as(x)("POST", `/invites/${byPhone.body.id}/accept`)).status, 200);
  const second = await as(x)("POST", `/invites/${byMail.body.id}/accept`);
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "onTeam");
  await as(a)("POST", `/hosts/${h.id}/team/${byPhone.body.id}/confirm`);
  assert.equal((await me(x)).teams.length, 1);
  assert.equal((await as(a)("DELETE", `/hosts/${h.id}/team/${byPhone.body.id}`)).status, 204);
  assert.equal((await as(x)("GET", `/hosts/${h.id}/team`)).status, 404);
});

test("suspension and hosts: two Admins, paused, timed", async () => {
  const staff = await join(), a = await join(), b = await join();
  await give(staff, "people");
  const s = as(staff);
  const h = await startHost(a);
  await addAdmin(a, h.id, b);
  await s("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "first", until: null });
  assert.equal(await statusOf(h.id), "live");
  await s("POST", `/galaxy/people/${b.me.id}/suspend`, { reason: "second", until: null });
  assert.equal(await statusOf(h.id), "suspended");

  const c = await join();
  const paused = await startHost(c);
  await setStatus(paused.id, "paused");
  await s("POST", `/galaxy/people/${c.me.id}/suspend`, { reason: "paused one", until: null });
  assert.equal(await statusOf(paused.id), "paused");
  await s("POST", `/galaxy/people/${c.me.id}/lift`, { reason: "back" });
  assert.equal(await statusOf(paused.id), "paused");

  const d = await join();
  const mine = await startHost(d);
  const until = new Date(t.now() + HOUR).toISOString();
  assert.equal((await s("POST", `/galaxy/people/${d.me.id}/suspend`, { reason: "cool off", until })).status, 200);
  assert.equal(await statusOf(mine.id), "suspended");
  t.tick(HOUR + 1);
  const back = await verify(d.p, { device: { ...device, id: (d as any).device } });
  assert.equal(back.body.step, "signedIn");
  assert.equal(await statusOf(mine.id), "live");
  assert.equal((await t.db.select().from(users).where(eq(users.id, d.me.id)))[0]!.suspendedAt, null);
});

test("hosts started at once meet the limit", async () => {
  const a = await join();
  const rs = await Promise.all(Array.from({ length: 8 }, () => as(a)("POST", "/hosts", { name: "Race", kind: "other", city: "Hyderabad" })));
  assert.equal(rs.filter((r) => r.status === 201).length, 5);
  assert.equal(rs.filter((r) => r.status === 429).length, 3);
});

test("three invites to one contact at once", async () => {
  const a = await join();
  const h = await startHost(a);
  const to = phone();
  const rs = await Promise.all([1, 2, 3].map(() => as(a)("POST", `/hosts/${h.id}/team`, { to })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409]);
  assert.ok(rs.filter((r) => r.status === 409).every((r) => r.body.error === "invited"));
});

test("bad ids are 404 JSON", async () => {
  const a = await join();
  const h = await startHost(a);
  for (const m of ["POST", "DELETE"]) {
    const r = await as(a)(m, `/hosts/${h.id}/team/not-a-uuid${m === "POST" ? "/confirm" : ""}`);
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "notFound");
  }
  const dashes = await as(a)("GET", `/hosts/${"-".repeat(36)}/team`);
  assert.equal(dashes.status, 404);
  assert.equal(dashes.body.error, "notFound");
  const nope = await as(a)("GET", "/nope");
  assert.equal(nope.status, 404);
  assert.equal(nope.body.error, "notFound");
});

test("ending Staff ends the waiting grants that person added", async () => {
  const x = await join(), y = await join(), w = await join(), z = await join();
  await give(x, "staff");
  await give(y, "staff");
  await give(w, "staff");
  const gz = await as(x)("POST", "/galaxy/staff/grants", { userId: z.me.id, features: ["hosts"], reason: "for the team" });
  assert.equal(gz.body[0].status, "waitingConfirm");
  assert.equal((await as(y)("DELETE", `/galaxy/staff/grants/${await grantIdOf(x.me.id, "staff")}`, { reason: "removed for cause" })).status, 204);
  const r = await as(w)("POST", `/galaxy/staff/grants/${gz.body[0].id}/confirm`, { reason: "checked it" });
  assert.equal(r.status, 409);
});

test("two DELETEs at once on one grant", async () => {
  const x = await join(), y = await join(), z = await join();
  await give(x, "staff");
  await give(y, "staff");
  const gz = await as(x)("POST", "/galaxy/staff/grants", { userId: z.me.id, features: ["hosts"], reason: "for the team" });
  const before = (await audits("staff.end")).length;
  const rs = await Promise.all([as(y), as(y)].map((f) => f("DELETE", `/galaxy/staff/grants/${gz.body[0].id}`, { reason: "no longer needed" })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [204, 409]);
  assert.equal(rs.find((r) => r.status === 409)!.body.error, "notOpen");
  assert.equal((await audits("staff.end")).length - before, 1);
});

test("a confirm after the invite lapsed", async () => {
  const a = await join(), b = await join();
  const h = await startHost(a);
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: b.p });
  await as(b)("POST", `/invites/${inv.body.id}/accept`);
  t.tick(14 * DAY + 1);
  const r = await as(a)("POST", `/hosts/${h.id}/team/${inv.body.id}/confirm`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "lapsed");
});

test("withdrawing someone else's invite tells the adder", async () => {
  const a = await join(), b = await join();
  const h = await startHost(a);
  await addAdmin(a, h.id, b);
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: phone() });
  assert.equal((await as(b)("DELETE", `/hosts/${h.id}/team/${inv.body.id}`)).status, 204);
  assert.ok(t.notices.some((x) => x.kind === "teamInviteWithdrawn" && (x.to as any).userId === a.me.id));
});

test("two suspended Admins; lifting one lifts the host", async () => {
  const staff = await join(), a = await join(), b = await join();
  await give(staff, "people");
  const s = as(staff);
  const h = await startHost(a);
  await addAdmin(a, h.id, b);
  await s("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "first", until: null });
  await s("POST", `/galaxy/people/${b.me.id}/suspend`, { reason: "second", until: null });
  assert.equal(await statusOf(h.id), "suspended");
  assert.equal((await s("POST", `/galaxy/people/${a.me.id}/lift`, { reason: "cleared" })).status, 200);
  assert.equal(await statusOf(h.id), "live");
});

test("the last answering Admin leaves: the host goes on hold", async () => {
  const staff = await join(), a = await join(), b = await join();
  await give(staff, "people");
  const h = await startHost(a);
  await addAdmin(a, h.id, b);
  await as(staff)("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "owner away", until: null });
  assert.equal(await statusOf(h.id), "live"); // b still answers
  assert.equal((await as(b)("POST", `/hosts/${h.id}/leave`)).status, 204);
  assert.equal(await statusOf(h.id), "suspended");
});

test("a lapsed accept doesn't block a new invite", async () => {
  const a = await join(), x = await join();
  const mail = `lapse${++n}@example.com`;
  await t.db.update(users).set({ email: mail, emailVerifiedAt: new Date() }).where(eq(users.id, x.me.id));
  const h = await startHost(a);
  const byPhone = await as(a)("POST", `/hosts/${h.id}/team`, { to: x.p });
  assert.equal((await as(x)("POST", `/invites/${byPhone.body.id}/accept`)).status, 200);
  t.tick(14 * DAY + 1);
  const byMail = await as(a)("POST", `/hosts/${h.id}/team`, { to: mail });
  assert.equal(byMail.status, 201);
  assert.equal((await as(x)("POST", `/invites/${byMail.body.id}/accept`)).status, 200);
  const [old] = await t.db.select().from(teamRoles).where(eq(teamRoles.id, byPhone.body.id));
  assert.equal(old!.endReason, "expired");
});

test("a lapsed suspension is cleared once, with an audit row", async () => {
  const staff = await join(), a = await join();
  await give(staff, "people");
  const until = new Date(t.now() + HOUR).toISOString();
  await as(staff)("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "cool off", until });
  t.tick(HOUR + 1);
  const back = await verify(a.p, { device: { ...device, id: (a as any).device } });
  assert.equal(back.body.step, "signedIn");
  assert.equal((await audits("people.lapse")).filter((x) => x.targetUser === a.me.id).length, 1);
  await verify(a.p, { device: { ...device, id: (a as any).device } });
  assert.equal((await audits("people.lapse")).filter((x) => x.targetUser === a.me.id).length, 1);
});

test("Staff-only search: exact only; People may search by name", async () => {
  const s = await join(), p = await join(), other = await join();
  await give(s, "staff");
  await give(p, "people");
  const name = (await t.db.select().from(users).where(eq(users.id, other.me.id)))[0]!.name!;
  assert.equal((await as(s)("GET", `/galaxy/people?q=${encodeURIComponent(name)}`)).status, 400);
  assert.equal((await as(s)("GET", `/galaxy/people?q=${encodeURIComponent(e164(other.p))}`)).status, 200);
  assert.equal((await as(p)("GET", `/galaxy/people?q=${encodeURIComponent(name)}`)).status, 200);
});

test("staff routes need a written reason, and write it to the audit", async () => {
  const x = await join(), y = await join(), z = await join();
  await give(x, "staff");
  await give(y, "staff");
  const open = async () => (await t.db.select().from(staffGrants).where(eq(staffGrants.userId, z.me.id))).filter((g) => !g.endedAt);
  for (const reason of [undefined, "ab"]) {
    const body = { userId: z.me.id, features: ["hosts"], ...(reason === undefined ? {} : { reason }) };
    assert.equal((await as(x)("POST", "/galaxy/staff/grants", body)).status, 400);
  }
  assert.equal((await open()).length, 0);
  const g = await as(x)("POST", "/galaxy/staff/grants", { userId: z.me.id, features: ["hosts"], reason: "new hire" });
  const id = g.body[0].id;
  for (const body of [undefined, {}, { reason: "ab" }]) {
    assert.equal((await as(y)("POST", `/galaxy/staff/grants/${id}/confirm`, body)).status, 400);
    assert.equal((await as(y)("DELETE", `/galaxy/staff/grants/${id}`, body)).status, 400);
  }
  assert.equal((await open())[0]!.startsAt, null); // still waiting, still open
  assert.equal((await as(y)("POST", `/galaxy/staff/grants/${id}/confirm`, { reason: "met them" })).status, 200);
  assert.equal((await as(y)("DELETE", `/galaxy/staff/grants/${id}`, { reason: "role changed" })).status, 204);
  const last = async (a: string) => (await audits(a)).filter((r) => r.targetUser === z.me.id).at(-1)?.reason;
  assert.equal(await last("staff.grant"), "new hire");
  assert.equal(await last("staff.confirm"), "met them");
  assert.equal(await last("staff.end"), "role changed");
});

test("a people search stores how, and the ids, never the query", async () => {
  const s = await join(), other = await join();
  await give(s, "people");
  await as(s)("GET", `/galaxy/people?q=${encodeURIComponent(e164(other.p))}`);
  const row = (await audits("people.search")).at(-1)!;
  assert.deepEqual(row.data, { by: "phone", results: [other.me.id] });
  assert.ok(!JSON.stringify(row.data).includes(other.p));
});

test("changing phone frees the old number on the owner's seat", async () => {
  const a = await join();
  const h = await startHost(a);
  const np = phone();
  t.tick(30_000);
  await t.call("POST", "/auth/code", { to: np });
  const ch = await as(a)("PUT", "/me/phone", { to: np, code: t.lastCode(e164(np)) });
  assert.equal(ch.status, 200);
  const [seat] = await t.db.select().from(teamRoles).where(eq(teamRoles.userId, a.me.id));
  assert.equal(seat!.contact, `user:${a.me.id}`);
  assert.equal((await as(a)("GET", `/hosts/${h.id}/team`)).status, 200);
  assert.equal((await me(a)).teams.length, 1);
  await join(a.p); // a new account signs up with the old number
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: a.p });
  assert.equal(inv.status, 201);
});

test("people search with Staff only", async () => {
  const s = await join(), nobody = await join(), other = await join();
  await give(s, "staff");
  const q = `/galaxy/people?q=${encodeURIComponent(e164(other.p))}`;
  assert.equal((await as(s)("GET", q)).status, 200);
  assert.equal((await as(nobody)("GET", q)).status, 404);
});
