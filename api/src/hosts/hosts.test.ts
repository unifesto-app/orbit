import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { sign } from "hono/jwt";
import { testApp } from "../testkit.ts";
import { runDeletions } from "../auth/deletion.ts";
import { auditLog, follows, hosts, staffGrants, users } from "../db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
// A second connection that holds a row lock, to make two requests meet in a chosen order.
let lock: ReturnType<typeof postgres>;
before(async () => {
  t = await testApp();
  lock = postgres(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/orbit_test", { max: 1, onnotice: () => {} });
});
after(async () => {
  await lock.end();
  await t.close();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Runs `first`, then `second`, while the host's row is locked, so `second` reaches the database after `first` has queued.
const meet = async (hostId: string, first: () => Promise<any>, second: () => Promise<any>) => {
  let p1: Promise<any>, p2: Promise<any>;
  await lock.begin(async (sql: any) => {
    await sql`select 1 from hosts where id = ${hostId} for update`;
    p1 = first();
    await sleep(400);
    p2 = second();
    await sleep(400);
  });
  return [await p1!, await p2!];
};

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(3_000_000 + ++n * 11).padStart(9, "0")}`;
const e164 = (p: string) => `+91${p}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

const join = async (p = phone()) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(e164(p)), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const start = async (u: P, name = "Punchline Collective") => (await as(u)("POST", "/hosts", { name, kind: "comedy-group", city: "Hyderabad" })).body as { id: string; slug: string };
const makeOwner = async (u: P) => {
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.platformOwner, true));
  await t.db.update(users).set({ platformOwner: true }).where(eq(users.id, u.me.id));
};
const give = async (u: P, ...features: string[]) => {
  for (const feature of features as any[])
    await t.db.insert(staffGrants).values({ userId: u.me.id, feature, addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
};
const staff = async (...features: string[]) => {
  const s = await join();
  await give(s, ...features);
  return s;
};
const addAdmin = async (owner: P, hostId: string, who: P) => {
  const inv = await as(owner)("POST", `/hosts/${hostId}/team`, { to: who.p });
  assert.equal((await as(who)("POST", `/invites/${inv.body.id}/accept`)).status, 200);
  assert.equal((await as(owner)("POST", `/hosts/${hostId}/team/${inv.body.id}/confirm`)).status, 200);
  return inv.body.id as string;
};
// One host's rows of an action: tests share a database.
const audits = async (action: string, hostId: string) => (await t.db.select().from(auditLog)).filter((a) => a.action === action && a.targetHost === hostId);
const row = async (id: string) => (await t.db.select().from(hosts).where(eq(hosts.id, id)))[0]!;
const R = { reason: "checked the page" };
// A verify body: the host's name as staff would have just read it.
const vb = async (id: string) => ({ ...R, name: (await row(id)).name });

test("an Admin edits the host; renaming removes verification", async () => {
  const a = await join(), b = await join(), out = await join(), st = await staff("hosts");
  const h = await start(a);
  await addAdmin(a, h.id, b);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id))).status, 200);
  const e = await as(b)("PATCH", `/hosts/${h.id}`, { about: "Stand-up nights", website: "https://punchline.in", city: "Pune" });
  assert.equal(e.status, 200);
  assert.equal(e.body.about, "Stand-up nights");
  assert.equal(e.body.verified, true); // not renamed
  assert.equal(e.body.owner, false);
  const r = await as(a)("PATCH", `/hosts/${h.id}`, { name: " Punchline Comedy " });
  assert.equal(r.body.name, "Punchline Comedy");
  assert.equal(r.body.verified, false);
  assert.equal((await row(h.id)).verifiedBy, null);
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, {})).status, 400);
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { website: "http://x.in" })).status, 400);
  assert.equal((await as(out)("PATCH", `/hosts/${h.id}`, { about: "x" })).status, 404);
  assert.equal((await as(out)("GET", `/hosts/${h.id}`)).status, 404);
  assert.equal((await as(b)("GET", `/hosts/${h.id}`)).body.status, "live");
});

test("a suspended host reads only", async () => {
  const a = await join(), st = await staff("hosts");
  const h = await start(a);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  const e = await as(a)("PATCH", `/hosts/${h.id}`, { about: "x" });
  assert.equal(e.status, 409);
  assert.equal(e.body.error, "hostClosed");
  const g = await as(a)("GET", `/hosts/${h.id}`);
  assert.equal(g.body.suspendReason, R.reason);
});

