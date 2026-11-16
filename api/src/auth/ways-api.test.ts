import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign } from "node:crypto";
import { eq } from "drizzle-orm";
import { sign } from "hono/jwt";
import { createApp } from "../app.ts";
import { testApp } from "../testkit.ts";
import { identities, passkeys, sessions, users } from "../db/schema.ts";
import { runDeletions } from "./deletion.ts";
import type { WaysConfig } from "./ways.ts";

// ---- doubles: Apple's and Google's signing key, and their endpoints
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key";
const publicJwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
const privateJwk = { ...rsa.privateKey.export({ format: "jwk" }), alg: "RS256", kid: KID };
const claims = (o: object, iss: string, aud: string) => {
  const iat = Math.floor(Date.now() / 1000);
  return sign({ iss, aud, iat, exp: iat + 600, ...o }, privateJwk as never, "RS256");
};
const GOOGLE = { clientId: "g-client", clientSecret: "g-secret", callback: "https://api.test/auth/google/callback", app: "heyorbit://google" };
let googleToken = ""; // what Google's token endpoint answers next
const stub = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u === "https://appleid.apple.com/auth/keys" || u === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [publicJwk] });
  if (u === "https://oauth2.googleapis.com/token") return Response.json({ id_token: googleToken });
  return new Response("no", { status: 404 });
}) as typeof fetch;
const waysCfg: WaysConfig = { passkey: { rpId: "heyorbit.in", origins: ["https://heyorbit.in"] }, apple: { audiences: ["com.unifesto.orbit"] }, google: GOOGLE, fetch: stub };

// ---- double: a software passkey (ES256, "none" attestation)
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
const b64 = (b: Buffer) => b.toString("base64url");
const cbor = (v: unknown): Buffer => {
  const head = (major: number, n: number) => (n < 24 ? Buffer.from([major << 5 | n]) : n < 256 ? Buffer.from([major << 5 | 24, n]) : Buffer.from([major << 5 | 25, n >> 8, n & 255]));
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -v - 1);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const m = v as Map<unknown, unknown>;
  return Buffer.concat([head(5, m.size), ...[...m].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
};
const RP = sha("heyorbit.in");
const authenticator = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credId = randomBytes(16);
  let counter = 0;
  const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
  const id = b64(credId);
  return {
    id,
    create(challenge: string, origin = "https://heyorbit.in") {
      const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin }));
      const len = Buffer.alloc(2);
      len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([RP, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cose]);
      const att = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return { id, rawId: id, type: "public-key", response: { clientDataJSON: b64(clientData), attestationObject: b64(att), transports: ["internal"] }, clientExtensionResults: {} };
    },
    get(challenge: string, origin = "https://heyorbit.in") {
      const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin }));
      const c = Buffer.alloc(4);
      c.writeUInt32BE(++counter);
      const authData = Buffer.concat([RP, Buffer.from([0x05]), c]);
      const signature = nodeSign("sha256", Buffer.concat([authData, sha(clientData)]), privateKey);
      return { id, rawId: id, type: "public-key", response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) }, clientExtensionResults: {} };
    },
  };
};
type Authn = ReturnType<typeof authenticator>;

