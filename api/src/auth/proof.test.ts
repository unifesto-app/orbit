import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, KeyObject, sign as signWith } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers"; // first: it loads the reflect-metadata x509 needs
import * as x509 from "@peculiar/x509";
import { proofOf, type Proof } from "@orbit/contract";
import { appsFrom, DEFAULT_BUNDLES, keptKey, PER_KEY_DAY, proofs, readKey, type ProofConfig } from "./proof.ts";
import { memoryStore } from "./store.ts";
import { testApp } from "../testkit.ts";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
const APP = "TEAM123456.in.heyorbit.app";
const DAY = 24 * 60 * 60 * 1000;
const cbor = (v: unknown) => Buffer.from(isoCBOR.encode(v as never));

// ---- double: App Attest, with a root of its own standing in for Apple's
async function fakeApple() {
  const rootKeys = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const notBefore = new Date(Date.now() - DAY), notAfter = new Date(Date.now() + DAY);
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=Test App Attestation Root",
    notBefore,
    notAfter,
    keys: rootKeys,
    signingAlgorithm: ALG,
    extensions: [new x509.BasicConstraintsExtension(true, undefined, true)],
  });
  // One iPhone's key: attests itself once, then signs assertions.
  async function phone(appId = APP, environment = "appattestdevelop") {
    const keys = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
    const point = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey));
    const keyId = sha(point);
    let counter = 0;
    return {
      keyId: keyId.toString("base64"),
      async attest(signed: string) {
        const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, point.subarray(1, 33)], [-3, point.subarray(33)]]));
        const env = Buffer.from(environment.padEnd(16, "\0"), "latin1");
        const authData = Buffer.concat([sha(appId), Buffer.from([0x40]), Buffer.alloc(4), env, Buffer.from([0, 32]), keyId, cose]);
        const nonce = sha(Buffer.concat([authData, sha(signed)]));
        const leaf = await x509.X509CertificateGenerator.create({
          serialNumber: "02",
          subject: "CN=App Attest key",
          issuer: root.subject,
          notBefore,
          notAfter,
          publicKey: keys.publicKey,
          signingKey: rootKeys.privateKey,
          signingAlgorithm: ALG,
          extensions: [new x509.Extension("1.2.840.113635.100.8.2", false, Buffer.concat([Buffer.from("3024a1220420", "hex"), nonce]))],
        });
        const attStmt = new Map<string, unknown>([["x5c", [new Uint8Array(leaf.rawData)]], ["receipt", new Uint8Array(8)]]);
        return cbor(new Map<string, unknown>([["fmt", "apple-appattest"], ["attStmt", attStmt], ["authData", authData]])).toString("base64");
      },
      // `as`: the app id put in the signed data, the attested app's own unless a test poses as another.
      assert(signed: string, as = appId) {
        const authData = Buffer.concat([sha(as), Buffer.from([0]), Buffer.from([0, 0, 0, ++counter])]);
        const signature = signWith("sha256", sha(Buffer.concat([authData, sha(signed)])), KeyObject.from(keys.privateKey));
        return cbor(new Map<string, unknown>([["signature", signature], ["authenticatorData", authData]])).toString("base64");
      },
    };
  }
  return { root: root.toString("pem"), phone };
}