test("a new link keeps the old one, and nobody else can take it", async () => {
  const a = await join(), b = await join();
  const h = await start(a), other = await start(b, "Other Crew");
  const old = h.slug;
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { slug: "punchline" })).body.slug, "punchline");
  const viaOld = await t.call("GET", `/public/hosts/${old}`);
  assert.equal(viaOld.status, 200);
  assert.equal(viaOld.body.slug, "punchline"); // the client redirects
  assert.equal((await t.call("GET", "/public/hosts/punchline")).body.id, h.id);
  for (const slug of [old, "punchline"]) {
    const r = await as(b)("PATCH", `/hosts/${other.id}`, { slug });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "linkTaken");
  }
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { slug: old })).body.slug, old); // its own old link is free to return to
  assert.equal((await t.call("GET", "/public/hosts/punchline")).body.slug, old);
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { slug: "Bad Slug" })).status, 400);
});

test("only the owner pauses, resumes, archives and restores", async () => {
  const a = await join(), b = await join(), st = await staff("hosts");
  const h = await start(a);
  await addAdmin(a, h.id, b);
  assert.equal((await as(b)("POST", `/hosts/${h.id}/pause`)).status, 404); // an Admin, not the owner
  assert.equal((await as(a)("POST", `/hosts/${h.id}/resume`)).body.error, "notNow");
  assert.equal((await as(a)("POST", `/hosts/${h.id}/pause`)).body.status, "paused");
  assert.ok(t.notices.some((x) => x.kind === "hostStatus" && (x.to as any).userId === b.me.id && (x.data as any).status === "paused"));
  assert.ok(!t.notices.some((x) => x.kind === "hostStatus" && (x.to as any).userId === a.me.id));
  assert.equal((await as(a)("POST", `/hosts/${h.id}/pause`)).status, 409);
  assert.equal((await as(a)("POST", `/hosts/${h.id}/resume`)).body.status, "live");
  assert.equal((await as(a)("POST", `/hosts/${h.id}/archive`)).body.status, "archived");
  assert.equal((await as(b)("GET", `/hosts/${h.id}`)).status, 404); // archived is closed to all but the owner
  assert.equal((await as(a)("GET", `/hosts/${h.id}`)).status, 200);
  assert.equal((await as(a)("POST", `/hosts/${h.id}/restore`)).body.status, "live");
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  for (const action of ["pause", "resume", "archive", "restore"]) assert.equal((await as(a)("POST", `/hosts/${h.id}/${action}`)).status, 409, action);
});

test("follow, unfollow and my follows", async () => {
  const a = await join(), f = await join(), st = await staff("hosts");
  const h1 = await start(a, "First"), h2 = await start(a, "Second"), h3 = await start(a, "Third");
  assert.equal((await as(f)("POST", `/hosts/${h1.id}/follow`)).body.following, true);
  assert.equal((await as(f)("POST", `/hosts/${h1.id}/follow`)).status, 200); // idempotent
  t.tick(1000);
  await as(f)("POST", `/hosts/${h2.id}/follow`);
  t.tick(1000);
  await as(f)("POST", `/hosts/${h3.id}/follow`);
  assert.deepEqual((await as(f)("GET", "/me/follows")).body.map((x: any) => x.name), ["Third", "Second", "First"]);
  assert.deepEqual(Object.keys((await as(f)("GET", "/me/follows")).body[0]).sort(), ["city", "id", "logo", "name", "slug", "verified"]);
  await as(a)("PATCH", `/hosts/${h1.id}`, { visibility: "private" });
  await as(a)("POST", `/hosts/${h2.id}/pause`);
  await as(st)("POST", `/galaxy/hosts/${h3.id}/suspend`, R);
  assert.deepEqual((await as(f)("GET", "/me/follows")).body, []); // hidden...
  assert.equal((await t.db.select().from(follows).where(eq(follows.userId, f.me.id))).length, 3); // ...never deleted
  for (const h of [h1, h2, h3]) assert.equal((await as(f)("POST", `/hosts/${h.id}/follow`)).status, 404);
  assert.equal((await as(f)("DELETE", `/hosts/${h1.id}/follow`)).status, 204);
  assert.equal((await as(f)("DELETE", `/hosts/nope/follow`)).status, 204);
  assert.equal((await as(f)("POST", `/hosts/nope/follow`)).status, 404);
  assert.equal((await t.call("POST", `/hosts/${h1.id}/follow`)).status, 401);
});