// ---- app and helpers (as security-api.test.ts)
let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp({ ways: waysCfg })));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const MIN = 60_000, DAY = 24 * 60 * MIN;
let n = 0;
const phone = () => `7${String(5_000_000 + ++n * 13).padStart(9, "0")}`;
const email = () => `w${++n}@example.com`;
const key = (to: string) => (to.includes("@") ? to : `+91${to}`);
const verify = async (to: string, extra: object = {}) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(key(to)), device, ...extra });
};
const codeTo = async (to: string) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.lastCode(key(to))!;
};
type A = { p: string; access: string; device: string; me: { id: string } };
const join = async (withEmail = false) => {
  const p = phone();
  const v = await verify(p);
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  const a = { p, ...s.body } as A & { email?: string };
  if (withEmail) {
    a.email = email();
    await t.db.update(users).set({ email: a.email, emailVerifiedAt: new Date() }).where(eq(users.id, a.me.id));
  }
  return a;
};
const as = (access: string) => (m: string, path: string, body?: unknown) => t.call(m, path, body, access);
const security = async (access: string) => (await as(access)("GET", "/me/security")).body;
const newDevice = async (a: A, id: string) => {
  const dev = { ...device, id };
  const v = await verify(a.p, { device: dev });
  assert.equal(v.body.step, "confirm");
  const c = await t.call("POST", "/auth/confirm", { ticket: v.body.ticket, me: true, device: dev });
  assert.equal(c.body.step, "signedIn");
  return c.body.access as string;
};
const userRow = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0]!;
const passkeyNotices = (to: string, change: string) => t.notices.filter((x) => x.kind === "signInMethodChanged" && (x.to as any).contact === to && (x.data as any).method === "passkey" && (x.data as any).change === change);

// passkeys
const addPasskey = async (access: string, k: Authn = authenticator()) => {
  const o = await as(access)("POST", "/me/passkeys/options");
  assert.equal(o.status, 200);
  const r = await as(access)("POST", "/me/passkeys", { challenge: o.body.challenge, credential: k.create(o.body.challenge) });
  return { k, r };
};
const passkeyProof = async (k: Authn, origin?: string) => {
  const o = await t.call("POST", "/auth/passkey/options");
  return { challenge: o.body.challenge as string, credential: k.get(o.body.challenge, origin) };
};
const staleThenFresh = async (a: A) => {
  t.tick(11 * MIN);
  assert.equal((await as(a.access)("POST", "/me/fresh", { via: "phone", code: await codeTo(a.p) })).status, 200);
};

// apple and google
const nonce = async () => (await t.call("POST", "/auth/nonce")).body.nonce as string;
const appleProof = async (sub: string, o: { email?: string; verified?: boolean; claimNonce?: string; nonce?: string } = {}) => {
  const nn = o.nonce ?? (await nonce());
  const idToken = await claims({ sub, email: o.email, email_verified: o.verified ?? true, nonce: o.claimNonce ?? nn }, "https://appleid.apple.com", "com.unifesto.orbit");
  return { idToken, nonce: nn };
};
const appleIn = async (sub: string, o: Parameters<typeof appleProof>[1] & { name?: string; dev?: object } = {}) =>
  t.call("POST", "/auth/apple", { ...(await appleProof(sub, o)), device: o.dev ?? device, name: o.name });
const newVerifier = () => randomBytes(32).toString("base64url");
// The whole browser trip: start, callback; answers the callback's Location.
const googleTrip = async (token: string | null, query = "code=x") => {
  const s = await t.call("POST", "/auth/google/start");
  assert.equal(s.status, 200);
  const verifier = s.body.verifier as string;
  const state = new URL(s.body.url).searchParams.get("state")!;
  if (token) googleToken = token;
  const res = await t.app.request(`/auth/google/callback?${query}&state=${state}`);
  assert.equal(res.status, 302);
  return Object.assign(new URL(res.headers.get("location")!), { verifier });
};
const googleToken_ = (sub: string, o: { email?: string; verified?: boolean; hd?: string } = {}) =>
  claims({ sub, email: o.email ?? `${sub}@gmail.test`, email_verified: o.verified ?? true, name: "Gia Shah", hd: o.hd }, "https://accounts.google.com", GOOGLE.clientId);
const googleProof = async (sub: string, o: Parameters<typeof googleToken_>[1] = {}) => {
  const loc = await googleTrip(await googleToken_(sub, o));
  return { grant: loc.searchParams.get("grant")!, verifier: loc.verifier };
};
const googleIn = async (sub: string, dev: object = device) => t.call("POST", "/auth/google", { ...(await googleProof(sub)), device: dev });

