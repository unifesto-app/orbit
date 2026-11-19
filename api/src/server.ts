import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { runDeletions } from "./auth/deletion.ts";
import { codeSender, emailSender, type Mail, sesClient, sesMail, whatsappSender } from "./auth/senders.ts";
import { readContact } from "@orbit/contract";
import type { ProofConfig } from "./auth/proof.ts";
import { memoryStore, redisStore } from "./auth/store.ts";
import { sweepActivity } from "./analytics.ts";
import { pruneVisits } from "./visits.ts";
import { ways, type WaysConfig } from "./auth/ways.ts";
import { connect, migrateDb } from "./db/index.ts";
import type { Notify } from "./http.ts";
import { type Media, memoryFiles, s3Files } from "./media.ts";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const production = process.env.NODE_ENV === "production";

const secret = need("AUTH_SECRET");
if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
const { db } = connect(need("DATABASE_URL"));
await migrateDb(db);

// Sign-in codes, each channel on its own settings: WhatsApp with its two keys, email by Amazon SES with SES_REGION
// (credentials from the usual AWS chain, as the Unifesto backend uses them). Off production, a channel without them
// prints its codes to the log instead; in production it refuses with "not set up", and a code is never logged.
const env = process.env;
const logCode = async (to: string, code: string) => console.log(`[code] ${to}: ${code}`);
const phone =
  env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN
    ? whatsappSender({ phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, token: env.WHATSAPP_ACCESS_TOKEN })
    : production
      ? undefined
      : logCode;
const ses = env.SES_REGION ? { from: env.EMAIL_FROM ?? "Orbit <no-reply@updates.heyorbit.in>", send: sesClient(env.SES_REGION) } : null;
const email = ses ? emailSender(ses) : production ? undefined : logCode;
// Other emails (the waitlist's welcome) go the same way; off production without SES they're only logged.
const mail: Mail | undefined = ses ? sesMail(ses) : production ? undefined : async (to, m) => console.log(`[mail] ${to}: ${m.subject}`);
const send = codeSender({ phone, email });
const realSends = (phone && phone !== logCode) || (email && email !== logCode);

// The opening gate (codes.ts): OPEN_TO is "*" for everyone, or a comma-separated list of the numbers and emails that
// may get codes. Unset, it lets nobody in wherever codes really go out (production, or any instance with real keys),
// so a missing line never opens Orbit by accident; only an instance that just logs codes is open by default.
const openTo = (() => {
  const raw = env.OPEN_TO?.trim();
  if (raw === "*") return null;
  if (!raw) return production || realSends ? new Set<string>() : null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const ids = parts.flatMap((s) => {
    const c = readContact(s);
    return c && c !== "abroad" ? [c.kind === "phone" ? c.e164 : c.email] : [];
  });
  if (ids.length < parts.length) console.warn(`[codes] ${parts.length - ids.length} OPEN_TO entries aren't a +91 number or an email; left out`);
  return new Set(ids);
})();
const dailyCap = Number(env.CODE_DAILY_CAP?.trim() || 500); // an empty line means the default
if (!Number.isInteger(dailyCap) || dailyCap < 1) throw new Error("CODE_DAILY_CAP must be a whole number above 0");
const codes = { openTo, dailyCap };
const mode = (s: unknown) => (s === logCode ? "logs" : s ? "sends" : "off");
console.log(
  `[codes] WhatsApp ${mode(phone)}, email ${mode(email)}, open to ${openTo ? `${openTo.size} contacts` : "everyone"}, ` +
    `alert at ${dailyCap} a day per channel, when WhatsApp codes stop until midnight`,
);
const store = production || process.env.REDIS_URL ? redisStore(need("REDIS_URL")) : memoryStore();
// ponytail: messages to people come with the Notifications flow; until then they're only logged.
const notify: Notify = async (n) => console.log(`[notify] ${n.kind} → ${JSON.stringify(n.to)}`);

// Uploads (photos, then host logos): the private S3 bucket MEDIA_BUCKET, with the server's AWS credentials, served at
// MEDIA_URL. Off production without a bucket they're kept in memory; in production without one, uploads say they
// aren't set up.
const port = Number(process.env.PORT ?? 3000);
// Accounts keep whole links, and only links under this base are deleted, so changing it later leaves the old files.
const mediaUrl = (env.MEDIA_URL?.trim() || (production ? "https://api.heyorbit.in/media" : `http://localhost:${port}/media`)).replace(/\/+$/, "");
const files = env.MEDIA_BUCKET ? s3Files(env.MEDIA_BUCKET, "ap-south-1") : production ? undefined : memoryFiles();
const media: Media | undefined = files && { files, url: mediaUrl };
console.log(`[media] ${env.MEDIA_BUCKET ? `bucket ${env.MEDIA_BUCKET}` : files ? "in memory" : "off"}, at ${mediaUrl}`);