test("the public read: private and paused hosts aren't there; the count shows from 10", async () => {
  const a = await join(), g = await join();
  const h = await start(a, "Open Mic");
  await as(a)("PATCH", `/hosts/${h.id}`, { about: "Mic nights" });
  const pub = await t.call("GET", `/public/hosts/${h.slug}`);
  assert.equal(pub.status, 200);
  assert.deepEqual(Object.keys(pub.body).sort(), ["about", "banner", "city", "clubs", "following", "followers", "id", "kind", "logo", "name", "parent", "slug", "verified", "website"].sort());
  assert.equal(pub.body.following, null);
  assert.equal(pub.body.followers, null);
  assert.equal((await as(g)("GET", `/public/hosts/${h.slug}`)).body.following, false);
  await as(g)("POST", `/hosts/${h.id}/follow`);
  assert.equal((await as(g)("GET", `/public/hosts/${h.slug}`)).body.following, true);
  assert.equal((await t.call("GET", `/public/hosts/${h.slug}`, undefined, "garbage")).status, 401);
  assert.equal((await as(a)("GET", `/hosts/${h.id}`)).body.followers, 1); // exact for the team
  for (let i = 0; i < 8; i++) await as(await join())("POST", `/hosts/${h.id}/follow`);
  assert.equal((await t.call("GET", `/public/hosts/${h.slug}`)).body.followers, null); // 9
  await as(await join())("POST", `/hosts/${h.id}/follow`);
  assert.equal((await t.call("GET", `/public/hosts/${h.slug}`)).body.followers, 10);
  await as(a)("POST", `/hosts/${h.id}/pause`);
  assert.equal((await t.call("GET", `/public/hosts/${h.slug}`)).status, 404);
  await as(a)("POST", `/hosts/${h.id}/resume`);
  await as(a)("PATCH", `/hosts/${h.id}`, { visibility: "private" });
  assert.equal((await t.call("GET", `/public/hosts/${h.slug}`)).status, 404);
  assert.equal((await t.call("GET", `/public/hosts/nowhere`)).status, 404);
});

test("clubs and parent appear on the public read only when public and live", async () => {
  const a = await join(), st = await staff("hosts");
  const p = await start(a, "Parent"), c1 = await start(a, "Club One"), c2 = await start(a, "Club Two");
  for (const c of [c1, c2]) assert.equal((await as(st)("PUT", `/galaxy/hosts/${c.id}/parent`, { parentId: p.id, ...R })).status, 200);
  assert.deepEqual((await t.call("GET", `/public/hosts/${p.slug}`)).body.clubs.map((x: any) => x.name), ["Club One", "Club Two"]);
  assert.equal((await t.call("GET", `/public/hosts/${c1.slug}`)).body.parent.name, "Parent");
  await as(a)("PATCH", `/hosts/${c2.id}`, { visibility: "private" });
  await as(a)("POST", `/hosts/${p.id}/pause`);
  assert.equal((await t.call("GET", `/public/hosts/${c1.slug}`)).body.parent, null);
  await as(a)("POST", `/hosts/${p.id}/resume`);
  assert.deepEqual((await t.call("GET", `/public/hosts/${p.slug}`)).body.clubs.map((x: any) => x.name), ["Club One"]);
});

test("Galaxy hosts are for holders of Hosts alone", async () => {
  const a = await join(), nobody = await join(), people = await staff("people");
  const h = await start(a);
  for (const u of [nobody, people]) {
    assert.equal((await as(u)("GET", "/galaxy/hosts?q=punchline")).status, 404);
    assert.equal((await as(u)("GET", `/galaxy/hosts/${h.id}`)).status, 404);
    assert.equal((await as(u)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id))).status, 404);
  }
});

test("Galaxy search and the staff page", async () => {
  const a = await join(), st = await staff("hosts");
  const h = await start(a, "Zebra 100%_Crew");
  assert.equal((await as(st)("GET", "/galaxy/hosts?q=z")).status, 400);
  assert.deepEqual((await as(st)("GET", "/galaxy/hosts?q=zebra 100%_")).body.map((x: any) => x.id), [h.id]);
  assert.equal((await as(st)("GET", "/galaxy/hosts?q=zebra%25")).body.length, 0); // % isn't a wildcard
  await as(a)("PATCH", `/hosts/${h.id}`, { slug: "zebra-crew" });
  assert.deepEqual((await as(st)("GET", `/galaxy/hosts?q=${h.slug}`)).body.map((x: any) => x.id), [h.id]); // an old slug, exactly
  const p = await as(st)("GET", `/galaxy/hosts/${h.id}`);
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.team, [{ userId: a.me.id, name: "Riya Kapoor", role: "admin", owner: true }]);
  assert.match(p.body.owner.phone, /^\+91 ••••••\d{4}$/);
  assert.equal(p.body.verified, null);
  const logged = await audits("hosts.view", h.id);
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.targetHost, h.id);
  assert.equal((await as(st)("GET", "/galaxy/hosts/not-an-id")).status, 404);
});

