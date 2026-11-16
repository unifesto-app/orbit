import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { testApp } from "../testkit.ts";
import { runDeletions } from "../auth/deletion.ts";
import { auditLog, follows, hosts, staffGrants, users } from "../db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

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

test("an Admin edits the host; renaming removes verification", async () => {
  const a = await join(), b = await join(), out = await join(), st = await staff("hosts");
  const h = await start(a);
  await addAdmin(a, h.id, b);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, R)).status, 200);
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
  const viaOld = await t.call("GET", `/hosts/by-slug/${old}`);
  assert.equal(viaOld.status, 200);
  assert.equal(viaOld.body.slug, "punchline"); // the client redirects
  assert.equal((await t.call("GET", "/hosts/by-slug/punchline")).body.id, h.id);
  for (const slug of [old, "punchline"]) {
    const r = await as(b)("PATCH", `/hosts/${other.id}`, { slug });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "linkTaken");
  }
  assert.equal((await as(a)("PATCH", `/hosts/${h.id}`, { slug: old })).body.slug, old); // its own old link is free to return to
  assert.equal((await t.call("GET", "/hosts/by-slug/punchline")).body.slug, old);
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
  const pub = await t.call("GET", `/hosts/by-slug/${h.slug}`);
  assert.equal(pub.status, 200);
  assert.deepEqual(Object.keys(pub.body).sort(), ["about", "banner", "city", "clubs", "following", "followers", "id", "kind", "logo", "name", "parent", "slug", "verified", "website"].sort());
  assert.equal(pub.body.following, null);
  assert.equal(pub.body.followers, null);
  assert.equal((await as(g)("GET", `/hosts/by-slug/${h.slug}`)).body.following, false);
  await as(g)("POST", `/hosts/${h.id}/follow`);
  assert.equal((await as(g)("GET", `/hosts/by-slug/${h.slug}`)).body.following, true);
  assert.equal((await t.call("GET", `/hosts/by-slug/${h.slug}`, undefined, "garbage")).status, 401);
  assert.equal((await as(a)("GET", `/hosts/${h.id}`)).body.followers, 1); // exact for the team
  for (let i = 0; i < 8; i++) await as(await join())("POST", `/hosts/${h.id}/follow`);
  assert.equal((await t.call("GET", `/hosts/by-slug/${h.slug}`)).body.followers, null); // 9
  await as(await join())("POST", `/hosts/${h.id}/follow`);
  assert.equal((await t.call("GET", `/hosts/by-slug/${h.slug}`)).body.followers, 10);
  await as(a)("POST", `/hosts/${h.id}/pause`);
  assert.equal((await t.call("GET", `/hosts/by-slug/${h.slug}`)).status, 404);
  await as(a)("POST", `/hosts/${h.id}/resume`);
  await as(a)("PATCH", `/hosts/${h.id}`, { visibility: "private" });
  assert.equal((await t.call("GET", `/hosts/by-slug/${h.slug}`)).status, 404);
  assert.equal((await t.call("GET", `/hosts/by-slug/nowhere`)).status, 404);
});

test("clubs and parent appear on the public read only when public and live", async () => {
  const a = await join(), st = await staff("hosts");
  const p = await start(a, "Parent"), c1 = await start(a, "Club One"), c2 = await start(a, "Club Two");
  for (const c of [c1, c2]) assert.equal((await as(st)("PUT", `/galaxy/hosts/${c.id}/parent`, { parentId: p.id, ...R })).status, 200);
  assert.deepEqual((await t.call("GET", `/hosts/by-slug/${p.slug}`)).body.clubs.map((x: any) => x.name), ["Club One", "Club Two"]);
  assert.equal((await t.call("GET", `/hosts/by-slug/${c1.slug}`)).body.parent.name, "Parent");
  await as(a)("PATCH", `/hosts/${c2.id}`, { visibility: "private" });
  await as(a)("POST", `/hosts/${p.id}/pause`);
  assert.equal((await t.call("GET", `/hosts/by-slug/${c1.slug}`)).body.parent, null);
  await as(a)("POST", `/hosts/${p.id}/resume`);
  assert.deepEqual((await t.call("GET", `/hosts/by-slug/${p.slug}`)).body.clubs.map((x: any) => x.name), ["Club One"]);
});

test("Galaxy hosts are for holders of Hosts alone", async () => {
  const a = await join(), nobody = await join(), people = await staff("people");
  const h = await start(a);
  for (const u of [nobody, people]) {
    assert.equal((await as(u)("GET", "/galaxy/hosts?q=punchline")).status, 404);
    assert.equal((await as(u)("GET", `/galaxy/hosts/${h.id}`)).status, 404);
    assert.equal((await as(u)("POST", `/galaxy/hosts/${h.id}/verify`, R)).status, 404);
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
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, R)).status, 200);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, R)).body.error, "already");
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
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).body.error, "archived");
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
    (await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, R)).status,
    (await as(st)("DELETE", `/galaxy/hosts/${h.id}/verify`, R)).status,
    (await as(st)("POST", `/galaxy/hosts/${h.id}/suspend`, R)).status,
    (await as(st)("POST", `/galaxy/hosts/${h.id}/lift`, R)).status,
    (await as(st)("PUT", `/galaxy/hosts/${h.id}/parent`, { parentId: other.id, ...R })).status,
    (await as(st)("PUT", `/galaxy/hosts/${other.id}/parent`, { parentId: h.id, ...R })).status, // the parent counts too
  ];
  const all = async (code: number) => assert.deepEqual(await acts(), Array(6).fill(code));
  // Invited by their phone, not yet accepted.
  const inv = await as(a)("POST", `/hosts/${h.id}/team`, { to: st.p });
  await all(403);
  assert.equal((await as(st)("POST", `/galaxy/hosts/${h.id}/verify`, R)).body.error, "ownHost");
  assert.equal((await as(st)("GET", `/galaxy/hosts/${h.id}`)).status, 200); // viewing is fine
  assert.equal((await audits("hosts.verify", h.id)).length, 0);
  // Accepted and confirmed: on the team.
  await as(st)("POST", `/invites/${inv.body.id}/accept`);
  await as(a)("POST", `/hosts/${h.id}/team/${inv.body.id}/confirm`);
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
  const r = await t.call("GET", `/hosts/by-slug/${h.slug}`);
  assert.equal(r.body.id, h.id);
});
