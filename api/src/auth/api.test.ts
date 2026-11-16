import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { sign } from "hono/jwt";
import { testApp } from "../testkit.ts";
import * as schema from "../db/schema.ts";
import { sha256 } from "./tokens.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const { users, sessions, legalAcceptances } = schema;
const SECRET = "test-secret-that-is-at-least-32-characters";
const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `9${String(1_000_000 + ++n * 7).padStart(9, "0")}`; // fresh number per use
const e164 = (p: string) => `+91${p}`;
const email = () => `p${++n}@example.com`;

const send = (to: string) => t.call("POST", "/auth/code", { to });
const verify = async (to: string, extra: object = {}) => {
  const key = to.includes("@") ? to : e164(to);
  t.tick(30_000); // the 30 s gap between sends to one contact
  const s = await send(to);
  assert.equal(s.status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(key), device, ...extra });
};
const signup = (v: any, extra: object = {}) =>
  t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device, ...extra });
// A full phone sign-up; returns the signedIn body plus the number.
const join = async (p = phone()) => {
  const s = await signup(await verify(p));
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body };
};
const userByPhone = async (p: string) => (await t.db.select().from(users).where(eq(users.phone, e164(p))))[0];

test("email first, new email: phone, aboutYou, account with both", async () => {
  const e = email(), p = phone();
  const v = await verify(e);
  assert.equal(v.body.step, "phone");
  const v2 = await verify(p, { signup: v.body.signup });
  assert.equal(v2.body.step, "aboutYou");
  const s = await signup(v2);
  assert.equal(s.body.step, "signedIn");
  assert.equal(s.body.me.phone, e164(p));
  assert.equal(s.body.me.email, e);
  assert.ok((await t.db.select().from(users).where(eq(users.email, e)))[0]!.emailVerifiedAt);
});

test("phone on a known device signs straight in", async () => {
  const a = await join();
  assert.equal((await t.call("POST", "/auth/signout", undefined, a.access)).status, 204);
  const v = await verify(a.p, { device: { ...device, id: a.device } });
  assert.equal(v.body.step, "signedIn");
});

test("phone on a new device asks Is this you; yes signs in and marks the session", async () => {
  const a = await join();
  for (const dev of [device, { ...device, id: "other-device" }]) {
    const v = await verify(a.p, { device: dev });
    assert.equal(v.body.step, "confirm");
    assert.equal(v.body.name, "R••• K•••");
    assert.equal(v.body.since, new Date().getFullYear());
  }
  const v = await verify(a.p);
  const c = await t.call("POST", "/auth/confirm", { ticket: v.body.ticket, me: true, device: { ...device, id: "d3" } });
  assert.equal(c.body.step, "signedIn");
});

test("Not me, start fresh moves the number to a new account", async () => {
  const a = await join();
  const v = await verify(a.p);
  const c = await t.call("POST", "/auth/confirm", { ticket: v.body.ticket, me: false, device });
  assert.equal(c.body.step, "aboutYou");
  const s = await signup(c, { name: "Someone Else" });
  assert.equal(s.body.step, "signedIn");
  assert.equal(s.body.me.phone, e164(a.p));
  assert.notEqual(s.body.me.id, a.me.id);
  const [old] = await t.db.select().from(users).where(eq(users.id, a.me.id));
  assert.equal(old!.phone, null);
});

test("email first, then a phone on an account: signs in, addEmail adds once", async () => {
  const a = await join();
  await t.call("POST", "/auth/signout", undefined, a.access);
  const e = email();
  const v = await verify(e);
  const v2 = await verify(a.p, { signup: v.body.signup, device: { ...device, id: a.device } });
  assert.equal(v2.body.step, "signedIn");
  assert.equal(v2.body.me.id, a.me.id);
  assert.equal(v2.body.addEmail.email, e);
  const add = await t.call("POST", "/me/email", { token: v2.body.addEmail.token }, v2.body.access);
  assert.equal(add.status, 200);
  assert.equal(add.body.email, e);
  const again = await t.call("POST", "/me/email", { token: v2.body.addEmail.token }, v2.body.access);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "hasEmail");
});

