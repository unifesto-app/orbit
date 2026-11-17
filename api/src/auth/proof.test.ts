import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, KeyObject, sign as signWith } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers"; // first: it loads the reflect-metadata x509 needs
import * as x509 from "@peculiar/x509";
import { proofOf, type Proof } from "@orbit/contract";
import { PER_KEY_DAY, proofs, type ProofConfig } from "./proof.ts";
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
      assert(signed: string) {
        const authData = Buffer.concat([sha(appId), Buffer.from([0]), Buffer.from([0, 0, 0, ++counter])]);
        const signature = signWith("sha256", sha(Buffer.concat([authData, sha(signed)])), KeyObject.from(keys.privateKey));
        return cbor(new Map<string, unknown>([["signature", signature], ["authenticatorData", authData]])).toString("base64");
      },
    };
  }
  return { root: root.toString("pem"), phone };
}

// ---- double: Google (a service account's token, then the verdict the token stands for) and Cloudflare
const serviceKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
type Verdict = { hash: string; app?: string; certs?: string[]; device?: string[]; pkg?: string };
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
      return Response.json({
        tokenPayloadExternal: {
          requestDetails: { requestPackageName: pkg, requestHash: v.hash, timestampMillis: String(Date.now()) },
          appIntegrity: { appRecognitionVerdict: v.app ?? "PLAY_RECOGNIZED", packageName: pkg, certificateSha256Digest: v.certs ?? ["play-key"] },
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
    apple: { appId: APP, roots: [apple.root] },
    play: { packageName: "in.heyorbit.app", email: "integrity@orbit.iam.gserviceaccount.com", key: serviceKey, certs: ["test-build-key"] },
    turnstile: { secret: "turnstile-secret" },
    fetch: services.f,
    ...extra,
  };
  const p = proofs(cfg, memoryStore());
  return { p, apple, services };
}
const what = proofOf.code("9000000001");
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
  // Signed for one number, sent for another.
  c = await p.challenge();
  const other = { kind: "ios" as const, challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${what}`) };
  assert.equal((await quiet(() => p.check(other, proofOf.code("9000000002")))).result, false);
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

test(`one iPhone key proves at most ${PER_KEY_DAY} requests a day`, async () => {
  const { p, apple } = await setup();
  const phone = await apple.phone();
  let c = await p.challenge();
  assert.equal(await p.check({ kind: "ios", challenge: c, keyId: phone.keyId, attestation: await phone.attest(`${c}:${what}`) }, what), true);
  const results: boolean[] = [];
  for (let i = 1; i <= PER_KEY_DAY; i++) {
    c = await p.challenge();
    results.push((await quiet(() => p.check({ kind: "ios", challenge: c, keyId: phone.keyId, assertion: phone.assert(`${c}:${what}`) }, what))).result);
  }
  assert.deepEqual(results, [...Array(PER_KEY_DAY - 1).fill(true), false]);
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

test("not enforced, a missing or failed proof is logged and let through", async () => {
  const { p } = await setup(false);
  const { result, warned } = await quiet(async () => [await p.check(undefined, what), await p.check({ kind: "web", token: "bad" }, what)]);
  assert.deepEqual(result, [true, true]);
  assert.equal(warned.length, 2);
  assert.ok(warned.every((w) => w.includes("let through") && !w.includes("9000000001"))); // no number in the log
});

// ---------- the routes ----------

test("enforced, POST /auth/code needs a proof and uses up nothing without one", async () => {
  const apple = await fakeApple();
  const t = await testApp({ proof: { enforce: true, apple: { appId: APP, roots: [apple.root] } } });
  try {
    for (let i = 0; i < 12; i++) {
      const r = (await quiet(() => t.call("POST", "/auth/code", { to: "9000000001" }))).result;
      assert.equal(r.status, 403);
      assert.equal(r.body.error, "unproven");
    }
    assert.equal(t.sent.length, 0);
    const phone = await apple.phone();
    const { challenge } = (await t.call("POST", "/auth/challenge")).body;
    const attestation = await phone.attest(`${challenge}:${proofOf.code("9000000001")}`);
    const r = await t.call("POST", "/auth/code", { to: "9000000001", proof: { kind: "ios", challenge, keyId: phone.keyId, attestation } });
    assert.equal(r.status, 200); // the 12 refused never counted toward the 10 a day
    assert.equal(t.sent.length, 1);
  } finally {
    await t.close();
  }
});

test("enforced, Google's start needs a proof; builds without one send no body", async () => {
  const apple = await fakeApple();
  const t = await testApp({ proof: { enforce: true, apple: { appId: APP, roots: [apple.root] } } });
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
  const t = await testApp({ proof: { enforce: false, apple: { appId: APP } } });
  try {
    const r = (await quiet(() => t.call("POST", "/auth/code", { to: "9000000001" }))).result;
    assert.equal(r.status, 200);
    assert.equal(t.sent.length, 1);
  } finally {
    await t.close();
  }
});