// ---- double: Google (a service account's token, then the verdict the token stands for) and Cloudflare
const serviceKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
// `pkg`: the package that asked (Google decodes the token only under it); `reqPkg`/`appPkg` make the verdict say another.
type Verdict = { hash: string; app?: string; certs?: string[]; device?: string[]; pkg?: string; reqPkg?: string; appPkg?: string };
const androidToken = (v: Verdict) => Buffer.from(JSON.stringify(v)).toString("base64url");
function fakeServices() {
  const calls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "google-access", expires_in: 3600 });
    if (url.startsWith("https://playintegrity.googleapis.com/")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer google-access");
      const v = JSON.parse(Buffer.from(JSON.parse(String(init?.body)).integrity_token, "base64url").toString()) as Verdict;
      const pkg = v.pkg ?? "in.heyorbit.app";
      // Google opens a token only under the package that asked for it.
      if (!url.includes(`/v1/${pkg}:decodeIntegrityToken`)) return new Response("wrong package", { status: 400 });
      return Response.json({
        tokenPayloadExternal: {
          requestDetails: { requestPackageName: v.reqPkg ?? pkg, requestHash: v.hash, timestampMillis: String(Date.now()) },
          appIntegrity: { appRecognitionVerdict: v.app ?? "PLAY_RECOGNIZED", packageName: v.appPkg ?? pkg, certificateSha256Digest: v.certs ?? ["play-key"] },
          deviceIntegrity: { deviceRecognitionVerdict: v.device ?? ["MEETS_DEVICE_INTEGRITY"] },
        },
      });
    }
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      const { response } = JSON.parse(String(init?.body));
      return Response.json(response === "good" ? { success: true } : { success: false, "error-codes": ["invalid-input-response"] });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { f, calls };
}

async function setup(enforce = true, extra: Partial<ProofConfig> = {}) {
  const apple = await fakeApple();
  const services = fakeServices();
  const cfg: ProofConfig = {
    enforce,
    apple: { appIds: [APP], roots: [apple.root] },
    play: { packageNames: ["in.heyorbit.app", "in.heyorbit.launch", "in.heyorbit.station"], email: "integrity@orbit.iam.gserviceaccount.com", key: serviceKey, certs: ["test-build-key"] },
    turnstile: { secret: "turnstile-secret" },
    fetch: services.f,
    ...extra,
  };
  const raw = proofs(cfg, memoryStore());
  // `check` as a yes or no; `raw` for why not.
  const p = { challenge: raw.challenge, check: async (proof: Proof | undefined, what: string) => (await raw.check(proof, what)) === null };
  return { p, raw, apple, services };
}
const what = proofOf.code;
const quiet = async <T>(run: () => Promise<T>) => {
  const orig = console.warn;
  const warned: string[] = [];
  console.warn = (m: string) => void warned.push(String(m));
  try {
    return { result: await run(), warned };
  } finally {
    console.warn = orig;
  }
};

// ---------- iPhone ----------