test("verify and unverify, audited and announced", async () => {
  const a = await join(), b = await join(), st = await staff("hosts", "people");
  const h = await start(a);
  await addAdmin(a, h.id, b);
  assert.equal((await as(st)("DELETE", `/galaxy/hosts/${h.id}/verify`, R)).body.error, "notVerified");
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, { reason: "x" })).status, 400);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id))).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id))).body.error, "already");
  const h1 = await row(h.id);
  assert.equal(h1.verifiedBy, st.me.id);
  const [v] = await audits("hosts.verify", h.id);
  assert.equal(v!.targetHost, h.id);
  assert.equal(v!.reason, R.reason);
  assert.equal((await audits("hosts.verify", h.id)).length, 1); // the refused one wrote nothing
  for (const u of [a, b]) assert.ok(t.notices.some((x) => x.kind === "hostVerified" && (x.to as any).userId === u.me.id));
  assert.ok(t.notices.some((x) => x.kind === "staffRiskyAction" && (x.to as any).userId === st.me.id && (x.data as any).action === "hosts.verify"));
  assert.equal((await as(st)("DELETE", `/galaxy/hosts/${h.id}/verify`, { reason: "wrong page" })).status, 200);
  assert.equal((await row(h.id)).verifiedAt, null);
  assert.equal((await audits("hosts.unverify", h.id)).length, 1);
  assert.ok(t.notices.some((x) => x.kind === "hostUnverified" && (x.to as any).userId === b.me.id && (x.data as any).reason === "wrong page"));
});

test("staff suspend and lift; a paused host goes back to paused", async () => {
  const a = await join(), st = await staff("hosts");
  const h = await start(a);
  const [bad] = [await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)];
  assert.equal(bad.body.error, "notSuspended");
  await as(a)("POST", `/hosts/${h.id}/pause`);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, { reason: "fake events" })).status, 200);
  const s = await row(h.id);
  assert.equal(s.status, "suspended");
  assert.equal(s.suspendedWith, null);
  assert.equal(s.liftTo, "paused");
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).body.error, "already");
  assert.ok(t.notices.some((x) => x.kind === "hostSuspended" && (x.to as any).userId === a.me.id && (x.data as any).reason === "fake events"));
  const [aud] = await audits("hosts.suspend", h.id);
  assert.equal(aud!.targetHost, h.id);
  assert.equal(aud!.reason, "fake events");
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).body.status, "paused");
  const l = await row(h.id);
  assert.equal(l.suspendReason, null);
  assert.equal(l.liftTo, null);
  assert.ok(t.notices.some((x) => x.kind === "hostLifted" && (x.to as any).userId === a.me.id));
  assert.equal((await audits("hosts.lift", h.id)).length, 1);
  await as(a)("POST", `/hosts/${h.id}/resume`);
  await as(a)("POST", `/hosts/${h.id}/archive`);
  // Staff suspend an archived host too; the owner can't restore it, and a lift puts it back archived.
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  assert.equal((await row(h.id)).liftTo, "archived");
  assert.equal((await as(a)("POST", `/hosts/${h.id}/restore`)).body.error, "notNow");
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).body.status, "archived");
  assert.equal((await row(h.id)).status, "archived");
});

