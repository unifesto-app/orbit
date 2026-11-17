import { createHash, createPrivateKey, createPublicKey, randomBytes, verify, X509Certificate } from "node:crypto";
import { convertCertBufferToPEM, decodeAttestationObject, isoCBOR, parseAuthenticatorData, validateCertificatePath } from "@simplewebauthn/server/helpers";
import { sign } from "hono/jwt";
import type { Proof } from "@orbit/contract";
import type { Store } from "./store.ts";

// That a code send or Google's start comes from Orbit itself (User flow, Account security): the WhatsApp number and
// the SES sender are the live Unifesto app's too, and every WhatsApp send is billed, so a script mustn't be able to
// pump them. iPhones prove it with App Attest, Android phones with Play Integrity, and the web with Turnstile.
// The app and Play sign `<challenge>:<what>` (contract: Proof). A challenge works once, so a proof can't be replayed;
// that is also why an assertion's counter isn't kept.
// `enforce` off: a missing or failed proof is logged and the request goes on, until the app that proves itself is out.
// One exception: an assertion from an iPhone key this server doesn't know is refused anyway, since the app then attests
// a new key and asks again, and the log shows what enforcing would.
// ponytail: a Turnstile token isn't bound to the challenge or the number, so on the web a code send is as safe as
// Turnstile itself; Google's start takes none (Galaxy never starts it).

export type ProofConfig = {
  enforce: boolean;
  apple: { appId: string; roots?: string[] }; // "<team id>.<bundle id>"; roots: Apple's own unless a test swaps it
  // A Google Cloud service account in the project linked to Play. `certs`: signing-certificate digests, as verdicts
  // show them, that pass without a Play install (Orbit's own test builds).
  play?: { packageName: string; email: string; key: string; certs?: string[] };
  turnstile?: { secret: string };
  fetch?: typeof fetch; // tests answer for Google and Cloudflare
};

// Apple App Attestation Root CA, from https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
// (SHA-256 1C:B9:82:3B:…:62:42:C9:32), valid until 2045.
const APPLE_ROOT = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// An attested key is kept this long, in Redis, which keeps no snapshot: after a restart each iPhone attests again on its
// next proof (the app does it by itself). ponytail: a table if that ever costs Apple's rate limits.
const KEY_LIFE = 400 * DAY;
export const PER_KEY_DAY = 20; // proofs a day from one iPhone's key: a person signs in a few times, a script far more
const sha = (b: Buffer | Uint8Array | string) => createHash("sha256").update(b).digest();
// Where App Attest's credential certificate holds sha256(authData ‖ clientDataHash): [1] { OCTET STRING (32) }.
const NONCE_PREFIX = Buffer.from("3024a1220420", "hex");
const ENVIRONMENTS = ["appattest\0\0\0\0\0\0\0", "appattestdevelop"]; // production, and builds signed for development