// ---- 1. passkeys
test("passkey: add needs fresh, lists with device name, rename, sign in, replay, wrong origin, other account, remove, notices", async () => {
  const a = await join(), b = await join();
  const theirs = await addPasskey(b.access);
  assert.equal(theirs.r.status, 201);
  t.tick(11 * MIN);
  assert.equal((await as(a.access)("POST", "/me/passkeys/options")).body.error, "needsFresh");
  await staleThenFresh(a);

  const { k, r } = await addPasskey(a.access);
  assert.equal(r.status, 201);
  assert.equal(r.body.name, "iPhone");
  assert.equal(passkeyNotices(`+91${a.p}`, "added").length, 1);
  const listed = (await security(a.access)).passkeys;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "iPhone");
  assert.equal((await as(a.access)("PATCH", `/me/passkeys/${r.body.id}`, { name: "Work laptop" })).body.name, "Work laptop");
  assert.equal((await security(a.access)).passkeys[0].name, "Work laptop");

  const dev = { name: "Pixel", client: "app", id: "dev-pk" };
  const ok = await t.call("POST", "/auth/passkey", { ...(await passkeyProof(k)), device: dev });
  assert.equal(ok.body.step, "signedIn");
  assert.equal(ok.body.me.id, a.me.id);

  const replay = await passkeyProof(k);
  assert.equal((await t.call("POST", "/auth/passkey", { ...replay, device })).body.step, "signedIn");
  const again = await t.call("POST", "/auth/passkey", { challenge: replay.challenge, credential: k.get(replay.challenge), device });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, "notProven");

  const evil = await t.call("POST", "/auth/passkey", { ...(await passkeyProof(k, "https://evil.example")), device });
  assert.equal(evil.status, 400);

  const cross = await as(a.access)("POST", "/me/fresh", { via: "passkey", ...(await passkeyProof(theirs.k)) });
  assert.equal(cross.status, 400);
  assert.equal(cross.body.error, "notProven");

  t.tick(11 * MIN);
  assert.equal((await as(a.access)("DELETE", `/me/passkeys/${r.body.id}`)).body.error, "needsFresh");
  assert.equal((await as(a.access)("POST", "/me/fresh", { via: "passkey", ...(await passkeyProof(k)) })).status, 200);
  assert.equal((await as(a.access)("DELETE", `/me/passkeys/${r.body.id}`)).status, 204);
  assert.equal(passkeyNotices(`+91${a.p}`, "removed").length, 1);
  assert.equal((await security(a.access)).passkeys.length, 0);
});

// ---- 2. the hold
test("hold: a passkey added after the mark doesn't lift it; one added before does", async () => {
  const a = await join(true);
  const b = await newDevice(a, "dev-B");
  t.tick(1000);
  const late = await addPasskey(b);
  assert.equal(late.r.status, 201);
  assert.equal((await as(b)("POST", "/me/fresh", { via: "passkey", ...(await passkeyProof(late.k)) })).status, 200);
  const held = await as(b)("DELETE", "/me/email");
  assert.equal(held.status, 403);
  assert.equal(held.body.error, "held");

  const c = await join(true);
  const early = await addPasskey(c.access);
  assert.equal(early.r.status, 201);
  t.tick(1000);
  const d = await newDevice(c, "dev-D");
  assert.equal((await as(d)("POST", "/me/fresh", { via: "passkey", ...(await passkeyProof(early.k)) })).status, 200);
  assert.equal((await security(d)).heldUntil, null);
  assert.equal((await as(d)("DELETE", "/me/email")).status, 204);
});

// ---- 3. last way in
test("last way in: the only passkey of an account without a phone can't be removed", async () => {
  const a = await join();
  const { r } = await addPasskey(a.access);
  assert.equal(r.status, 201);
  await t.db.update(users).set({ phone: null }).where(eq(users.id, a.me.id));
  const res = await as(a.access)("DELETE", `/me/passkeys/${r.body.id}`);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "lastWay");
});