test("an iPhone attests its key once, then asserts; each challenge works once", async () => {
  const { p, apple } = await setup();
  const phone = await apple.phone();
  let c = await p.challenge();
  const first: Proof = { kind: "ios", challenge: c, keyId: phone.keyId, attestation: await phone.attest(`${c}:${what}`) };
  assert.equal(await p.check(first, what), true);
  assert.equal((await quiet(() => p.check(first, what))).result, false); // the challenge is spent

  c = await p.challenge();
  assert.equal(await p.check({ kind: "ios", challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${what}`) }, what), true);
  // Signed for Google's start, sent with a code.
  c = await p.challenge();
  const other = { kind: "ios" as const, challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${proofOf.google}`) };
  assert.equal((await quiet(() => p.check(other, what))).result, false);
  // Neither an attestation nor an assertion.
  c = await p.challenge();
  assert.equal((await quiet(() => p.check({ kind: "ios", challenge: c, keyId: phone.keyId }, what))).result, false);
});

test("a production key attests too", async () => {
  const { p, apple } = await setup();
  const phone = await apple.phone(APP, "appattest");
  const c = await p.challenge();
  assert.equal(await p.check({ kind: "ios", challenge: c, keyId: phone.keyId, attestation: await phone.attest(`${c}:${what}`) }, what), true);
});

test("an attestation fails for another app, another root, or another key id", async () => {
  const { p, apple } = await setup();
  const elsewhere = await fakeApple();
  const cases = [
    { why: /: app$/, make: async () => ({ phone: await apple.phone("OTHERTEAM1.in.heyorbit.app"), keyId: null }) },
    { why: /trust anchor/, make: async () => ({ phone: await elsewhere.phone(), keyId: null }) },
    { why: /: key$/, make: async () => ({ phone: await apple.phone(), keyId: (await apple.phone()).keyId }) },
  ];
  for (const { why, make } of cases) {
    const { phone, keyId } = await make();
    const c = await p.challenge();
    const proof: Proof = { kind: "ios", challenge: c, keyId: keyId ?? phone.keyId, attestation: await phone.attest(`${c}:${what}`) };
    const { result, warned } = await quiet(() => p.check(proof, what));
    assert.equal(result, false);
    assert.equal(warned.length, 1);
    assert.match(warned[0]!, why);
  }
});

test("an assertion from a key never attested here fails, so the app attests again", async () => {
  const { p, apple } = await setup();
  const phone = await apple.phone();
  const c = await p.challenge();
  const { result, warned } = await quiet(() => p.check({ kind: "ios", challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${what}`) }, what));
  assert.equal(result, false);
  assert.match(warned[0]!, /unknownKey/);
});

// ---------- the host apps (Orbit Launch, Station and Crew prove themselves too, 22 Nov 2026) ----------

const LAUNCH = "TEAM123456.in.heyorbit.launch";

test("each listed app attests and asserts; one not on the list is refused", async () => {
  const { p, apple } = await setup(); // p lists the Orbit app alone
  const both = proofs({ enforce: true, apple: { appIds: [APP, LAUNCH], roots: [apple.root] } }, memoryStore());
  const ok = async (r: Promise<string | null>) => (await quiet(() => r)).result === null;
  const launch = await apple.phone(LAUNCH);
  let c = await both.challenge();
  assert.equal(await ok(both.check({ kind: "ios", challenge: c, keyId: launch.keyId, attestation: await launch.attest(`${c}:${what}`) }, what)), true);
  c = await both.challenge();
  assert.equal(await ok(both.check({ kind: "ios", challenge: c, keyId: launch.keyId, assertion: launch.assert(`${c}:${what}`) }, what)), true);
  // The Orbit app's own key still works beside it.
  const orbit = await apple.phone(APP);
  c = await both.challenge();
  assert.equal(await ok(both.check({ kind: "ios", challenge: c, keyId: orbit.keyId, attestation: await orbit.attest(`${c}:${what}`) }, what)), true);
  // A server listing only the Orbit app refuses Launch's attestation as another app's.
  c = await p.challenge();
  const attestation = await launch.attest(`${c}:${what}`);
  const { result, warned } = await quiet(() => p.check({ kind: "ios", challenge: c, keyId: launch.keyId, attestation }, what));
  assert.equal(result, false);
  assert.match(warned[0]!, /: app$/);
});

test("a key's assertions answer to the app that attested it, and stop if that app leaves the list", async () => {
  const { apple } = await setup();
  const store = memoryStore();
  const ok = async (r: Promise<string | null>) => (await quiet(() => r)).result === null;
  const both = proofs({ enforce: true, apple: { appIds: [APP, LAUNCH], roots: [apple.root] } }, store);
  const launch = await apple.phone(LAUNCH);
  let c = await both.challenge();
  assert.equal(await ok(both.check({ kind: "ios", challenge: c, keyId: launch.keyId, attestation: await launch.attest(`${c}:${what}`) }, what)), true);
  // Launch's own key, signing data that names the Orbit app, is refused for the app, not the signature.
  c = await both.challenge();
  const posing = await quiet(() => both.check({ kind: "ios", challenge: c, keyId: launch.keyId, assertion: launch.assert(`${c}:${what}`, APP) }, what));
  assert.equal(posing.result, "unproven");
  assert.match(posing.warned[0]!, /: app$/);
  // The same store, with Launch taken off the list: its key proves nothing more.
  const orbitOnly = proofs({ enforce: true, apple: { appIds: [APP], roots: [apple.root] } }, store);
  c = await orbitOnly.challenge();
  const { result, warned } = await quiet(() => orbitOnly.check({ kind: "ios", challenge: c, keyId: launch.keyId, assertion: launch.assert(`${c}:${what}`) }, what));
  assert.equal(result, "unproven");
  assert.match(warned[0]!, /: app$/);
});

test("a key kept before the host apps came (its public key alone) is the Orbit app's", async () => {
  assert.deepEqual(readKey("MFkwEwYH", [APP, LAUNCH]), { app: APP, spki: "MFkwEwYH" });
  assert.deepEqual(readKey(keptKey(LAUNCH, "MFkwEwYH"), [APP, LAUNCH]), { app: LAUNCH, spki: "MFkwEwYH" });
  // And it still asserts: an Orbit app key stored the old way.
  const { apple } = await setup();
  const store = memoryStore();
  const orbitOnlyBefore = proofs({ enforce: true, apple: { appIds: [APP], roots: [apple.root] } }, store);
  const phone = await apple.phone(APP);
  let c = await orbitOnlyBefore.challenge();
  assert.equal(await orbitOnlyBefore.check({ kind: "ios", challenge: c, keyId: phone.keyId, attestation: await phone.attest(`${c}:${what}`) }, what), null);
  const kept = (await store.get(`proof:key:${phone.keyId}`))!;
  await store.set(`proof:key:${phone.keyId}`, readKey(kept, [APP]).spki, 60_000); // as the server before kept it
  const both = proofs({ enforce: true, apple: { appIds: [APP, LAUNCH], roots: [apple.root] } }, store);
  c = await both.challenge();
  assert.equal(await both.check({ kind: "ios", challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${what}`) }, what), null);
});

