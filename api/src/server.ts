import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { runDeletions } from "./auth/deletion.ts";
import { codeSender, emailSender, type Mail, sesClient, sesMail, sesRawClient, whatsappSender } from "./auth/senders.ts";
import { readContact } from "@orbit/contract";
import { reviewFrom } from "./auth/review.ts";
import { seedReview } from "./auth/review-seed.ts";
import { appsFrom, type ProofConfig } from "./auth/proof.ts";
import { memoryStore, redisStore } from "./auth/store.ts";
import { sweepActivity } from "./analytics.ts";
import { pruneApplications } from "./careers.ts";
import { sweepSlotAlerts } from "./slots/alerts.ts";
import { pruneVisits } from "./visits.ts";
import { ways, type WaysConfig } from "./auth/ways.ts";
import { connect, migrateDb } from "./db/index.ts";
import { checkProviders, createNotifier, pruneNotifications, runDeliveries } from "./notifications.ts";
import { sendReminders } from "./announcements.ts";
import { runBroadcasts } from "./broadcasts.ts";
import { apnsSender, fcmSender, type Push } from "./push.ts";
import { type Media, memoryFiles, s3Files } from "./media.ts";
import { pollPayments } from "./payments/routes.ts";
import { razorpay } from "./payments/razorpay.ts";
import { askModel, pruneAsks } from "./ask.ts";

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
const ses = env.SES_REGION
  ? { from: env.EMAIL_FROM ?? "Orbit <no-reply@updates.heyorbit.in>", send: sesClient(env.SES_REGION), sendRaw: sesRawClient(env.SES_REGION) }
  : null;
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
// App Store and Play reviewers' sign-in (auth/review.ts): off unless REVIEW_CODE and REVIEW_EMAILS are set. The review
// accounts are made or put right here, at every start; neither value is ever logged.
const review = reviewFrom(env.REVIEW_CODE, env.REVIEW_EMAILS);
if (review) await seedReview(db, review);
console.log(`[review] ${review ? `on for ${review.accounts.map((a) => a.app).join(", ")}` : "off"}`);
const codes = { openTo, dailyCap, review };
const mode = (s: unknown) => (s === logCode ? "logs" : s ? "sends" : "off");
console.log(
  `[codes] WhatsApp ${mode(phone)}, email ${mode(email)}, open to ${openTo ? `${openTo.size} contacts` : "everyone"}, ` +
    `alert at ${dailyCap} a day per channel, when WhatsApp codes stop until midnight`,
);
const store = production || process.env.REDIS_URL ? redisStore(need("REDIS_URL")) : memoryStore();
// Messages to people (notifications.ts): written to the inbox and the deliveries queue, which the worker below sends.
const notify = createNotifier({ db, now: Date.now });