// ---- 4. Apple
test("apple: new person goes phone, about you with the name, signup; then signs straight in", async () => {
  const sub = `apple-${randomBytes(6).toString("hex")}`;
  const first = await appleIn(sub, { email: "new.apple@example.com", name: "Asha Rao" });
  assert.equal(first.body.step, "phone");
  const p = phone();
  const v = await verify(p, { signup: first.body.signup });
  assert.equal(v.body.step, "aboutYou");
  assert.equal(v.body.name, "Asha Rao");
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Asha Rao", dob: "1999-01-01", device });
  assert.equal(s.body.step, "signedIn");
  const sec = await security(s.body.access);
  assert.deepEqual(sec.apple, { email: "new.apple@example.com" });

  const again = await appleIn(sub, { dev: { ...device, id: "other-phone" } });
  assert.equal(again.body.step, "signedIn");
  assert.equal(again.body.me.id, s.body.me.id);
});

test("apple: a reused nonce and a mismatched nonce are refused; the hex-sha256 nonce is fine", async () => {
  const sub = `apple-${randomBytes(6).toString("hex")}`;
  const proof = await appleProof(sub);
  assert.equal((await t.call("POST", "/auth/apple", { ...proof, device })).body.step, "phone");
  const reuse = await t.call("POST", "/auth/apple", { ...proof, device });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error, "notProven");

  const bad = await appleIn(sub, { claimNonce: "something-else" });
  assert.equal(bad.status, 400);
  const nn = await nonce();
  const hex = await appleIn(sub, { nonce: nn, claimNonce: createHash("sha256").update(nn).digest("hex") });
  assert.equal(hex.body.step, "phone");
  assert.equal((await t.call("POST", "/auth/apple", { idToken: "garbage", nonce: await nonce(), device })).status, 400);
});

test("apple: its verified email matching an account links and signs in", async () => {
  const a = await join(true);
  const sub = `apple-${randomBytes(6).toString("hex")}`;
  const r = await appleIn(sub, { email: a.email });
  assert.equal(r.body.step, "signedIn");
  assert.equal(r.body.me.id, a.me.id);
  assert.deepEqual((await security(r.body.access)).apple, { email: a.email });
  // unverified Apple email proves nothing
  const b = await join(true);
  assert.equal((await appleIn(`apple-${randomBytes(6).toString("hex")}`, { email: b.email, verified: false })).body.step, "phone");
});

test("apple: link from security, taken by another account, remove, remove again", async () => {
  const a = await join(), b = await join();
  const sub = `apple-${randomBytes(6).toString("hex")}`;
  const linked = await as(a.access)("POST", "/me/apple", await appleProof(sub));
  assert.equal(linked.status, 201);
  const taken = await as(b.access)("POST", "/me/apple", await appleProof(sub));
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, "appleTaken");

  assert.equal((await as(a.access)("DELETE", "/me/apple")).status, 204);
  assert.equal((await security(a.access)).apple, null);
  assert.equal((await as(a.access)("DELETE", "/me/apple")).status, 404);
});

