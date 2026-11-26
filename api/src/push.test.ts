import { test } from "node:test";
import { createServer } from "node:http2";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { generateKeyPairSync, type KeyObject, verify } from "node:crypto";
import { NotSent } from "./auth/senders.ts";
import { apnsSender, type Device, fcmSender, type H2Answer, type H2Request, h2Requester } from "./push.ts";

// The push senders without a network. Apple's and Google's docs publish no private key with a matching signed example,
// so "against their examples" here means the documented header and claim shapes and algorithms: APNs provider tokens
// are ES256 with {alg, kid} and {iss: team, iat}; Google's service-account assertion is RS256 with
// {iss, scope, aud, iat, exp}.

const MIN = 60_000;
const ios: Device = { app: "orbit", platform: "ios", env: "sandbox", token: "a1b2c3d4e5f60718" };
const android: Device = { app: "orbit", platform: "android", env: "production", token: "tok-android" };
const msg = { title: "Orbit", body: "Hello", data: { id: "item-1", opens: { to: "security" } }, badge: 3, collapseId: "del-1" };
const part = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());
const checkJwt = (token: string, pub: KeyObject, ec: boolean) => {
  const [h, c, sig] = token.split(".") as [string, string, string];
  const raw = Buffer.from(sig, "base64url");
  if (ec) assert.equal(raw.length, 64);
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), ec ? { key: pub, dsaEncoding: "ieee-p1363" } : pub, raw));
  return { header: part(h), claims: part(c) };
};
const reasonOf = async (p: Promise<unknown>) => {
  try {
    return { id: await p };
  } catch (e) {
    assert.ok(e instanceof NotSent, String(e));
    assert.equal(e.channel, "push");
    assert.ok(!e.message.includes("tok-") && !e.message.includes(ios.token), e.message); // never the device token
    return { reason: e.reason };
  }
};

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ecPem = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("APNs: ES256 provider token with a raw 64-byte signature, kept 50 minutes; the request", async () => {
  let clock = 1_800_000_000_000;
  const calls: { host: string; path: string; headers: Record<string, string>; body: string }[] = [];
  const request: H2Request = async (host, path, headers, body) => {
    calls.push({ host, path, headers, body });
    return { status: 200, headers: { "apns-id": "apns-1" }, body: "" };
  };
  const send = apnsSender({ teamId: "TEAM123456", keyId: "KEY1234567", privateKey: ecPem }, request, () => clock);
  assert.equal(await send(ios, msg), "apns-1");
  const c = calls[0]!;
  assert.equal(c.host, "api.sandbox.push.apple.com");
  assert.equal(c.path, `/3/device/${ios.token}`);
  assert.deepEqual(
    [c.headers["apns-topic"], c.headers["apns-push-type"], c.headers["apns-priority"], c.headers["apns-collapse-id"]],
    ["in.heyorbit.app", "alert", "10", "del-1"],
  );
  // {id, opens} under `body`: the key expo-notifications reads a remote push's data from on iOS.
  assert.deepEqual(JSON.parse(c.body), { aps: { alert: { title: "Orbit", body: "Hello" }, sound: "default", badge: 3 }, body: { id: "item-1", opens: { to: "security" } } });
  const bearer = c.headers.authorization!.replace(/^bearer /, "");
  const { header, claims } = checkJwt(bearer, ec.publicKey, true);
  assert.deepEqual(header, { alg: "ES256", kid: "KEY1234567" });
  assert.deepEqual(claims, { iss: "TEAM123456", iat: clock / 1000 });

  clock += 49 * MIN;
  await send({ ...ios, app: "station", env: "production" }, { ...msg, badge: undefined });
  assert.equal(calls[1]!.headers.authorization, c.headers.authorization); // reused at 49 minutes
  assert.equal(calls[1]!.host, "api.push.apple.com");
  assert.equal(calls[1]!.headers["apns-topic"], "in.heyorbit.station");
  assert.equal(JSON.parse(calls[1]!.body).aps.badge, undefined);
  clock += 2 * MIN;
  await send(ios, msg);
  assert.notEqual(calls[2]!.headers.authorization, c.headers.authorization); // renewed at 51
});