test("APP_BUNDLE_ID: unset is the Orbit app then the host apps; a list keeps its order; Play takes them all, a proof naming none being the first's", () => {
  assert.deepEqual(appsFrom(undefined, "TEAM123456"), { appIds: DEFAULT_BUNDLES.map((b) => `TEAM123456.${b}`), playPackages: DEFAULT_BUNDLES });
  assert.deepEqual(appsFrom(" , ", "TEAM123456").playPackages[0], "in.heyorbit.app");
  assert.deepEqual(appsFrom("in.heyorbit.app", "TEAM123456"), { appIds: ["TEAM123456.in.heyorbit.app"], playPackages: ["in.heyorbit.app"] });
  assert.deepEqual(appsFrom("in.heyorbit.app, in.heyorbit.launch,", "TEAM123456").appIds, ["TEAM123456.in.heyorbit.app", "TEAM123456.in.heyorbit.launch"]);
  assert.throws(() => appsFrom("in.heyorbit.app in.heyorbit.launch", "TEAM123456"), /bundle ids/);
  assert.throws(() => appsFrom("orbit", "TEAM123456"), /bundle ids/);
  assert.throws(() => appsFrom(undefined, "team"), /APPLE_TEAM_ID/);
});

test(`one iPhone key proves at most ${PER_KEY_DAY} requests a day, then says tooMany`, async () => {
  const { p, raw, apple } = await setup();
  const phone = await apple.phone();
  let c = await p.challenge();
  assert.equal(await p.check({ kind: "ios", challenge: c, keyId: phone.keyId, attestation: await phone.attest(`${c}:${what}`) }, what), true);
  const results: boolean[] = [];
  for (let i = 1; i <= PER_KEY_DAY; i++) {
    c = await p.challenge();
    results.push((await quiet(() => p.check({ kind: "ios", challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${what}`) }, what))).result);
  }
  assert.deepEqual(results, [...Array(PER_KEY_DAY - 1).fill(true), false]);
  c = await p.challenge();
  assert.equal((await quiet(() => raw.check({ kind: "ios", challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${what}`) }, what))).result, "tooMany");
});

// ---------- Android ----------