// ---- 5. Google
test("google: start is 503 without config, a google url with it", async () => {
  const bare = createApp({ db: t.db, store: t.store, secret: "test-secret-that-is-at-least-32-characters", now: t.now, send: async () => {}, notify: async () => {}, ways: { ...waysCfg, google: undefined } });
  const res = await bare.request("/auth/google/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as any).error, "notSetUp");

  const s = await t.call("POST", "/auth/google/start");
  assert.ok(s.body.verifier);
  const u = new URL(s.body.url);
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.ok(u.searchParams.get("state"));
});

test("google: callback, verifier binding, new vs linked, one use", async () => {
  const sub = `g-${randomBytes(6).toString("hex")}`;
  const loc = await googleTrip(await googleToken_(sub));
  const verifier = loc.verifier;
  assert.equal(loc.protocol + "//" + loc.host, "heyorbit://google");
  const grant = loc.searchParams.get("grant")!;
  assert.ok(grant);

  const wrong = await t.call("POST", "/auth/google", { grant, verifier: newVerifier(), device });
  assert.equal(wrong.status, 400);
  // the grant is spent by the wrong try
  assert.equal((await t.call("POST", "/auth/google", { grant, verifier, device })).status, 400);

  const proof = await googleProof(sub);
  const ok = await t.call("POST", "/auth/google", { ...proof, device });
  assert.equal(ok.body.step, "phone");
  assert.equal((await t.call("POST", "/auth/google", { ...proof, device })).status, 400);

  const v = await verify(phone(), { signup: ok.body.signup });
  assert.equal(v.body.name, "Gia Shah");
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Gia Shah", dob: "1999-01-01", device });
  assert.equal(s.body.step, "signedIn");
  const again = await googleIn(sub);
  assert.equal(again.body.step, "signedIn");
  assert.equal(again.body.me.id, s.body.me.id);
});

test("google: access_denied is cancelled, an unverified email is unverified", async () => {
  const denied = await googleTrip(null, "error=access_denied");
  assert.equal(denied.searchParams.get("error"), "cancelled");
  const unverified = await googleTrip(await googleToken_(`g-${randomBytes(6).toString("hex")}`, { verified: false }));
  assert.equal(unverified.searchParams.get("error"), "unverified");
});

// ---- 6. fresh with Google or Apple proves only this account's identity
test("fresh: Google and Apple prove only an identity linked to this account", async () => {
  const a = await join(), b = await join();
  const aSub = `apple-${randomBytes(6).toString("hex")}`, bSub = `apple-${randomBytes(6).toString("hex")}`;
  const gA = `g-${randomBytes(6).toString("hex")}`, gB = `g-${randomBytes(6).toString("hex")}`;
  assert.equal((await as(a.access)("POST", "/me/apple", await appleProof(aSub))).status, 201);
  assert.equal((await as(b.access)("POST", "/me/apple", await appleProof(bSub))).status, 201);
  assert.equal((await as(a.access)("POST", "/me/google", await googleProof(gA))).status, 201);
  assert.equal((await as(b.access)("POST", "/me/google", await googleProof(gB))).status, 201);

  t.tick(11 * MIN);
  assert.equal((await security(a.access)).fresh, false);
  const wrongApple = await as(a.access)("POST", "/me/fresh", { via: "apple", ...(await appleProof(bSub)) });
  assert.equal(wrongApple.body.error, "notProven");
  const wrongGoogle = await as(a.access)("POST", "/me/fresh", { via: "google", ...(await googleProof(gB)) });
  assert.equal(wrongGoogle.body.error, "notProven");
  assert.equal((await security(a.access)).fresh, false);
  assert.equal((await as(a.access)("POST", "/me/fresh", { via: "apple", ...(await appleProof(aSub)) })).status, 200);
  t.tick(11 * MIN);
  assert.equal((await as(a.access)("POST", "/me/fresh", { via: "google", ...(await googleProof(gA)) })).status, 200);
  assert.equal((await security(a.access)).fresh, true);
});

// ---- 7. addWay
test("addWay: Apple, then a number already on an account on a known device, offers to link Apple", async () => {
  const a = await join();
  const sub = `apple-${randomBytes(6).toString("hex")}`;
  const first = await appleIn(sub);
  assert.equal(first.body.step, "phone");
  const v = await verify(a.p, { signup: first.body.signup, device: { ...device, id: a.device } });
  assert.equal(v.body.step, "signedIn");
  assert.ok(v.body.addWay.token);
  assert.equal(v.body.addWay.provider, "apple");
  assert.equal((await security(v.body.access)).apple, null);
  const r = await as(v.body.access)("POST", "/me/ways", { token: v.body.addWay.token });
  assert.equal(r.status, 201);
  assert.ok((await security(v.body.access)).apple);
  assert.equal((await appleIn(sub)).body.me.id, a.me.id);
});

// ---- 8. deletion day 30
test("deletion day 30: passkeys and identities go, Apple's refresh token is revoked", async () => {
  const a = await join();
  assert.equal((await addPasskey(a.access)).r.status, 201);
  await t.db.insert(identities).values({ userId: a.me.id, provider: "apple", subject: `apple-${randomBytes(6).toString("hex")}`, email: null, appleRefresh: "refresh-1" });
  await t.db.insert(identities).values({ userId: a.me.id, provider: "google", subject: `g-${randomBytes(6).toString("hex")}`, email: null });
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now() - 31 * DAY), deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, a.me.id));
  const revoked: string[] = [];
  const done = await runDeletions(t.db, async () => {}, t.now(), async (tok) => void revoked.push(tok));
  assert.equal(done, 1);
  assert.equal((await t.db.select().from(passkeys).where(eq(passkeys.userId, a.me.id))).length, 0);
  assert.equal((await t.db.select().from(identities).where(eq(identities.userId, a.me.id))).length, 0);
  assert.deepEqual(revoked, ["refresh-1"]);
  assert.ok((await userRow(a.me.id)).deletedAt);
});