// Ways in beyond codes (auth/ways.ts):
// - Passkeys: RP ID heyorbit.in, fixed for good once anyone adds one. iOS apps answer with the site's origin; Android
//   apps with "android:apk-key-hash:<their signing key's SHA-256, base64url>", so PASSKEY_ORIGINS lists those too.
// - Google: off until GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a "Web application" client whose redirect URI is
//   <API_URL>/auth/google/callback) are set; the buttons say it isn't set up.
// - Apple: tokens for the app's bundle id. APPLE_KEY_ID and APPLE_PRIVATE_KEY (a Sign in with Apple key, .p8 text with
//   \n for line breaks) let Remove Apple and deletion revoke it.
const list = (v?: string) => v?.split(",").map((s) => s.trim()).filter(Boolean);
const apiUrl = env.API_URL?.trim() || "https://api.heyorbit.in";
const audiences = list(env.APPLE_AUDIENCES) ?? ["in.heyorbit.app"];
const waysConfig: WaysConfig = {
  passkey: { rpId: env.PASSKEY_RP_ID?.trim() || "heyorbit.in", origins: list(env.PASSKEY_ORIGINS) ?? ["https://heyorbit.in"] },
  google:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, callback: `${apiUrl}/auth/google/callback`, app: "heyorbit://google" }
      : undefined,
  apple: {
    audiences,
    key:
      env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
        ? { teamId: env.APPLE_TEAM_ID?.trim() || "9AH3Z5C5DH", keyId: env.APPLE_KEY_ID, privateKey: env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"), clientId: audiences[0]! }
        : undefined,
  },
};
console.log(
  `[ways] passkeys for ${waysConfig.passkey.rpId} (${waysConfig.passkey.origins.length} origins), Google ${waysConfig.google ? "on" : "not set up"}, ` +
    `Apple for ${audiences.join(" ")}${waysConfig.apple.key ? " with revoke" : ", no revoke key"}`,
);
const revokeApple = ways(waysConfig, store).revokeApple;

// That code sends and Google's start come from Orbit itself (auth/proof.ts). PROOF=enforce refuses those without a
// proof; until then a missing or failed one is only logged, so builds from before it keep working.
// - iPhones: App Attest, for the app's bundle id under the Apple team. Nothing to set up here.
// - Android: Play Integrity. PLAY_INTEGRITY_KEY is the JSON key of a service account in the Google Cloud project
//   linked to the app in Play Console; PLAY_CERTS lists signing-certificate digests (as the log shows them) that pass
//   without a Play install, for test builds: only keys Orbit alone holds (EAS's), never a debug keystore's, which
//   anyone can sign with.
// - APP_BUNDLE_ID: the iOS bundle id and Android package, in.heyorbit.app unless set.
// - Web: Turnstile, with TURNSTILE_SECRET.
const playKey = (() => {
  if (!env.PLAY_INTEGRITY_KEY) return null;
  try {
    const k = JSON.parse(env.PLAY_INTEGRITY_KEY) as { client_email?: string; private_key?: string };
    if (k.client_email && k.private_key) return { email: k.client_email, key: k.private_key };
  } catch {}
  throw new Error("PLAY_INTEGRITY_KEY must be a service account's JSON key, on one line");
})();
const bundleId = env.APP_BUNDLE_ID?.trim() || "in.heyorbit.app";
const proof: ProofConfig = {
  enforce: env.PROOF?.trim() === "enforce",
  apple: { appId: `${env.APPLE_TEAM_ID?.trim() || "9AH3Z5C5DH"}.${bundleId}` },
  play: playKey ? { packageName: bundleId, ...playKey, certs: list(env.PLAY_CERTS) } : undefined,
  turnstile: env.TURNSTILE_SECRET ? { secret: env.TURNSTILE_SECRET } : undefined,
};
console.log(
  `[proof] ${proof.enforce ? "enforced" : "logged only"}: App Attest for ${proof.apple.appId}, ` +
    `Play Integrity ${proof.play ? `for ${proof.play.packageName}` : "not set up"}, ` +
    `Turnstile ${proof.turnstile ? "on (the waitlist's code sends enforce it)" : "not set up"}`,
);

// Day-30 account deletions. ponytail: an hourly sweep until the job runner runs it nightly at 03:30 IST.
setInterval(() => runDeletions(db, notify, Date.now(), revokeApple, media).catch((e) => console.error("[deletions]", e)), 60 * 60 * 1000).unref();

// Visit log rows past the privacy page's 180 days.
setInterval(() => pruneVisits(db, Date.now()).catch((e) => console.error("[visits]", e)), 60 * 60 * 1000).unref();

// Activity rows past 90 days (owner, 19 Nov 2026: "90 days"): their day's totals are kept, the people go. On start, then hourly.
const sweep = () => sweepActivity(db, Date.now()).catch((e) => console.error("[activity]", e));
void sweep();
setInterval(sweep, 60 * 60 * 1000).unref();

serve({ fetch: createApp({ db, store, send, notify, secret, codes, ways: waysConfig, media, proof, mail }).fetch, port }, (info) => {
  console.log(`orbit-api listening on :${info.port}`);
});