test("an Android verdict needs the request, Orbit's app and a real device", async () => {
  const { p, services } = await setup();
  const check = async (v: Omit<Verdict, "hash">, hash?: string) => {
    const c = await p.challenge();
    const token = androidToken({ hash: hash ?? `${c}:${what}`, ...v });
    return (await quiet(() => p.check({ kind: "android", challenge: c, token }, what))).result;
  };
  assert.equal(await check({}), true);
  assert.equal(await check({ app: "UNRECOGNIZED_VERSION", certs: ["test-build-key"] }), true); // our own test build
  assert.equal(await check({ app: "UNRECOGNIZED_VERSION", certs: ["someone-else"] }), false); // a repackaged copy
  assert.equal(await check({ device: [] }), false);
  assert.equal(await check({ device: ["MEETS_BASIC_INTEGRITY"] }), false);
  assert.equal(await check({ pkg: "com.copycat" }), false);
  assert.equal(await check({}, "another-challenge:code:9000000001"), false);
  assert.equal(services.calls.filter((u) => u.includes("oauth2")).length, 1); // Google's token is kept for its hour
});

test("the partner apps prove themselves on Android by naming their package; one off the list can't", async () => {
  const { p } = await setup();
  const check = async (pkg: string, app: string | undefined) => {
    const c = await p.challenge();
    const token = androidToken({ hash: `${c}:${what}`, pkg });
    return (await quiet(() => p.check({ kind: "android", challenge: c, token, app }, what))).result;
  };
  assert.equal(await check("in.heyorbit.launch", "in.heyorbit.launch"), true); // Event Partner
  assert.equal(await check("in.heyorbit.station", "in.heyorbit.station"), true); // Play Partner
  assert.equal(await check("in.heyorbit.app", undefined), true); // the Orbit app, as builds from before send it
  assert.equal(await check("in.heyorbit.launch", undefined), false); // named none: opened as the Orbit app's, which it isn't
  assert.equal(await check("in.heyorbit.station", "in.heyorbit.launch"), false); // names one app, token is another's
  assert.equal(await check("in.heyorbit.crew", "in.heyorbit.crew"), false); // not on the list
  assert.equal(await check("com.copycat", "com.copycat"), false);
});

test("an Android verdict must name the package it was opened under, twice; a listed test cert works for each app", async () => {
  const { p } = await setup();
  const check = async (v: Omit<Verdict, "hash">, app: string) => {
    const c = await p.challenge();
    return (await quiet(() => p.check({ kind: "android", challenge: c, token: androidToken({ hash: `${c}:${what}`, ...v }), app }, what))).result;
  };
  const launch = "in.heyorbit.launch";
  assert.equal(await check({ pkg: launch, reqPkg: "in.heyorbit.app" }, launch), false);
  assert.equal(await check({ pkg: launch, appPkg: "in.heyorbit.app" }, launch), false);
  assert.equal(await check({ pkg: launch, reqPkg: "com.copycat" }, launch), false);
  assert.equal(await check({ pkg: launch, appPkg: "com.copycat" }, launch), false);
  assert.equal(await check({ pkg: launch, app: "UNRECOGNIZED_VERSION", certs: ["test-build-key"] }, launch), true); // Orbit's own test build
});

test("Android without Play Integrity set up fails", async () => {
  const { p } = await setup(true, { play: undefined });
  const c = await p.challenge();
  assert.equal((await quiet(() => p.check({ kind: "android", challenge: c, token: androidToken({ hash: `${c}:${what}` }) }, what))).result, false);
});

// ---------- web, and the switch ----------

test("the web passes with a good Turnstile token", async () => {
  const { p } = await setup();
  assert.equal(await p.check({ kind: "web", token: "good" }, what), true);
  assert.equal((await quiet(() => p.check({ kind: "web", token: "bad" }, what))).result, false);
});