export function proofs(cfg: ProofConfig, store: Store) {
  const f = cfg.fetch ?? fetch;
  const timeout = () => AbortSignal.timeout(5000);

  // ---- iPhone: App Attest. The first proof attests a new key and keeps its public key; later ones are assertions.
  async function ios(p: Extract<Proof, { kind: "ios" }>, signed: string): Promise<string | null> {
    const clientDataHash = sha(signed);
    const keyId = Buffer.from(p.keyId, "base64");
    if (p.attestation) {
      const att = decodeAttestationObject(Buffer.from(p.attestation, "base64"));
      if ((att.get("fmt") as string) !== "apple-appattest") return "format";
      const x5c = att.get("attStmt").get("x5c");
      if (!x5c?.length) return "certificates";
      await validateCertificatePath(x5c.map(convertCertBufferToPEM), cfg.apple.roots ?? [APPLE_ROOT]); // throws if not Apple's
      const authData = att.get("authData");
      const leaf = new X509Certificate(x5c[0]!);
      if (!leaf.raw.includes(Buffer.concat([NONCE_PREFIX, sha(Buffer.concat([authData, clientDataHash]))]))) return "nonce";
      const spki = leaf.publicKey.export({ type: "spki", format: "der" });
      if (!sha(spki.subarray(-65)).equals(keyId)) return "key"; // the key id is the hash of the uncompressed point
      const a = parseAuthenticatorData(authData);
      if (!Buffer.from(a.rpIdHash).equals(sha(cfg.apple.appId))) return "app";
      if (a.counter !== 0 || !a.aaguid || !ENVIRONMENTS.includes(Buffer.from(a.aaguid).toString("latin1"))) return "environment";
      if (!a.credentialID || !Buffer.from(a.credentialID).equals(keyId)) return "key";
      await store.set(`proof:key:${p.keyId}`, spki.toString("base64"), KEY_LIFE);
    } else if (p.assertion) {
      const held = await store.get(`proof:key:${p.keyId}`);
      if (!held) return "unknownKey"; // the app attests a new one and asks again
      const m = isoCBOR.decodeFirst<Map<string, Uint8Array>>(Buffer.from(p.assertion, "base64"));
      const sig = m.get("signature"), authData = m.get("authenticatorData");
      if (!sig || !authData || !Buffer.from(authData.subarray(0, 32)).equals(sha(cfg.apple.appId))) return "app";
      const key = createPublicKey({ key: Buffer.from(held, "base64"), format: "der", type: "spki" });
      if (!verify("sha256", sha(Buffer.concat([authData, clientDataHash])), key, sig)) return "signature";
    } else return "empty";
    return (await store.incr(`proof:day:${p.keyId}`, DAY)) > PER_KEY_DAY ? "tooMany" : null;
  }

  // ---- Android: Play Integrity. Standard requests' tokens only Google can open, with a service account's token.
  let google: { token: string; until: number } | null = null;
  async function googleToken(play: NonNullable<ProofConfig["play"]>) {
    if (google && google.until > Date.now()) return google.token;
    const iat = Math.floor(Date.now() / 1000);
    const jwk = { ...createPrivateKey(play.key).export({ format: "jwk" }), alg: "RS256" };
    const scope = "https://www.googleapis.com/auth/playintegrity";
    const assertion = await sign({ iss: play.email, scope, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }, jwk as never, "RS256");
    const res = await f("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: timeout(),
    });
    if (!res.ok) throw new Error(`Google's token answered ${res.status}`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    google = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
    return google.token;
  }
  type Verdict = {
    requestDetails?: { requestPackageName?: string; requestHash?: string };
    appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[] };
    deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  };
  async function android(token: string, signed: string): Promise<string | null> {
    const play = cfg.play;
    if (!play) return "notSetUp";
    const res = await f(`https://playintegrity.googleapis.com/v1/${play.packageName}:decodeIntegrityToken`, {
      method: "POST",
      headers: { authorization: `Bearer ${await googleToken(play)}`, "content-type": "application/json" },
      body: JSON.stringify({ integrity_token: token }),
      signal: timeout(),
    });
    if (!res.ok) return `Google answered ${res.status}`;
    const v = ((await res.json()) as { tokenPayloadExternal?: Verdict }).tokenPayloadExternal;
    if (v?.requestDetails?.requestPackageName !== play.packageName || v.requestDetails.requestHash !== signed) return "request";
    const app = v.appIntegrity;
    const ours = app?.appRecognitionVerdict === "PLAY_RECOGNIZED" || !!app?.certificateSha256Digest?.some((d) => play.certs?.includes(d));
    // The digest is logged so a test build's can be added to PLAY_CERTS.
    if (app?.packageName !== play.packageName || !ours) return `app ${app?.appRecognitionVerdict} ${app?.certificateSha256Digest?.join(",")}`;
    if (!v.deviceIntegrity?.deviceRecognitionVerdict?.includes("MEETS_DEVICE_INTEGRITY")) return "device";
    return null;
  }

  // ---- Web: Turnstile, whose tokens Cloudflare spends once.
  async function web(token: string): Promise<string | null> {
    if (!cfg.turnstile) return "notSetUp";
    const res = await f("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: cfg.turnstile.secret, response: token }),
      signal: timeout(),
    });
    const r = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return r.success ? null : `turnstile ${r["error-codes"]?.join(",")}`;
  }

  // Why the proof fails, or null when it holds.
  async function failure(p: Proof | undefined, what: string): Promise<string | null> {
    if (!p) return "none";
    if (p.kind === "web") return web(p.token);
    if (!(await store.del(`proof:challenge:${p.challenge}`))) return "challenge";
    const signed = `${p.challenge}:${what}`;
    return p.kind === "ios" ? ios(p, signed) : android(p.token, signed);
  }

  return {
    // POST /auth/challenge: what the app signs next, good once for 5 minutes.
    async challenge() {
      const c = randomBytes(24).toString("base64url");
      await store.set(`proof:challenge:${c}`, "1", 5 * MIN);
      return c;
    },
    // Null when the request may go on, else why not: "tooMany" (this iPhone's key has proved enough today; the app
    // doesn't attest again for it) or "unproven". `what`: contract's proofOf.
    async check(p: Proof | undefined, what: string): Promise<null | "tooMany" | "unproven"> {
      const why = await failure(p, what).catch((e: Error) => `error: ${e.message}`);
      if (!why) return null;
      const refuse = cfg.enforce || why === "unknownKey";
      console.warn(`[proof] ${p?.kind ?? "no proof"}: ${why}${refuse ? "" : " (let through)"}`);
      return !refuse ? null : why === "tooMany" ? "tooMany" : "unproven";
    },
  };
}
