import { connect, type ClientHttp2Session, constants } from "node:http2";
import { createPrivateKey, type KeyObject, sign } from "node:crypto";
import type { InboxApp } from "@orbit/contract";
import { NotSent } from "./auth/senders.ts";

// Push senders (notifications build plan, PR 4): APNs over HTTP/2 with a provider token, FCM v1 with a service account's
// access token. Node's http2, crypto and fetch only. Each returns the provider's message id or throws NotSent. Never
// logged or put in an error: the device token, a JWT, or the provider's raw body (it can echo the token).

export type Device = { app: InboxApp; platform: "ios" | "android"; env: "sandbox" | "production"; token: string };
// `collapseId`: the delivery's id, so a push retried after a timeout replaces the first on the phone, not a second banner.
export type PushMessage = { title: string; body: string; data: { id: string | null; opens: unknown }; badge?: number; collapseId: string };
type Send = (d: Device, m: PushMessage) => Promise<string | undefined>;
export type Push = { ios?: Send; android?: Send };

const MIN = 60_000;
const TIMEOUT_MS = 10_000;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
// A compact JWT: ES256 with the raw 64-byte r||s signature JOSE wants, or RS256.
const jwt = (header: object, claims: object, key: KeyObject) => {
  const input = `${b64(header)}.${b64(claims)}`;
  const sig = sign("sha256", Buffer.from(input), key.asymmetricKeyType === "ec" ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${input}.${sig.toString("base64url")}`;
};
// A provider's error word, only when it's a plain word (never a token or a sentence that might quote one).
const word = (v: unknown) => (typeof v === "string" && /^[A-Za-z_]{1,64}$/.test(v) ? v : "");

// ---- APNs

export type H2Answer = { status: number; headers: Record<string, unknown>; body: string };
export type H2Request = (host: string, path: string, headers: Record<string, string>, body: string) => Promise<H2Answer>;

// One HTTP/2 session per host, made again after it closes, errors or is sent away; `timeoutMs` per request. A request
// that times out takes its session down with it (a stalled connection), so the next one reconnects. `origin` lets the
// test point it at a local plain-text server.
export function h2Requester(timeoutMs = TIMEOUT_MS, origin = (host: string) => `https://${host}`): H2Request {
  const sessions = new Map<string, ClientHttp2Session>();
  const drop = (host: string, s: ClientHttp2Session) => {
    if (sessions.get(host) === s) sessions.delete(host);
  };
  const session = (host: string) => {
    const open = sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const s = connect(origin(host));
    s.on("close", () => drop(host, s))
      .on("error", () => drop(host, s))
      .on("goaway", () => drop(host, s));
    sessions.set(host, s);
    return s;
  };
  return (host, path, headers, body) =>
    new Promise((resolve, reject) => {
      let req;
      const s = session(host);
      try {
        req = s.request({ ":method": "POST", ":path": path, ...headers });
      } catch (e) {
        return reject(e);
      }
      let answer: Record<string, unknown> = {};
      let data = "";
      req.setTimeout(timeoutMs, () => {
        req.close(constants.NGHTTP2_CANCEL);
        drop(host, s);
        s.destroy();
        reject(new Error("timed out"));
      });
      req.on("response", (h) => (answer = h));
      req.setEncoding("utf8");
      req.on("data", (c: string) => (data += c));
      req.on("end", () => resolve({ status: Number(answer[":status"]), headers: answer, body: data }));
      req.on("error", reject);
      req.end(body);
    });
}
export const h2Request = h2Requester();

// The app's bundle id, APNs's topic: the Orbit app is in.heyorbit.app, each host app in.heyorbit.<codename>
// (auth/proof.ts DEFAULT_BUNDLES).
const topicOf = (app: InboxApp) => (app === "orbit" ? "in.heyorbit.app" : `in.heyorbit.${app}`);
const GONE_400 = ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"];
const APNS_TOKEN = /^[0-9a-f]+$/i;

export function apnsSender(c: { teamId: string; keyId: string; privateKey: string }, request: H2Request = h2Request, now = Date.now): Send {
  const key = createPrivateKey(c.privateKey);
  // Apple refuses provider tokens older than 60 minutes and rate-limits renewing more often than every 20: renewed at 50.
  let token: { jwt: string; at: number } | null = null;
  const bearer = () => {
    if (!token || now() - token.at >= 50 * MIN) token = { jwt: jwt({ alg: "ES256", kid: c.keyId }, { iss: c.teamId, iat: Math.floor(now() / 1000) }, key), at: now() };
    return token.jwt;
  };
  return async (d, m) => {
    // An APNs token is hex; anything else never goes into the request's path, and can't be a real device.
    if (!APNS_TOKEN.test(d.token)) throw new NotSent("push", "gone", "not an APNs token");
    const host = d.env === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    // expo-notifications on iOS fills a remote push's content.data from userInfo["body"] only, so {id, opens} go there.
    const aps = { alert: { title: m.title, body: m.body }, sound: "default", ...(m.badge === undefined ? {} : { badge: m.badge }) };
    const payload = { aps, body: m.data };
    let res: H2Answer;
    try {
      res = await request(
        host,
        `/3/device/${d.token}`,
        {
          authorization: `bearer ${bearer()}`,
          "apns-topic": topicOf(d.app),
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-collapse-id": m.collapseId,
        },
        JSON.stringify(payload),
      );
    } catch (e) {
      throw new NotSent("push", "unknown", (e as Error).message === "timed out" ? "timed out" : "connection error");
    }
    if (res.status === 200) return typeof res.headers["apns-id"] === "string" ? res.headers["apns-id"] : undefined;
    const why = word((() => {
      try {
        return (JSON.parse(res.body) as { reason?: unknown }).reason;
      } catch {
        return undefined;
      }
    })());
    const s = res.status;
    if (s === 403 && why === "ExpiredProviderToken") token = null;
    const reason: NotSent["reason"] =
      s === 410 || (s === 400 && GONE_400.includes(why))
        ? "gone"
        : s === 403
          ? why === "ExpiredProviderToken"
            ? "unknown"
            : "notSetUp"
          : s === 429
            ? "throttled"
            : s >= 400 && s < 500
              ? "refused"
              : "unknown";
    throw new NotSent("push", reason, `APNs ${s} ${why}`);
  };
}

// ---- FCM

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function fcmSender(c: { projectId: string; clientEmail: string; privateKey: string }, fetchImpl: typeof fetch = fetch, now = Date.now): Send {
  const key = createPrivateKey(c.privateKey);
  let access: { token: string; until: number } | null = null;
  const accessToken = async () => {
    if (access && access.until > now()) return access.token;
    const iat = Math.floor(now() / 1000);
    const assertion = jwt({ alg: "RS256", typ: "JWT" }, { iss: c.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }, key);
    let res: Response;
    try {
      res = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new NotSent("push", "unknown", "FCM token: no answer");
    }
    if (!res.ok) throw new NotSent("push", res.status === 400 || res.status === 401 ? "notSetUp" : "unknown", `FCM token ${res.status}`);
    const t = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!t?.access_token) throw new NotSent("push", "unknown", "FCM token: none in the answer");
    access = { token: t.access_token, until: now() + ((t.expires_in ?? 3600) - 60) * 1000 };
    return access.token;
  };
  return async (d, m) => {
    const bearer = await accessToken();
    let res: Response;
    try {
      res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${c.projectId}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        // FCM data values must be strings, so `opens` goes as JSON text (the app parses it back).
        body: JSON.stringify({
          message: {
            token: d.token,
            notification: { title: m.title, body: m.body },
            data: { id: m.data.id ?? "", opens: JSON.stringify(m.data.opens) },
            android: { priority: "HIGH", notification: { tag: m.collapseId } },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new NotSent("push", "unknown", (e as Error).name === "TimeoutError" ? "timed out" : "connection error");
    }
    const body = (await res.json().catch(() => null)) as { name?: string; error?: { status?: unknown; details?: { errorCode?: unknown }[] } } | null;
    if (res.ok) return typeof body?.name === "string" ? body.name : undefined;
    const codes = (Array.isArray(body?.error?.details) ? body.error.details : []).map((x) => word(x?.errorCode));
    const s = res.status;
    if (s === 401) access = null;
    // Only UNREGISTERED strips a device: a sender-id mismatch is our project being wrong, not the phone.
    const reason: NotSent["reason"] = codes.includes("UNREGISTERED")
      ? "gone"
      : s === 401
        ? "unknown"
        : s === 403
          ? "notSetUp"
          : s === 429
            ? "throttled"
            : s >= 400 && s < 500
              ? "refused"
              : "unknown";
    throw new NotSent("push", reason, `FCM ${s} ${codes.filter(Boolean).join(",") || word(body?.error?.status)}`);
  };
}