test("not enforced, an iPhone key the server doesn't know is still refused, so the app attests again", async () => {
  const { p, apple } = await setup(false);
  const phone = await apple.phone();
  const c = await p.challenge();
  const { result, warned } = await quiet(() => p.check({ kind: "ios", challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${what}`) }, what));
  assert.equal(result, false);
  assert.ok(!warned[0]!.includes("let through"));
});

test("not enforced, a missing or failed proof is logged and let through", async () => {
  const { p } = await setup(false);
  const { result, warned } = await quiet(async () => [await p.check(undefined, what), await p.check({ kind: "web", token: "bad" }, what)]);
  assert.deepEqual(result, [true, true]);
  assert.equal(warned.length, 2);
  assert.ok(warned.every((w) => w.includes("let through")));
});

// ---------- the routes ----------

test("enforced, POST /auth/code needs a proof and uses up nothing without one", async () => {
  const apple = await fakeApple();
  const t = await testApp({ proof: { enforce: true, apple: { appIds: [APP], roots: [apple.root] } } });
  try {
    for (let i = 0; i < 12; i++) {
      const r = (await quiet(() => t.call("POST", "/auth/code", { to: "9000000001" }))).result;
      assert.equal(r.status, 403);
      assert.equal(r.body.error, "unproven");
    }
    assert.equal(t.sent.length, 0);
    const phone = await apple.phone();
    const { challenge } = (await t.call("POST", "/auth/challenge")).body;
    const attestation = await phone.attest(`${challenge}:${proofOf.code}`);
    const r = await t.call("POST", "/auth/code", { to: "9000000001", proof: { kind: "ios", challenge, keyId: phone.keyId, attestation } });
    assert.equal(r.status, 200); // the 12 refused never counted toward the 10 a day
    assert.equal(t.sent.length, 1);
  } finally {
    await t.close();
  }
});

test("enforced, Google's start needs a proof; builds without one send no body", async () => {
  const apple = await fakeApple();
  const t = await testApp({ proof: { enforce: true, apple: { appIds: [APP], roots: [apple.root] } } });
  try {
    assert.equal((await quiet(() => t.call("POST", "/auth/google/start"))).result.status, 403);
    const phone = await apple.phone();
    const { challenge } = (await t.call("POST", "/auth/challenge")).body;
    const attestation = await phone.attest(`${challenge}:${proofOf.google}`);
    const r = await t.call("POST", "/auth/google/start", { proof: { kind: "ios", challenge, keyId: phone.keyId, attestation } });
    assert.equal(r.status, 503); // past the check: Google isn't set up in tests
    assert.equal(r.body.error, "notSetUp");
  } finally {
    await t.close();
  }
});

test("not enforced, a send without a proof still goes", async () => {
  const t = await testApp({ proof: { enforce: false, apple: { appIds: [APP] } } });
  try {
    const r = (await quiet(() => t.call("POST", "/auth/code", { to: "9000000001" }))).result;
    assert.equal(r.status, 200);
    assert.equal(t.sent.length, 1);
  } finally {
    await t.close();
  }
});

test("Google's start takes no Turnstile token: only the app starts it", async () => {
  const services = fakeServices();
  const t = await testApp({ proof: { enforce: true, apple: { appIds: [APP] }, turnstile: { secret: "s" }, fetch: services.f } });
  try {
    const web = { kind: "web", token: "good" };
    assert.equal((await quiet(() => t.call("POST", "/auth/google/start", { proof: web }))).result.status, 403);
    assert.equal((await t.call("POST", "/auth/code", { to: "9000000001", proof: web })).status, 200); // Galaxy's send
  } finally {
    await t.close();
  }
});

test("a malformed proof counts as none: let through when not enforced, refused when enforced", async () => {
  const bad = { kind: "ios", challenge: "c", keyId: "k", assertion: "x".repeat(5000) };
  for (const enforce of [false, true]) {
    const t = await testApp({ proof: { enforce, apple: { appIds: [APP] } } });
    try {
      const r = (await quiet(() => t.call("POST", "/auth/code", { to: "9000000001", proof: bad }))).result;
      assert.equal(r.status, enforce ? 403 : 200);
    } finally {
      await t.close();
    }
  }
});