test("APNs: every answer to its reason; an expired provider token is dropped", async () => {
  const answers: [H2Answer | Error, string][] = [
    [{ status: 200, headers: { "apns-id": "x" }, body: "" }, "id:x"],
    [{ status: 410, headers: {}, body: '{"reason":"Unregistered"}' }, "gone"],
    [{ status: 400, headers: {}, body: '{"reason":"BadDeviceToken"}' }, "gone"],
    [{ status: 400, headers: {}, body: '{"reason":"DeviceTokenNotForTopic"}' }, "gone"],
    [{ status: 400, headers: {}, body: '{"reason":"Unregistered"}' }, "gone"],
    [{ status: 403, headers: {}, body: '{"reason":"ExpiredProviderToken"}' }, "unknown"],
    [{ status: 403, headers: {}, body: '{"reason":"InvalidProviderToken"}' }, "notSetUp"],
    [{ status: 403, headers: {}, body: '{"reason":"MissingProviderToken"}' }, "notSetUp"],
    [{ status: 429, headers: {}, body: '{"reason":"TooManyRequests"}' }, "throttled"],
    [{ status: 400, headers: {}, body: '{"reason":"PayloadTooLarge"}' }, "refused"],
    [{ status: 413, headers: {}, body: "" }, "refused"],
    [{ status: 500, headers: {}, body: "" }, "unknown"],
    [{ status: 503, headers: {}, body: `not json ${ios.token}` }, "unknown"],
    [new Error("timed out"), "unknown"],
    [new Error("ECONNRESET"), "unknown"],
  ];
  for (const [answer, want] of answers) {
    const send = apnsSender({ teamId: "T", keyId: "K", privateKey: ecPem }, async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    const r = await reasonOf(send(ios, msg));
    assert.equal("id" in r ? `id:${r.id}` : r.reason, want, JSON.stringify(answer));
  }
  // A token that isn't hex is gone, and never reaches a request.
  let asked = 0;
  const strict = apnsSender({ teamId: "T", keyId: "K", privateKey: ecPem }, async () => (asked++, { status: 200, headers: {}, body: "" }));
  for (const token of ["tok-ios", "../../3/device/abc", "", "abc def"]) assert.equal((await reasonOf(strict({ ...ios, token }, msg))).reason, "gone");
  assert.equal(asked, 0);
  // ExpiredProviderToken: the next send signs a new one even within 50 minutes.
  let clock = 1_800_000_000_000;
  const auths: string[] = [];
  let expired = true;
  const send = apnsSender({ teamId: "T", keyId: "K", privateKey: ecPem }, async (_h, _p, headers) => {
    auths.push(headers.authorization!);
    if (expired) return (expired = false), { status: 403, headers: {}, body: '{"reason":"ExpiredProviderToken"}' };
    return { status: 200, headers: { "apns-id": "y" }, body: "" };
  }, () => clock);
  await reasonOf(send(ios, msg));
  clock += 1000;
  await send(ios, msg);
  assert.notEqual(auths[0], auths[1]);
});

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaPem = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const fcmKey = { projectId: "heyorbit-app", clientEmail: "push@heyorbit-app.iam.gserviceaccount.com", privateKey: rsaPem };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("FCM: an RS256 assertion, the access token kept until 60 s before expiry; the message with opens as text", async () => {
  let clock = 1_800_000_000_000;
  const assertions: string[] = [];
  const sends: { auth: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init.body));
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assertions.push(form.get("assertion")!);
      return json(200, { access_token: `at-${assertions.length}`, expires_in: 3600 });
    }
    assert.equal(url, "https://fcm.googleapis.com/v1/projects/heyorbit-app/messages:send");
    sends.push({ auth: (init.headers as Record<string, string>).authorization!, body: JSON.parse(String(init.body)) });
    return json(200, { name: "projects/heyorbit-app/messages/1" });
  }) as typeof fetch;
  const send = fcmSender(fcmKey, f, () => clock);
  assert.equal(await send(android, msg), "projects/heyorbit-app/messages/1");
  const { header, claims } = checkJwt(assertions[0]!, rsa.publicKey, false);
  assert.equal(header.alg, "RS256");
  const iat = clock / 1000;
  assert.deepEqual(claims, {
    iss: fcmKey.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  });
  assert.deepEqual(sends[0]!.body, {
    message: {
      token: "tok-android",
      notification: { title: "Orbit", body: "Hello" },
      data: { id: "item-1", opens: '{"to":"security"}' },
      android: { priority: "HIGH", notification: { tag: "del-1" } },
    },
  });
  assert.equal(typeof sends[0]!.body.message.data.opens, "string");
  assert.equal(sends[0]!.auth, "Bearer at-1");

  await send(android, { ...msg, data: { id: null, opens: null } });
  assert.deepEqual(sends[1]!.body.message.data, { id: "", opens: "null" });
  clock += 58 * MIN;
  await send(android, msg);
  assert.equal(assertions.length, 1); // cached
  clock += 2 * MIN; // 60 s before its hour
  await send(android, msg);
  assert.equal(assertions.length, 2);
  assert.equal(sends.at(-1)!.auth, "Bearer at-2");
});