test("migrated account finishes: email, phone, About you", async () => {
  const e = email(), p = phone();
  const [u] = await t.db.insert(users).values({ name: "Mia Rao", email: e }).returning();
  const v = await verify(e);
  assert.equal(v.body.step, "phone");
  const v2 = await verify(p, { signup: v.body.signup });
  assert.equal(v2.body.step, "aboutYou");
  assert.equal(v2.body.name, "Mia Rao");
  const s = await signup(v2);
  assert.equal(s.body.step, "signedIn");
  assert.equal((await t.db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, u!.id))).length, 1);
});

test("migrated account's phone on another account is phoneTaken", async () => {
  const taken = await join();
  const e = email();
  await t.db.insert(users).values({ name: "Mia Rao", email: e });
  const v = await verify(e);
  const r = await verify(taken.p, { signup: v.body.signup });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "phoneTaken");
});

test("under 18, new person: refused, nothing saved", async () => {
  const p = phone();
  const s = await signup(await verify(p), { dob: "2015-01-01" });
  assert.equal(s.status, 403);
  assert.equal(s.body.error, "under18");
  assert.equal(s.body.opensOn, undefined);
  assert.equal(await userByPhone(p), undefined);
});

test("under 18, new person: a mistyped year can be fixed on the same screen", async () => {
  const v = await verify(phone());
  assert.equal((await signup(v, { dob: "2012-01-01" })).body.error, "under18");
  assert.equal((await signup(v, { dob: "2002-01-01" })).body.step, "signedIn");
});

test("under 18 by the date on file holds even with a migrated terms row", async () => {
  const p = phone();
  const [u] = await t.db.insert(users).values({ name: "Teen", phone: e164(p), dob: "2012-06-15" }).returning();
  await t.db.insert(legalAcceptances).values({ userId: u!.id, document: "terms", version: 1, client: "app" });
  const c = await verify(p);
  const r = await t.call("POST", "/auth/confirm", { ticket: c.body.ticket, me: true, device });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "under18");
  assert.equal(r.body.opensOn, "2030-06-15");
  assert.equal((await t.db.select().from(sessions).where(eq(sessions.userId, u!.id))).length, 0);
});

test("the WhatsApp step retried after it already worked carries on", async () => {
  const e = email(), p = phone();
  await t.db.insert(users).values({ name: "Mia Rao", email: e });
  const v = await verify(e);
  assert.equal((await verify(p, { signup: v.body.signup })).body.step, "aboutYou");
  assert.equal((await verify(p, { signup: v.body.signup })).body.step, "aboutYou"); // first answer lost, tried again
});

test("two accounts on one phone keep its device id", async () => {
  const a = await join();
  const b = await signup(await verify(phone(), { device: { ...device, id: a.device } }), { device: { ...device, id: a.device } });
  assert.equal(b.body.device, a.device);
});

test("under 18, migrated person: opensOn set, dob saved and wins", async () => {
  const p = phone();
  await t.db.insert(users).values({ name: "Teen", phone: e164(p) });
  const c = await verify(p); // an account on a new device is confirmed first
  assert.equal(c.body.step, "confirm");
  const v = await t.call("POST", "/auth/confirm", { ticket: c.body.ticket, me: true, device });
  assert.equal(v.body.step, "aboutYou");
  const s = await signup(v, { dob: "2012-06-15" });
  assert.equal(s.status, 403);
  assert.equal(s.body.error, "under18");
  assert.equal(s.body.opensOn, "2030-06-15");
  assert.equal((await userByPhone(p))!.dob, "2012-06-15");
  t.tick(30_000);
  const c2 = await verify(p);
  // The saved date now stops the next sign-in before About you, so an older date can't be typed.
  const again = await t.call("POST", "/auth/confirm", { ticket: c2.body.ticket, me: true, device });
  assert.equal(again.status, 403);
  assert.equal(again.body.error, "under18");
  assert.equal(again.body.opensOn, "2030-06-15");
  const [u] = await t.db.select().from(users).where(eq(users.phone, e164(p)));
  assert.equal((await t.db.select().from(sessions).where(eq(sessions.userId, u!.id))).length, 0);
});