// ---- review fixes (2214c19)
test("hold: a second Is this you? keeps the running mark; after 7 days it moves", async () => {
  const a = await join(true);
  const b = await newDevice(a, "dev-B");
  const t0 = (await userRow(a.me.id)).newDevicePhoneAt!.getTime();
  t.tick(1000);
  const { k, r } = await addPasskey(b);
  assert.equal(r.status, 201);
  t.tick(1000);
  await newDevice(a, "dev-C");
  assert.equal((await userRow(a.me.id)).newDevicePhoneAt!.getTime(), t0);
  assert.equal((await as(b)("POST", "/me/fresh", { via: "passkey", ...(await passkeyProof(k)) })).status, 200);
  const held = await as(b)("DELETE", "/me/email");
  assert.equal(held.status, 403);
  assert.equal(held.body.error, "held");

  t.tick(7 * DAY + MIN);
  await newDevice(a, "dev-D");
  assert.ok((await userRow(a.me.id)).newDevicePhoneAt!.getTime() > t0 + 7 * DAY);
});

test("hold: covers removing Google, Apple, a passkey and deleting the account when only the phone proved freshness", async () => {
  const a = await join(true);
  const pk = await addPasskey(a.access);
  assert.equal((await as(a.access)("POST", "/me/apple", await appleProof(`apple-${randomBytes(6).toString("hex")}`))).status, 201);
  assert.equal((await as(a.access)("POST", "/me/google", await googleProof(`g-${randomBytes(6).toString("hex")}`))).status, 201);
  t.tick(1000);
  const b = await newDevice(a, "dev-B");
  for (const [m, path] of [["DELETE", "/me/google"], ["DELETE", "/me/apple"], ["DELETE", `/me/passkeys/${pk.r.body.id}`], ["POST", "/me/deletion"]] as const) {
    const r = await as(b)(m, path);
    assert.equal(r.status, 403, path);
    assert.equal(r.body.error, "held", path);
  }
});

test("google: a non-Gmail address without hd finds no account; with hd or @gmail.com it does", async () => {
  const work = `riya${++n}@oldjob${n}.com`, gm = `riya${++n}@gmail.com`;
  const a = await join(), g = await join();
  await t.db.update(users).set({ email: work, emailVerifiedAt: new Date() }).where(eq(users.id, a.me.id));
  await t.db.update(users).set({ email: gm, emailVerifiedAt: new Date() }).where(eq(users.id, g.me.id));
  const post = async (sub: string, o: Parameters<typeof googleToken_>[1]) => t.call("POST", "/auth/google", { ...(await googleProof(sub, o)), device });

  assert.equal((await post(`g-${randomBytes(6).toString("hex")}`, { email: work })).body.step, "phone");
  const hd = await post(`g-${randomBytes(6).toString("hex")}`, { email: work, hd: work.split("@")[1] });
  assert.equal(hd.body.step, "signedIn");
  assert.equal(hd.body.me.id, a.me.id);
  const gmail = await post(`g-${randomBytes(6).toString("hex")}`, { email: gm });
  assert.equal(gmail.body.step, "signedIn");
  assert.equal(gmail.body.me.id, g.me.id);
});