test("a staff suspension survives the account-tied lift; an account-tied hold can be taken over", async () => {
  const a = await join(), b = await join(), st = await staff("hosts", "people");
  const h = await start(a), h2 = await start(b, "Held One");
  assert.equal((await as(st)("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "chargeback", until: null })).status, 200);
  assert.equal((await row(h.id)).status, "suspended"); // held for want of an Admin
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).body.error, "notSuspended"); // account-tied, not staff's
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200); // taken over
  assert.equal((await row(h.id)).suspendedWith, null);
  assert.equal((await as(st)("POST", `/galaxy/people/${a.me.id}/lift`, R)).status, 200);
  assert.equal((await row(h.id)).status, "suspended"); // stays
  // Lifting while the only Admin is still suspended puts it straight back on hold.
  assert.equal((await as(st)("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "again", until: null })).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).body.status, "suspended");
  const held = await row(h.id);
  assert.equal(held.suspendedWith, a.me.id);
  assert.equal(held.suspendReason, null);
  assert.equal((await as(st)("POST", `/galaxy/people/${a.me.id}/lift`, R)).status, 200);
  assert.equal((await row(h.id)).status, "live"); // now the account-tied lift works
  assert.equal((await row(h2.id)).status, "live");
});

test("parent: one level deep", async () => {
  const a = await join(), st = await staff("hosts");
  const [p, c, g, x] = [await start(a, "P"), await start(a, "C"), await start(a, "G"), await start(a, "X")];
  const put = (id: string, parentId: string | null) => as(st)("PUT", `/galaxy/hosts/${id}/parent`, { parentId, ...R });
  assert.equal((await put(c.id, p.id)).status, 200);
  assert.equal((await row(c.id)).parentId, p.id);
  assert.equal((await audits("hosts.parent", c.id)).length, 1);
  assert.ok(t.notices.some((n) => n.kind === "hostParentSet" && (n.data as any).parentName === "P"));
  assert.equal((await put(g.id, c.id)).body.error, "tooDeep"); // the parent is a club
  assert.equal((await put(p.id, x.id)).body.error, "tooDeep"); // the host has clubs
  assert.equal((await put(x.id, x.id)).body.error, "self");
  assert.equal((await put(x.id, "00000000-0000-4000-8000-000000000000")).body.error, "notFound");
  await as(a)("POST", `/hosts/${g.id}/archive`);
  assert.equal((await put(x.id, g.id)).body.error, "notFound"); // archived
  assert.equal((await audits("hosts.parent", c.id)).length, 1); // refusals write nothing
  assert.equal((await put(c.id, null)).status, 200);
  assert.equal((await row(c.id)).parentId, null);
  assert.equal((await put(g.id, p.id)).status, 200);
});

test("staff never act on a host they're on, invited to, or left in the last 30 days", async () => {
  const a = await join(), st = await staff("hosts");
  const other = await start(await join(), "Elsewhere");
  const h = await start(a);
  const acts = async () => [
    (await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id))).status,
    (await as(st)("DELETE", `/galaxy/hosts/${h.id}/verify`, R)).status,
    (await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status,
    (await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).status,
    (await as(st)("PUT", `/galaxy/hosts/${h.id}/parent`, { parentId: other.id, ...R })).status,
    (await as(st)("PUT", `/galaxy/hosts/${other.id}/parent`, { parentId: h.id, ...R })).status, // the parent counts too
  ];
  const all = async (code: number) => assert.deepEqual(await acts(), Array(6).fill(code));
  // Invited by their phone, not yet accepted: the host alone controls that, so it blocks nothing.
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: st.p });
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).body.error, "notSuspended");
  // Accepted: theirs now, even before the adder confirms.
  await as(st)("POST", `/invites/${inv.body.id}/accept`);
  await all(403);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id))).body.error, "ownHost");
  assert.equal((await as(st)("GET", `/galaxy/hosts/${h.id}`)).status, 200); // viewing is fine
  assert.equal((await audits("hosts.verify", h.id)).length, 0);
  await as(a)("POST", `/hosts/${h.id}/team/${inv.body.id}/confirm`); // on the team
  await all(403);
  // Left 29 days ago: still refused. 31 days ago: allowed.
  await as(st)("POST", `/hosts/${h.id}/leave`);
  t.tick(29 * DAY);
  await all(403);
  t.tick(2 * DAY);
  const [ok] = await acts();
  assert.equal(ok, 200);
});

test("deleting an account removes its follows", async () => {
  const a = await join(), f = await join();
  const h = await start(a);
  await as(f)("POST", `/hosts/${h.id}/follow`);
  assert.ok((await as(f)("GET", "/me/deletion")).body.deleted.includes("Hosts you follow"));
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now()), deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, f.me.id));
  assert.equal(await runDeletions(t.db, async () => {}, t.now()), 1);
  assert.equal((await t.db.select().from(follows).where(eq(follows.userId, f.me.id))).length, 0);
  assert.equal((await t.db.select().from(follows)).filter((x) => x.hostId === h.id).length, 0);
});

test("slugs of hosts started now are recorded", async () => {
  const h = await start(await join());
  const r = await t.call("GET", `/public/hosts/${h.slug}`);
  assert.equal(r.body.id, h.id);
});