test("FCM: every answer to its reason; a 401 drops the access token; token endpoint failures", async () => {
  const err = (status: number, code?: string, st = "X") => json(status, { error: { status: st, details: code ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: code }] : [] } });
  const answers: [() => Response | never, string][] = [
    [() => json(200, { name: "n1" }), "id:n1"],
    [() => err(404, "UNREGISTERED", "NOT_FOUND"), "gone"],
    [() => err(404, undefined, "NOT_FOUND"), "refused"], // a 404 without UNREGISTERED doesn't strip the device
    [() => err(400, "UNREGISTERED"), "gone"],
    [() => err(403, "SENDER_ID_MISMATCH", "PERMISSION_DENIED"), "notSetUp"], // our project is wrong, not the phone
    [() => err(401, undefined, "UNAUTHENTICATED"), "unknown"],
    [() => err(403, undefined, "PERMISSION_DENIED"), "notSetUp"],
    [() => err(429, "QUOTA_EXCEEDED", "RESOURCE_EXHAUSTED"), "throttled"],
    [() => err(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"), "refused"],
    [() => err(500, "INTERNAL"), "unknown"],
    [() => err(503, "UNAVAILABLE"), "unknown"],
    [() => new Response("tok-android <html>", { status: 502 }), "unknown"],
    [() => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, "unknown"],
  ];
  for (const [answer, want] of answers) {
    const f = (async (url: string) => (url.includes("oauth2") ? json(200, { access_token: "at", expires_in: 3600 }) : answer())) as typeof fetch;
    const r = await reasonOf(fcmSender(fcmKey, f)(android, msg));
    assert.equal("id" in r ? `id:${r.id}` : r.reason, want);
  }
  // 401: the next send fetches a new access token.
  let tokens = 0;
  let first = true;
  const f = (async (url: string) => {
    if (url.includes("oauth2")) return json(200, { access_token: `at-${++tokens}`, expires_in: 3600 });
    if (first) return (first = false), err(401);
    return json(200, { name: "n" });
  }) as typeof fetch;
  const send = fcmSender(fcmKey, f);
  await reasonOf(send(android, msg));
  await send(android, msg);
  assert.equal(tokens, 2);
  // The token endpoint: 400/401 is a setup problem, anything else may pass.
  for (const [status, want] of [[400, "notSetUp"], [401, "notSetUp"], [500, "unknown"], [503, "unknown"]] as const) {
    const g = (async () => json(status, { error: "invalid_grant" })) as unknown as typeof fetch;
    assert.equal((await reasonOf(fcmSender(fcmKey, g)(android, msg))).reason, want);
  }
});

test("h2Request: one session per host, reused; a timed-out request takes its session down and the next reconnects", async () => {
  const server = createServer();
  let sessions = 0;
  server.on("session", () => sessions++);
  server.on("stream", (stream, headers) => {
    if (headers[":path"] === "/stall") return; // never answers
    stream.respond({ ":status": 200, "apns-id": `id-${sessions}` });
    stream.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const request = h2Requester(100, () => `http://127.0.0.1:${port}`);
  try {
    const a = await request("apns.test", "/3/device/aa", {}, "{}");
    const b = await request("apns.test", "/3/device/bb", {}, "{}");
    assert.deepEqual([a.status, b.status, sessions], [200, 200, 1]);
    assert.equal(b.headers["apns-id"], "id-1");
    await assert.rejects(request("apns.test", "/stall", {}, "{}"), /timed out/);
    const c = await request("apns.test", "/3/device/cc", {}, "{}");
    assert.deepEqual([c.status, sessions], [200, 2]);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