test("suspension blocks a right code and a live token, not a wrong code", async () => {
  const a = await join();
  await t.db.update(users).set({ suspendedAt: new Date(), suspendedUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, a.me.id));
  const v = await verify(a.p);
  assert.equal(v.status, 403);
  assert.equal(v.body.error, "suspended");
  const me = await t.call("GET", "/me", undefined, a.access);
  assert.equal(me.status, 403);
  assert.equal(me.body.error, "suspended");
  t.tick(30_000);
  await send(a.p);
  const real = t.lastCode(e164(a.p));
  const wrong = await t.call("POST", "/auth/code/verify", { to: a.p, code: real === "000000" ? "111111" : "000000", device });
  assert.equal(wrong.body.error, "wrongCode");
});

test("refresh rotates, tolerates reuse for 60 s, then, once its answer is used, ends every session", async () => {
  const a = await join();
  const r1 = await t.call("POST", "/auth/refresh", { refresh: a.refresh });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refresh, a.refresh);
  const r2 = await t.call("POST", "/auth/refresh", { refresh: a.refresh });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.refresh, r1.body.refresh);
  assert.equal((await t.call("GET", "/me", undefined, r1.body.access)).status, 200); // the app has the new token
  t.tick(61_000);
  const late = await t.call("POST", "/auth/refresh", { refresh: a.refresh });
  assert.equal(late.status, 401);
  assert.equal((await t.call("GET", "/me", undefined, r1.body.access)).status, 401);
  assert.equal((await t.call("GET", "/me", undefined, a.access)).status, 401);
});

test("a lost refresh answer signs nobody out: the old token gets the same new one until that one's access is used", async () => {
  const a = await join();
  assert.equal((await t.call("GET", "/me", undefined, a.access)).status, 200); // acks the sign-in; a rotation clears it
  const r1 = await t.call("POST", "/auth/refresh", { refresh: a.refresh }); // the answer never reaches the app
  assert.equal((await t.call("GET", "/me", undefined, a.access)).status, 200); // the older access token acks nothing
  t.tick(61_000);
  const again = await t.call("POST", "/auth/refresh", { refresh: a.refresh });
  assert.equal(again.status, 200);
  assert.equal(again.body.refresh, r1.body.refresh);
  assert.equal((await t.call("GET", "/me", undefined, again.body.access)).status, 200);
  t.tick(61_000);
  assert.equal((await t.call("POST", "/auth/refresh", { refresh: a.refresh })).status, 401);
  assert.equal((await t.call("GET", "/me", undefined, again.body.access)).status, 401);
});

test("a thief who refreshes twice, or more, is caught by the owner's older token", async () => {
  for (const times of [2, 3]) {
    const a = await join();
    let thief = { refresh: a.refresh, access: a.access };
    for (let i = 0; i < times; i++) thief = (await t.call("POST", "/auth/refresh", { refresh: thief.refresh })).body;
    // A made-up tag ends nothing.
    assert.equal((await t.call("POST", "/auth/refresh", { refresh: a.refresh.replace(/[^.]+$/, "A".repeat(22)) })).status, 401);
    assert.equal((await t.call("GET", "/me", undefined, thief.access)).status, 200);
    assert.equal((await t.call("POST", "/auth/refresh", { refresh: a.refresh })).status, 401);
    assert.equal((await t.call("GET", "/me", undefined, thief.access)).status, 401, `after ${times} refreshes`);
  }
});

test("refresh tokens from before tags still refresh, live or the one before", async () => {
  const a = await join();
  const sid = a.refresh.split(".")[0]!;
  // Rotated before tags with its answer lost: the row holds the old code's bare successor, the app still has `old`.
  const bare = createHmac("sha256", SECRET).update(`refresh:${sid}.old`).digest("base64url");
  await t.db.update(sessions).set({ prevRefreshHash: sha256("old"), refreshHash: sha256(bare), acked: false }).where(eq(sessions.id, sid));
  t.tick(61_000);
  const again = await t.call("POST", "/auth/refresh", { refresh: `${sid}.old` });
  assert.equal(again.body.refresh, `${sid}.${bare}`);
  const r = await t.call("POST", "/auth/refresh", { refresh: again.body.refresh });
  assert.equal(r.status, 200);
  assert.equal((await t.call("POST", "/auth/refresh", { refresh: r.body.refresh })).status, 200);
  assert.equal((await t.call("GET", "/me", undefined, a.access)).status, 200);
});