test("/me/ways: works once, and not from another account's session", async () => {
  const offer = async () => {
    const a = await join();
    const first = await appleIn(`apple-${randomBytes(6).toString("hex")}`);
    const v = await verify(a.p, { signup: first.body.signup, device: { ...device, id: a.device } });
    assert.ok(v.body.addWay.token);
    return { a, access: v.body.access as string, token: v.body.addWay.token as string };
  };
  const o = await offer();
  assert.equal((await as(o.access)("POST", "/me/ways", { token: o.token })).status, 201);
  const again = await as(o.access)("POST", "/me/ways", { token: o.token });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, "expired");

  const p = await offer(), other = await join();
  const stolen = await as(other.access)("POST", "/me/ways", { token: p.token });
  assert.equal(stolen.status, 400);
  assert.equal(stolen.body.error, "expired");
  assert.equal((await as(p.access)("POST", "/me/ways", { token: p.token })).status, 201); // still the owner's
});

test("linking when not fresh is refused without spending the Google grant or Apple nonce", async () => {
  const a = await join();
  const stale = () => t.db.update(sessions).set({ freshAt: null }).where(eq(sessions.userId, a.me.id));
  const g = await googleProof(`g-${randomBytes(6).toString("hex")}`);
  const ap = await appleProof(`apple-${randomBytes(6).toString("hex")}`);
  await stale();
  assert.equal((await as(a.access)("POST", "/me/google", g)).body.error, "needsFresh");
  assert.equal((await as(a.access)("POST", "/me/apple", ap)).body.error, "needsFresh");
  assert.equal((await as(a.access)("POST", "/me/fresh", { via: "phone", code: await codeTo(a.p) })).status, 200);
  assert.equal((await as(a.access)("POST", "/me/google", g)).status, 201);
  assert.equal((await as(a.access)("POST", "/me/apple", ap)).status, 201);
});

test("apple tokens: wrong aud, iss, expired, unknown kid, HS256 refused; iat 30 s ahead ok, 5 min ahead refused", async () => {
  const sub = `apple-${randomBytes(6).toString("hex")}`;
  const now = Math.floor(Date.now() / 1000);
  const tok = async (o: { iss?: string; aud?: string; exp?: number; iat?: number; jwk?: object; alg?: "RS256" | "HS256" }) => {
    const nn = await nonce();
    const payload = { iss: o.iss ?? "https://appleid.apple.com", aud: o.aud ?? "com.unifesto.orbit", iat: o.iat ?? now, exp: o.exp ?? now + 600, sub, nonce: nn };
    const idToken = o.alg === "HS256" ? await sign(payload, "shared-secret", "HS256") : await sign(payload, (o.jwk ?? privateJwk) as never, "RS256");
    return t.call("POST", "/auth/apple", { idToken, nonce: nn, device });
  };
  const refused = async (label: string, o: Parameters<typeof tok>[0]) => {
    const r = await tok(o);
    assert.equal(r.status, 400, label);
    assert.equal(r.body.error, "notProven", label);
  };
  await refused("aud", { aud: "com.other.app" });
  await refused("iss", { iss: "https://evil.example" });
  await refused("expired", { exp: now - 100, iat: now - 700 });
  await refused("kid", { jwk: { ...privateJwk, kid: "unknown-kid" } });
  await refused("hs256", { alg: "HS256" });
  await refused("iat +5min", { iat: now + 300 });
  assert.equal((await tok({ iat: now + 30 })).body.step, "phone");
});

test("hold notice skips an Apple private-relay address", async () => {
  const a = await join();
  const relayMail = `x${++n}@privaterelay.appleid.com`;
  await t.db.insert(identities).values({ userId: a.me.id, provider: "apple", subject: `apple-${randomBytes(6).toString("hex")}`, email: relayMail, createdAt: new Date(t.now() - 1000) });
  const b = await newDevice(a, "dev-B");
  const before = t.notices.length;
  const r = await as(b)("DELETE", "/me/apple");
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "held");
  assert.equal(t.notices.slice(before).filter((x) => x.kind === "signInMethodChangeHeld").length, 0);
  assert.equal(t.notices.filter((x) => (x.to as any).contact === relayMail).length, 0);
});
