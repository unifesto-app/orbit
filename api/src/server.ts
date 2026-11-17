import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { runDeletions } from "./auth/deletion.ts";
import { codeSender, emailSender, sesClient, whatsappSender } from "./auth/senders.ts";
import { readContact } from "@orbit/contract";
import { memoryStore, redisStore } from "./auth/store.ts";
import { ways, type WaysConfig } from "./auth/ways.ts";
import { connect, migrateDb } from "./db/index.ts";
import type { Notify } from "./http.ts";

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
const email = env.SES_REGION
  ? emailSender({ from: env.EMAIL_FROM ?? "Orbit <no-reply@updates.heyorbit.in>", send: sesClient(env.SES_REGION) })
  : production
    ? undefined
    : logCode;
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
    `alert past ${dailyCap} a day per channel`,
);
const store = production || process.env.REDIS_URL ? redisStore(need("REDIS_URL")) : memoryStore();
// ponytail: messages to people come with the Notifications flow; until then they're only logged.
const notify: Notify = async (n) => console.log(`[notify] ${n.kind} → ${JSON.stringify(n.to)}`);

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

// Day-30 account deletions. ponytail: an hourly sweep until the job runner runs it nightly at 03:30 IST.
setInterval(() => runDeletions(db, notify, Date.now(), revokeApple).catch((e) => console.error("[deletions]", e)), 60 * 60 * 1000).unref();

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: createApp({ db, store, send, notify, secret, codes, ways: waysConfig }).fetch, port }, (info) => {
  console.log(`orbit-api listening on :${info.port}`);
});