test("two refreshes at once both succeed", async () => {
  const a = await join();
  const both = await Promise.all([1, 2].map(() => t.call("POST", "/auth/refresh", { refresh: a.refresh })));
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
});

test("sign out ends the session", async () => {
  const a = await join();
  assert.equal((await t.call("POST", "/auth/signout", undefined, a.access)).status, 204);
  assert.equal((await t.call("GET", "/me", undefined, a.access)).status, 401);
});

test("a second send within 30 s is tooSoon", async () => {
  const p = phone();
  assert.equal((await send(p)).status, 200);
  const r = await send(p);
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "tooSoon");
  t.tick(30_000);
  assert.equal((await send(p)).status, 200);
});

test("five wrong codes lock out even the right one", async () => {
  const p = phone();
  await send(p);
  const real = t.lastCode(e164(p));
  const bad = real === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal((await t.call("POST", "/auth/code/verify", { to: p, code: bad, device })).body.error, "wrongCode");
  const r = await t.call("POST", "/auth/code/verify", { to: p, code: real, device });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "tooMany");
  t.tick(15 * 60_000 + 1); // let the shared IP counters clear for later tests
});

test("a code expires after 10 minutes", async () => {
  const p = phone();
  await send(p);
  const code = t.lastCode(e164(p));
  t.tick(10 * 60_000);
  const r = await t.call("POST", "/auth/code/verify", { to: p, code, device });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "codeExpired");
});

test("a code can't be used twice", async () => {
  const p = phone();
  const v = await verify(p);
  assert.equal(v.status, 200);
  const r = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(e164(p)), device });
  assert.equal(r.body.error, "codeExpired");
});

test("validation: abroad, garbage, bad signup tokens", async () => {
  const ab = await send("+44 7700 900123");
  assert.equal(ab.status, 400);
  assert.equal(ab.body.error, "abroad");
  for (const bad of [{ to: "hello" }, { to: 5 }, {}]) {
    const r = await t.call("POST", "/auth/code", bad);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid");
    assert.ok(r.body.message);
  }
  const v = await verify(phone());
  const old = await sign({ use: "signup", phone: e164(phone()), iat: 1, exp: 2 }, SECRET, "HS256");
  for (const tok of [v.body.signup + "x", "garbage", old]) {
    const r = await signup({ body: { signup: tok } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "expired");
  }
  const p = phone();
  await send(p);
  const w = await t.call("POST", "/auth/code/verify", { to: p, code: "123456", signup: v.body.signup + "x", device });
  assert.equal(w.body.error, "expired");
});

test("sending to an existing and a new number looks the same", async () => {
  const a = await join();
  t.tick(30_000);
  const known = await send(a.p);
  const fresh = await send(phone());
  assert.deepEqual(known, fresh);
});

const wrongOf = (c: string) => (c === "000000" ? "111111" : "000000");

test("20 wrong guesses at once: at most 5 are tried, the right code is then locked out", async () => {
  const p = phone();
  await send(p);
  const real = t.lastCode(e164(p))!;
  const rs = await Promise.all(Array.from({ length: 20 }, () => t.call("POST", "/auth/code/verify", { to: p, code: wrongOf(real), device })));
  assert.ok(rs.filter((r) => r.body.error === "wrongCode").length <= 5);
  assert.equal(rs.filter((r) => r.body.error === "tooMany").length + rs.filter((r) => r.body.error === "wrongCode").length, 20);
  const r = await t.call("POST", "/auth/code/verify", { to: p, code: real, device });
  assert.equal(r.body.error, "tooMany");
  t.tick(15 * 60_000 + 1);
});

test("three refreshes at once return the same new token", async () => {
  const a = await join();
  const rs = await Promise.all([1, 2, 3].map(() => t.call("POST", "/auth/refresh", { refresh: a.refresh })));
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
  assert.equal(new Set(rs.map((r) => r.body.refresh)).size, 1);
  assert.equal((await t.call("GET", "/me", undefined, rs[0]!.body.access)).status, 200);
});

test("garbage tokens end nothing; old tokens stay dead after signing in again", async () => {
  const a = await join();
  const sid = a.refresh.split(".")[0];
  assert.equal((await t.call("POST", "/auth/refresh", { refresh: `${sid}.garbage` })).status, 401);
  assert.equal((await t.call("GET", "/me", undefined, a.access)).status, 200);

  await t.call("POST", "/auth/signout", undefined, a.access);
  const v = await verify(a.p, { device: { ...device, id: a.device } });
  assert.equal(v.body.step, "signedIn");
  assert.equal((await t.call("GET", "/me", undefined, a.access)).status, 401);
  assert.equal((await t.call("POST", "/auth/refresh", { refresh: a.refresh })).status, 401);
  assert.equal((await t.call("GET", "/me", undefined, v.body.access)).status, 200);
});

test("refresh while suspended is refused without spending the token", async () => {
  const a = await join();
  await t.db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, a.me.id));
  const r = await t.call("POST", "/auth/refresh", { refresh: a.refresh });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "suspended");
  await t.db.update(users).set({ suspendedAt: null }).where(eq(users.id, a.me.id));
  assert.equal((await t.call("POST", "/auth/refresh", { refresh: a.refresh })).status, 200);
});