// Pushes (push.ts), each platform on its own keys; a platform without them has no sender and its pushes are skipped as
// not set up.
// - iOS: APNS_KEY_ID and APNS_PRIVATE_KEY (an APNs .p8 key, \n for line breaks), under APNS_TEAM_ID.
// - Android: FCM_SERVICE_ACCOUNT, the service account's JSON key (Google Cloud project heyorbit-app), on one line.
const fcmKey = (() => {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const k = JSON.parse(env.FCM_SERVICE_ACCOUNT) as { project_id?: string; client_email?: string; private_key?: string };
    if (k.project_id && k.client_email && k.private_key) return { projectId: k.project_id, clientEmail: k.client_email, privateKey: k.private_key };
  } catch {}
  throw new Error("FCM_SERVICE_ACCOUNT must be a service account's JSON key, on one line");
})();
const push: Push = {
  ios:
    env.APNS_KEY_ID && env.APNS_PRIVATE_KEY
      ? apnsSender({ teamId: env.APNS_TEAM_ID?.trim() || "9AH3Z5C5DH", keyId: env.APNS_KEY_ID.trim(), privateKey: env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n") })
      : undefined,
  android: fcmKey ? fcmSender(fcmKey) : undefined,
};
console.log(`[push] APNs ${push.ios ? "on" : "not set up"}, FCM ${fcmKey ? `on for ${fcmKey.projectId}` : "not set up"}`);

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
// - APP_BUNDLE_ID: the apps' iOS bundle ids, comma-separated, the Orbit app's first, which is also the Android package
//   Play Integrity checks. Unless set: the Orbit app, then the host apps Orbit Launch, Station and Crew (22 Nov 2026).
//   ponytail: Play checks the first package only; the host apps prove themselves on Android when Play has each.
// - Web: Turnstile, with TURNSTILE_SECRET.
const playKey = (() => {
  if (!env.PLAY_INTEGRITY_KEY) return null;
  try {
    const k = JSON.parse(env.PLAY_INTEGRITY_KEY) as { client_email?: string; private_key?: string };
    if (k.client_email && k.private_key) return { email: k.client_email, key: k.private_key };
  } catch {}
  throw new Error("PLAY_INTEGRITY_KEY must be a service account's JSON key, on one line");
})();
const apps = appsFrom(env.APP_BUNDLE_ID, env.APPLE_TEAM_ID?.trim() || "9AH3Z5C5DH");
const proof: ProofConfig = {
  enforce: env.PROOF?.trim() === "enforce",
  apple: { appIds: apps.appIds },
  play: playKey ? { packageName: apps.playPackage, ...playKey, certs: list(env.PLAY_CERTS) } : undefined,
  turnstile: env.TURNSTILE_SECRET ? { secret: env.TURNSTILE_SECRET } : undefined,
};
console.log(
  `[proof] ${proof.enforce ? "enforced" : "logged only"}: App Attest for ${proof.apple.appIds.join(", ")}, ` +
    `Play Integrity ${proof.play ? `for ${proof.play.packageName}` : "not set up"}, ` +
    `Turnstile ${proof.turnstile ? "on (the waitlist's code sends enforce it)" : "not set up"}`,
);

// Day-30 account deletions. ponytail: an hourly sweep until the job runner runs it nightly at 03:30 IST.
setInterval(() => runDeletions(db, notify, Date.now(), revokeApple, media).catch((e) => console.error("[deletions]", e)), 60 * 60 * 1000).unref();

// Visit log rows past the privacy page's 180 days.
setInterval(() => pruneVisits(db, Date.now()).catch((e) => console.error("[visits]", e)), 60 * 60 * 1000).unref();

// Inbox items and deliveries past 180 days.
setInterval(() => pruneNotifications(db, Date.now()).catch((e) => console.error("[notifications]", e)), 60 * 60 * 1000).unref();

// Ask Orbit's log past 180 days.
setInterval(() => pruneAsks(db, Date.now()).catch((e) => console.error("[ask]", e)), 60 * 60 * 1000).unref();

// The deliveries worker: a pass every 5 seconds, never two at once in this process (other processes are kept off by the
// claim itself). Without SES in production, emails are skipped as not set up; off production they're logged ([mail]).
let busy = false;
setInterval(() => {
  if (busy) return;
  busy = true;
  runDeliveries({ db, mail, push, now: Date.now, unsubscribe: { secret, url: apiUrl } })
    .catch((e) => console.error("[deliveries]", e))
    .finally(() => (busy = false));
}, 5_000).unref();

// Tomorrow, Starting soon and Thanks to ticket holders (announcements.ts), every minute, never two at once here; keyed,
// so another box's overlap sends once.
let reminding = false;
setInterval(() => {
  if (reminding) return;
  reminding = true;
  sendReminders({ db, notify, now: Date.now })
    .catch((e) => console.error("[reminders]", e))
    .finally(() => (reminding = false));
}, 60_000).unref();

// Broadcasts (broadcasts.ts): the one-holder wait, due scheduled ones, and batches of the sending ones, every minute,
// never two at once here.
let broadcasting = false;
setInterval(() => {
  if (broadcasting) return;
  broadcasting = true;
  runBroadcasts({ db, notify, now: Date.now })
    .catch((e) => console.error("[broadcasts]", e))
    .finally(() => (broadcasting = false));
}, 60_000).unref();

// Push and email providers failing more than 20% over the last hour: an alert to Platform holders (notifications.ts).
// On start, then hourly.
const checkSenders = () => checkProviders({ db, notify, now: Date.now }).catch((e) => console.error("[providers]", e));
void checkSenders();
setInterval(checkSenders, 60 * 60 * 1000).unref();

// Activity rows past 90 days (owner, 19 Nov 2026: "90 days"): their day's totals are kept, the people go. On start, then hourly.
const sweep = () => sweepActivity(db, Date.now()).catch((e) => console.error("[activity]", e));
void sweep();
setInterval(sweep, 60 * 60 * 1000).unref();

// Applications 12 months after their role closed (careers.ts), résumés first. On start, then hourly.
const pruneCareers = () => pruneApplications(db, media, Date.now()).catch((e) => console.error("[careers]", e));
void pruneCareers();
setInterval(pruneCareers, 60 * 60 * 1000).unref();

// "Hear if it frees up" (slots/alerts.ts): every minute, a push to whoever's slot fits again. ponytail: runs on each
// instance; the conditional update sends each alert once.
setInterval(() => sweepSlotAlerts(db, notify, Date.now()).catch((e) => console.error("[slot-alerts]", e)), 60_000).unref();

// SES bounces and complaints (email-hygiene.ts): SES notifies the SNS topic SES_SNS_TOPIC_ARN, whose HTTPS subscription
// is <API_URL>/hooks/ses. Unset, the hook is off (404).
const sesTopic = env.SES_SNS_TOPIC_ARN?.trim() || undefined;
console.log(`[ses-hook] ${sesTopic ? `on for ${sesTopic}` : "off"}`);

// Paying (payments/routes.ts): Orbit's own Razorpay merchant, RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (Dashboard › API
// keys), and RAZORPAY_WEBHOOK_SECRET (the secret typed when adding the webhook <API_URL>/razorpay/webhook, with
// payment.captured, payment.failed, order.paid, refund.processed and refund.failed). All three or paying is off (503).
// Never logged.
const rz =
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
    ? razorpay({ keyId: env.RAZORPAY_KEY_ID.trim(), keySecret: env.RAZORPAY_KEY_SECRET.trim(), webhookSecret: env.RAZORPAY_WEBHOOK_SECRET.trim() })
    : undefined;
console.log(`[payments] Razorpay ${rz ? `on (${rz.keyId.startsWith("rzp_live_") ? "live" : "test"} keys)` : "off"}`);

// Ask Orbit (ask.ts): the model key ANTHROPIC_API_KEY. Unset, POST /ask answers 503 askOff. Never logged.
const ask = env.ANTHROPIC_API_KEY?.trim() ? askModel(env.ANTHROPIC_API_KEY.trim()) : undefined;
console.log(`[ask] Ask Orbit ${ask ? "on" : "off"}`);

// Orders nobody settled and refunds due a try (pollPayments), every 15 minutes, never two at once here.
let polling = false;
if (rz)
  setInterval(() => {
    if (polling) return;
    polling = true;
    pollPayments({ db, rz, notify, now: Date.now() })
      .catch((e) => console.error("[payments]", e))
      .finally(() => (polling = false));
  }, 15 * 60_000).unref();

serve({ fetch: createApp({ db, store, send, notify, secret, codes, ways: waysConfig, media, proof, mail, sesTopic, razorpay: rz, ask }).fetch, port }, (info) => {
  console.log(`orbit-api listening on :${info.port}`);
});