test("an archived host is closed to a non-owner Admin on read and edit; the owner restores it", async () => {
  const a = await join(), b = await join();
  const h = await start(a);
  await addAdmin(a, h.id, b);
  await as(a)("POST", `/hosts/${h.id}/archive`);
  assert.equal((await as(b)("GET", `/hosts/${h.id}`)).status, 404);
  assert.equal((await as(b)("PATCH", `/hosts/${h.id}`, { about: "x" })).status, 404);
  // Staff suspending it doesn't open it to the team again, on reads or in the mode switcher.
  const st = await staff("hosts");
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  assert.equal((await as(b)("GET", `/hosts/${h.id}`)).status, 404);
  assert.deepEqual((await as(b)("GET", "/me")).body.teams, []);
  assert.equal((await as(a)("GET", `/hosts/${h.id}`)).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).body.status, "archived");
  assert.equal((await as(a)("POST", `/hosts/${h.id}/restore`)).status, 200);
  assert.equal((await as(b)("PATCH", `/hosts/${h.id}`, { about: "x" })).status, 200);
});

test("the public read with an expired or garbage token is 401, never 500", async () => {
  const a = await join();
  const h = await start(a);
  // Expiry runs on the real clock, so forge a token the server signed for itself, already expired.
  const claims = JSON.parse(Buffer.from(a.access.split(".")[1]!, "base64url").toString());
  const expired = await sign({ ...claims, use: "access", iat: 1, exp: 2 }, "test-secret-that-is-at-least-32-characters", "HS256");
  assert.equal((await t.call("GET", `/public/hosts/${h.slug}`, undefined, expired)).status, 401);
  for (const bad of ["", "a.b.c", "Bearer", "x".repeat(500)]) assert.equal((await t.call("GET", `/public/hosts/${h.slug}`, undefined, bad)).status < 500, true, bad);
});

test("a link that differs by case or has a hyphen at either end is refused", async () => {
  const a = await join(), b = await join();
  const h = await start(a);
  await as(a)("PATCH", `/hosts/${h.id}`, { slug: "punchline-x" });
  for (const slug of ["Punchline-Y", "-punchline-y", "punchline-y-", "punchline--y"]) assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { slug })).status, 400, slug);
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { slug: "PUNCHLINE-X" })).status, 400);
});

test("a rename that only changes whitespace keeps the verification", async () => {
  const a = await join(), st = await staff("hosts");
  const h = await start(a, "Plain Name");
  await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id));
  const r = await as(a)("PATCH", `/hosts/${h.id}`, { name: "  Plain Name " });
  assert.equal(r.status, 200);
  assert.equal(r.body.verified, true);
  assert.notEqual((await row(h.id)).verifiedAt, null);
});

test("unfollowing an archived host still works", async () => {
  const a = await join(), f = await join();
  const h = await start(a);
  await as(f)("POST", `/hosts/${h.id}/follow`);
  await as(a)("POST", `/hosts/${h.id}/archive`);
  assert.equal((await as(f)("DELETE", `/hosts/${h.id}/follow`)).status, 204);
  assert.equal((await t.db.select().from(follows).where(eq(follows.userId, f.me.id))).length, 0);
});

test("staff with only People get 404 on every Galaxy host route", async () => {
  const a = await join(), people = await staff("people");
  const h = await start(a), o = await start(a, "Other");
  const id = `/galaxy/hosts/${h.id}`;
  const calls: [string, string, unknown?][] = [
    ["GET", "/galaxy/hosts?q=punchline"], ["GET", id], ["POST", `${id}/verify`, R], ["DELETE", `${id}/verify`, R],
    ["POST", `${id}/suspend`, R], ["POST", `${id}/lift`, R], ["PUT", `${id}/parent`, { parentId: o.id, ...R }],
  ];
  for (const [m, p, b] of calls) assert.equal((await as(people)(m, p, b)).status, 404, `${m} ${p}`);
  assert.equal((await row(h.id)).status, "live");
  assert.equal((await row(o.id)).parentId, null);
});