test("an aboutYou token is not a phoneStep token", async () => {
  const v = await verify(phone());
  assert.equal(v.body.step, "aboutYou");
  const p = phone();
  const r = await verify(p, { signup: v.body.signup });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "expired");
});

test("a ticket works once", async () => {
  const a = await join();
  const v = await verify(a.p);
  const body = { ticket: v.body.ticket, me: true, device };
  assert.equal((await t.call("POST", "/auth/confirm", body)).status, 200);
  const r = await t.call("POST", "/auth/confirm", body);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "expired");
});

test("a blank-named migrated account is confirmed as 'An account'", async () => {
  const p = phone();
  await t.db.insert(users).values({ name: "   ", phone: e164(p) });
  const v = await verify(p);
  assert.equal(v.status, 200);
  assert.equal(v.body.step, "confirm");
  assert.equal(v.body.name, "An account");
});

test("a malformed refresh sid is a 401, not a 500", async () => {
  const r = await t.call("POST", "/auth/refresh", { refresh: "------------------------------------.x" });
  assert.equal(r.status, 401);
});

test("a made-up device id is replaced", async () => {
  const s = await signup(await verify(phone()), { device: { ...device, id: "made-up" } });
  assert.equal(s.body.step, "signedIn");
  assert.notEqual(s.body.device, "made-up");
});

test("a migrated account without terms goes through About you", async () => {
  const p = phone();
  const [u] = await t.db.insert(users).values({ name: "Old Timer", phone: e164(p), dob: "1990-01-01" }).returning();
  const c = await verify(p);
  const v = await t.call("POST", "/auth/confirm", { ticket: c.body.ticket, me: true, device });
  assert.equal(v.body.step, "aboutYou");
  const s = await signup(v);
  assert.equal(s.body.step, "signedIn");
  const rows = await t.db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, u!.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.document, "terms");
});

test("PATCH /me keeps a city from the list, refuses any other, and null clears it", async () => {
  const a = await join();
  assert.equal(a.me.city, null);
  const set = await t.call("PATCH", "/me", { city: "Hyderabad" }, a.access);
  assert.equal(set.status, 200);
  assert.equal(set.body.city, "Hyderabad");
  assert.equal((await t.call("GET", "/me", undefined, a.access)).body.city, "Hyderabad");
  for (const city of ["Atlantis", "hyderabad", "Hyderabad, Telangana", "Banjara Hills, Hyderabad, Telangana 500034, India"]) {
    const bad = await t.call("PATCH", "/me", { city }, a.access);
    assert.equal(bad.status, 400, city);
    assert.equal(bad.body.error, "invalid");
  }
  assert.equal((await t.call("GET", "/me", undefined, a.access)).body.city, "Hyderabad"); // a refused city changes nothing
  const cleared = await t.call("PATCH", "/me", { city: null }, a.access);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.city, null);
  assert.equal((await t.call("GET", "/me", undefined, a.access)).body.city, null);
});
