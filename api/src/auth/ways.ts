import { createHash, createPrivateKey, randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { sign, verifyWithJwks } from "hono/jwt";
import type { Provider } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { passkeys } from "../db/schema.ts";
import type { Store } from "./store.ts";

// Proving Google, Apple and passkeys (User flow, Sign-in methods). Each answers the identity it proved, or null; the
// routes decide which account that opens. Everything single-use lives in `store` with a short life.
// - Google: a browser sign-in the API runs itself (authorization code with PKCE, Google's "Web application" client),
//   so no client id is built into the app and the web can use the same page later. Starting it hands the app the page
//   and a secret; the callback hands the app a short grant through the heyorbit:// link, which only that secret
//   redeems, so another app that registers the same scheme and catches the link gets nothing.
// - Apple: the identity token from Apple's native sheet (iOS), checked against Apple's keys, made with a nonce from
//   this API and spent once. With Apple's key set up, its authorization code becomes a refresh token, revoked when
//   Apple is removed or the account deleted (Apple's rule for apps that offer deletion).
// - Passkeys: WebAuthn by @simplewebauthn/server, user verification required, RP ID heyorbit.in. The RP ID binds every
//   passkey for good: changing it later strands them all.

export type Identity = { provider: Provider; subject: string; email: string | null };

export type WaysConfig = {
  passkey: { rpId: string; origins: string[] }; // iOS apps answer "https://<rpId>"; Android "android:apk-key-hash:…"
  google?: { clientId: string; clientSecret: string; callback: string; app: string }; // unset: "not set up yet"
  apple: { audiences: string[]; key?: { teamId: string; keyId: string; privateKey: string; clientId: string } };
  fetch?: typeof fetch; // tests answer for Google and Apple
};

export const defaultWays: WaysConfig = {
  passkey: { rpId: "heyorbit.in", origins: ["https://heyorbit.in"] },
  apple: { audiences: ["com.unifesto.orbit"] },
};

const MIN = 60 * 1000;
const random = () => randomBytes(32).toString("base64url");
export const hashOf = (s: string) => createHash("sha256").update(s).digest("base64url");
const take = async (store: Store, key: string) => {
  const v = await store.get(key);
  return v !== null && (await store.del(key)) ? v : null; // the one caller that removes it gets it
};

// Google's and Apple's signing keys, kept an hour. A key id not seen yet fetches again, at most once a minute.
type Jwk = Parameters<typeof verifyWithJwks>[1]["keys"] extends (infer K)[] | undefined ? K : never;
const keyCache = new Map<string, { keys: Jwk[]; at: number }>();
async function keysFor(uri: string, f: typeof fetch, now: number, fresh: boolean) {
  const hit = keyCache.get(uri);
  if (hit && now - hit.at < (fresh ? MIN : 60 * MIN)) return hit.keys;
  const res = await f(uri);
  if (!res.ok) throw new Error(`keys from ${uri}: ${res.status}`);
  const keys = ((await res.json()) as { keys: Jwk[] }).keys;
  keyCache.set(uri, { keys, at: now });
  return keys;
}
async function idToken(token: string, opts: { jwks: string; iss: string | RegExp; aud: string[] }, f: typeof fetch) {
  const check = async (fresh: boolean) =>
    verifyWithJwks(token, {
      keys: await keysFor(opts.jwks, f, Date.now(), fresh),
      allowedAlgorithms: ["RS256"],
      verification: { iss: opts.iss, aud: opts.aud },
    });
  try {
    return await check(false);
  } catch {
    try {
      return await check(true); // a rotated key, once
    } catch {
      return null;
    }
  }
}
const verified = (v: unknown) => v === true || v === "true";
const lower = (e: unknown) => (typeof e === "string" && e.includes("@") ? e.trim().toLowerCase() : null);

export function ways(cfg: WaysConfig, store: Store) {
  const f = cfg.fetch ?? fetch;

  // Apple's client secret: a short ES256 token signed with the key from Apple's developer account.
  const appleSecret = async (k: NonNullable<WaysConfig["apple"]["key"]>) => {
    const jwk = { ...createPrivateKey(k.privateKey).export({ format: "jwk" }), alg: "ES256", kid: k.keyId };
    const iat = Math.floor(Date.now() / 1000);
    return sign({ iss: k.teamId, iat, exp: iat + 300, aud: "https://appleid.apple.com", sub: k.clientId }, jwk as never);
  };
  const appleForm = async (k: NonNullable<WaysConfig["apple"]["key"]>, path: "token" | "revoke", body: Record<string, string>) =>
    f(`https://appleid.apple.com/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: k.clientId, client_secret: await appleSecret(k), ...body }),
    });

  return {
    googleReady: !!cfg.google,

    // POST /auth/nonce: for Apple's sheet. Ten minutes, spent by the token that carries it.
    async nonce() {
      const n = random();
      await store.set(`nonce:${n}`, "1", 10 * MIN);
      return n;
    },

    async apple(p: { idToken: string; nonce: string; code?: string }): Promise<Identity | null> {
      if (!(await take(store, `nonce:${p.nonce}`))) return null;
      const t = await idToken(p.idToken, { jwks: "https://appleid.apple.com/auth/keys", iss: "https://appleid.apple.com", aud: cfg.apple.audiences }, f);
      // The nonce as given, or its SHA-256 in hex, which is how some apps pass it to Apple.
      const hex = createHash("sha256").update(p.nonce).digest("hex");
      if (!t || typeof t.sub !== "string" || (t.nonce !== p.nonce && t.nonce !== hex)) return null;
      const id: Identity = { provider: "apple", subject: t.sub, email: verified(t.email_verified) ? lower(t.email) : null };
      // Its refresh token waits half an hour for the identity to be saved (sign-up can take a while).
      const k = cfg.apple.key;
      if (k && p.code) {
        try {
          const res = await appleForm(k, "token", { grant_type: "authorization_code", code: p.code });
          const refresh = res.ok ? ((await res.json()) as { refresh_token?: string }).refresh_token : undefined;
          if (refresh) await store.set(`appleRefresh:${t.sub}`, refresh, 30 * MIN);
          else console.warn(`[apple] code exchange: ${res.status}`);
        } catch (e) {
          console.warn("[apple] code exchange", e); // still signs in; only the revoke at deletion is lost
        }
      }
      return id;
    },
    // The refresh token from the latest Apple sign-in for this Apple id, once.
    appleRefresh: (subject: string) => take(store, `appleRefresh:${subject}`),
    async revokeApple(token: string) {
      const k = cfg.apple.key;
      if (!k) return;
      const res = await appleForm(k, "revoke", { token, token_type_hint: "refresh_token" });
      if (!res.ok) throw new Error(`apple revoke: ${res.status}`);
    },

    // POST /auth/google/start: the page to open and the secret for its grant, or null when Google isn't set up.
    async googleStart() {
      const g = cfg.google;
      if (!g) return null;
      const state = random();
      const pkce = random();
      const verifier = random();
      await store.set(`googleState:${state}`, JSON.stringify({ pkce, bind: hashOf(verifier) }), 10 * MIN);
      const q = new URLSearchParams({
        client_id: g.clientId,
        redirect_uri: g.callback,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: hashOf(pkce),
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, verifier };
    },

    // GET /auth/google/callback: back to the app with a grant, or with what went wrong.
    async googleCallback(q: { code?: string; state?: string; error?: string }) {
      const g = cfg.google;
      const back = (p: Record<string, string>) => `${g?.app ?? "heyorbit://google"}?${new URLSearchParams(p)}`;
      if (!g) return back({ error: "notSetUp" });
      const started = q.state ? await take(store, `googleState:${q.state}`) : null;
      if (q.error) return back({ error: q.error === "access_denied" ? "cancelled" : "failed" });
      if (!started || !q.code) return back({ error: "expired" });
      const { pkce, bind } = JSON.parse(started) as { pkce: string; bind: string };
      try {
        const res = await f("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: q.code,
            client_id: g.clientId,
            client_secret: g.clientSecret,
            redirect_uri: g.callback,
            grant_type: "authorization_code",
            code_verifier: pkce,
          }),
        });
        const token = res.ok ? ((await res.json()) as { id_token?: string }).id_token : undefined;
        const t = token && (await idToken(token, { jwks: "https://www.googleapis.com/oauth2/v3/certs", iss: /^(https:\/\/)?accounts\.google\.com$/, aud: [g.clientId] }, f));
        if (!t || typeof t.sub !== "string") return back({ error: "failed" });
        // Google says whether it checked the address; one it didn't is no proof of anything.
        const email = verified(t.email_verified) ? lower(t.email) : null;
        if (!email) return back({ error: "unverified" });
        const grant = random();
        const id: Identity = { provider: "google", subject: t.sub, email };
        await store.set(`googleGrant:${grant}`, JSON.stringify({ id, name: typeof t.name === "string" ? t.name : null, bind }), 5 * MIN);
        return back({ grant });
      } catch (e) {
        console.warn("[google] callback", e);
        return back({ error: "failed" });
      }
    },

    // A grant from the callback, redeemed by the app that opened the page.
    async google(p: { grant: string; verifier: string }): Promise<(Identity & { name: string | null }) | null> {
      const raw = await take(store, `googleGrant:${p.grant}`);
      if (!raw) return null;
      const { id, name, bind } = JSON.parse(raw) as { id: Identity; name: string | null; bind: string };
      return hashOf(p.verifier) === bind ? { ...id, name } : null;
    },

    // Signing in with a passkey: any passkey for heyorbit.in, picked on the phone.
    async passkeyRequest() {
      const options = await generateAuthenticationOptions({ rpID: cfg.passkey.rpId, userVerification: "required", timeout: 5 * MIN });
      await store.set(`passkeyGet:${options.challenge}`, "1", 5 * MIN);
      return { challenge: options.challenge, options };
    },
    // The passkey that answered, its counter moved on; null for anything that doesn't check out.
    async passkey(db: Db, p: { challenge: string; credential: Record<string, unknown> }, now: number) {
      if (!(await take(store, `passkeyGet:${p.challenge}`))) return null;
      const id = typeof p.credential.id === "string" ? p.credential.id : null;
      const [row] = id ? await db.select().from(passkeys).where(eq(passkeys.credentialId, id)) : [];
      if (!row) return null;
      try {
        const r = await verifyAuthenticationResponse({
          response: p.credential as never,
          expectedChallenge: p.challenge,
          expectedOrigin: cfg.passkey.origins,
          expectedRPID: cfg.passkey.rpId,
          credential: { id: row.credentialId, publicKey: Buffer.from(row.publicKey, "base64url"), counter: row.counter, transports: row.transports ?? undefined },
          requireUserVerification: true,
        });
        if (!r.verified) return null;
        await db.update(passkeys).set({ counter: r.authenticationInfo.newCounter, lastUsedAt: new Date(now) }).where(eq(passkeys.id, row.id));
        return row;
      } catch {
        return null;
      }
    },

    // Adding a passkey: the options for the phone's sheet, for this account only.
    async passkeyCreation(u: { id: string; name: string | null; phone: string | null; email: string | null }, have: { credentialId: string; transports: string[] | null }[]) {
      const options = await generateRegistrationOptions({
        rpName: "Orbit",
        rpID: cfg.passkey.rpId,
        userID: new TextEncoder().encode(u.id),
        userName: u.email ?? u.phone ?? "Orbit account", // shown in the person's own password manager
        userDisplayName: u.name ?? "",
        attestationType: "none",
        excludeCredentials: have.map((k) => ({ id: k.credentialId, transports: k.transports ?? undefined })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        timeout: 5 * MIN,
      });
      await store.set(`passkeyNew:${options.challenge}`, u.id, 5 * MIN);
      return { challenge: options.challenge, options };
    },
    async passkeyMade(userId: string, p: { challenge: string; credential: Record<string, unknown> }) {
      if ((await take(store, `passkeyNew:${p.challenge}`)) !== userId) return null;
      try {
        const r = await verifyRegistrationResponse({
          response: p.credential as never,
          expectedChallenge: p.challenge,
          expectedOrigin: cfg.passkey.origins,
          expectedRPID: cfg.passkey.rpId,
          requireUserVerification: true,
        });
        if (!r.verified) return null;
        const c = r.registrationInfo.credential;
        return { credentialId: c.id, publicKey: Buffer.from(c.publicKey).toString("base64url"), counter: c.counter, transports: c.transports ?? null };
      } catch {
        return null;
      }
    },
  };
}
export type Ways = ReturnType<typeof ways>;