test("two parents set at once leave at most one link", async () => {
  const a = await join(), st = await staff("hosts");
  const x = await start(a, "Xray"), y = await start(a, "Yankee");
  const put = (id: string, parentId: string) => as(st)("PUT", `/galaxy/hosts/${id}/parent`, { parentId, ...R });
  const rs = await Promise.all([put(x.id, y.id), put(y.id, x.id)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const links = [(await row(x.id)).parentId, (await row(y.id)).parentId].filter(Boolean);
  assert.equal(links.length, 1);
});

test("a refused staff action writes no audit row", async () => {
  const a = await join(), st = await staff("hosts");
  const o = await join();
  const h = await start(a), other = await start(o, "Away");
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).status, 409);
  assert.equal((await as(st)("DELETE", `/galaxy/hosts/${h.id}/verify`, R)).status, 409);
  await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id));
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, await vb(h.id))).status, 409);
  await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 409);
  assert.equal((await as(st)("PUT", `/galaxy/hosts/${h.id}/parent`, { parentId: h.id, ...R })).status, 400);
  for (const [action, n] of [["hosts.verify", 1], ["hosts.unverify", 0], ["hosts.suspend", 1], ["hosts.lift", 0], ["hosts.parent", 0]] as const)
    assert.equal((await audits(action, h.id)).length, n, action);
  // staff who sit on the host: refused, nothing written
  const inv = await as(o)("POST", `/hosts/${other.id}/team`, { to: st.p });
  await as(st)("POST", `/invites/${inv.body.id}/accept`);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${other.id}/suspend`, R)).status, 403);
  assert.equal((await as(st)("PUT", `/galaxy/hosts/${other.id}/parent`, { parentId: null, ...R })).status, 403);
  for (const action of ["hosts.suspend", "hosts.parent"]) assert.equal((await audits(action, other.id)).length, 0, action);
});

test("day-30 deletion drops the host's follower count", async () => {
  const a = await join(), f = await join();
  const h = await start(a);
  await as(f)("POST", `/hosts/${h.id}/follow`);
  assert.equal((await as(a)("GET", `/hosts/${h.id}`)).body.followers, 1);
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now()), deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, f.me.id));
  await runDeletions(t.db, async () => {}, t.now());
  assert.equal((await as(a)("GET", `/hosts/${h.id}`)).body.followers, 0);
});

test("a host whose link is 'team' has a public page", async () => {
  const a = await join();
  const h = await start(a);
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { slug: "team" })).status, 200);
  assert.equal((await t.call("GET", "/public/hosts/team")).body.id, h.id);
  assert.equal((await as(a)("GET", "/public/hosts/team")).body.id, h.id);
  assert.equal((await as(a)("GET", `/hosts/${h.id}/team`)).status, 200); // the team route is untouched
});

test("a withdrawn or lapsed invite never blocks staff; one they accepted and left does not either", async () => {
  const a = await join(), st = await staff("hosts");
  const h = await start(a);
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: st.p });
  assert.equal((await as(a)("DELETE", `/hosts/${h.id}/team/${inv.body.id}`)).status, 204);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).status, 200);
  // Lapses after 14 days, and the host's Admins never confirmed it.
  const inv2 = await as(a)("POST", `/hosts/${h.id}/team`, { to: st.p });
  t.tick(15 * DAY);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).status, 200);
  // Accepted, then withdrawn before it started: it never was a seat.
  const inv3 = await as(a)("POST", `/hosts/${h.id}/team`, { to: st.p });
  await as(st)("POST", `/invites/${inv3.body.id}/accept`);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).body.error, "ownHost");
  await as(a)("DELETE", `/hosts/${h.id}/team/${inv3.body.id}`);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).status, 200);
  // Accepted but never confirmed: it blocks while it waits, and stops when it lapses (they can't leave it).
  const inv4 = await as(a)("POST", `/hosts/${h.id}/team`, { to: st.p });
  await as(st)("POST", `/invites/${inv4.body.id}/accept`);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).body.error, "ownHost");
  t.tick(15 * DAY);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  void inv2;
});

test("an archived host that staff suspend stays ended: no deletion blocker, never a parent", async () => {
  const a = await join(), b = await join(), st = await staff("hosts");
  const h = await start(a), club = await start(b);
  assert.equal((await as(a)("POST", `/hosts/${h.id}/archive`)).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status, 200);
  const del = (await as(a)("GET", "/me/deletion")).body;
  assert.equal(JSON.stringify(del).includes(h.id), false); // the owner can still leave
  const r = await as(st)("PUT", `/galaxy/hosts/${club.id}/parent`, { parentId: h.id, ...R });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "notFound");
});

test("a person suspension racing a host suspension leaves the staff suspension alone", async () => {
  const a = await join(), st = await staff("hosts", "people");
  const h = await start(a);
  const [r1, r2] = await meet(
    h.id,
    () => as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, { reason: "fake events" }),
    () => as(st)("POST", `/galaxy/people/${a.me.id}/suspend`, { reason: "chargeback", until: null }),
  );
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body.hosts, []); // not held by the account: staff got there first
  const s = await row(h.id);
  assert.equal(s.suspendedWith, null);
  assert.equal(s.suspendReason, "fake events");
  assert.deepEqual((await audits("hosts.suspend", h.id)).length, 1);
  assert.equal((await as(st)("POST", `/galaxy/people/${a.me.id}/lift`, R)).status, 200);
  assert.equal((await row(h.id)).status, "suspended"); // the account coming back doesn't lift it
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).status, 200);
});

test("a PATCH racing a staff suspension is refused, and changes nothing", async () => {
  const a = await join(), st = await staff("hosts");
  const h = await start(a);
  const [r1, r2] = await meet(
    h.id,
    () => as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R),
    () => as(a)("PATCH", `/hosts/${h.id}`, { about: "edited after suspension", visibility: "private" }),
  );
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error, "hostClosed");
  const s = await row(h.id);
  assert.equal(s.about, null);
  assert.equal(s.visibility, "public");
});

test("a PATCH from someone removed from the team is refused", async () => {
  const a = await join(), b = await join();
  const h = await start(a);
  const seat = await addAdmin(a, h.id, b);
  const [r1, r2] = await meet(
    h.id,
    () => as(a)("DELETE", `/hosts/${h.id}/team/${seat}`), // not blocked by the row lock, so this only shows the seat check
    () => as(b)("PATCH", `/hosts/${h.id}`, { about: "still here?" }),
  );
  assert.equal(r1.status, 204);
  assert.equal(r2.status, 404);
  assert.equal((await row(h.id)).about, null);
});

test("verifying needs the name staff saw", async () => {
  const a = await join(), st = await staff("hosts");
  const h = await start(a, "Hyderabad Comedy Club");
  const seen = (await as(st)("GET", `/galaxy/hosts/${h.id}`)).body.name;
  await as(a)("PATCH", `/hosts/${h.id}`, { name: "HDFC Bank Events" });
  const r = await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, { ...R, name: seen });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "changed");
  assert.equal((await row(h.id)).verifiedAt, null);
  assert.equal((await audits("hosts.verify", h.id)).length, 0);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, R)).status, 400); // no name at all
  // A rename that lands while the verify waits for the row.
  const [r1, r2] = await meet(
    h.id,
    () => as(a)("PATCH", `/hosts/${h.id}`, { name: "Third Name" }),
    () => as(st)("POST", `/galaxy/hosts/${h.id}/verify`, { ...R, name: "HDFC Bank Events" }),
  );
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 409);
  assert.equal((await row(h.id)).verifiedAt, null);
  const ok = await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, { ...R, name: "Third Name" });
  assert.equal(ok.status, 200);
  assert.deepEqual((await audits("hosts.verify", h.id))[0]!.data, { name: "Third Name" });
});

test("staff on a parent's team can't detach or move its club", async () => {
  const st = await staff("hosts"), st2 = await staff("hosts"), a = await join();
  const p = await start(st, "Staff Parent"), c = await start(a, "Club"), q = await start(a, "Other Parent");
  assert.equal((await as(st2)("PUT", `/galaxy/hosts/${c.id}/parent`, { parentId: p.id, ...R })).status, 200);
  for (const parentId of [null, q.id]) {
    const r = await as(st)("PUT", `/galaxy/hosts/${c.id}/parent`, { parentId, ...R });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "ownHost");
  }
  assert.equal((await row(c.id)).parentId, p.id);
});

test("galaxy teams lists a host's starter as an owner Admin; hosts staff only; junk page is page 1", async () => {
  const a = await join(), st = await staff("hosts"), plain = await staff("people");
  const h = await start(a, "Teams Listing Collective");
  assert.equal((await as(plain)("GET", "/galaxy/teams")).status, 404);
  const r = await as(st)("GET", "/galaxy/teams");
  assert.equal(r.status, 200);
  assert.equal(r.body.page, 1);
  assert.equal(r.body.pageSize, 50);
  const seat = r.body.seats.find((s: any) => s.hostId === h.id);
  assert.equal(seat.userId, a.me.id);
  assert.equal(seat.role, "admin");
  assert.equal(seat.owner, true);
  assert.equal(seat.host, "Teams Listing Collective");
  assert.ok(r.body.total >= 1);
  assert.equal((await as(st)("GET", "/galaxy/teams?page=junk")).body.page, 1);
});
