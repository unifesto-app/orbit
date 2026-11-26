import { createVerify } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Db } from "./db/index.ts";
import { deliveries, emailSuppressions, users } from "./db/schema.ts";
import { isUuid } from "./http.ts";
import { saveSettings } from "./me-notifications.ts";
import type { EmailSwitch } from "@orbit/contract";
import { readUnsubscribeToken, SWITCH_ABOUT } from "./notification-emails.ts";
import { esc } from "./prelaunch-email.ts";

// Email hygiene (notifications build plan, PR 6): SES's bounces and complaints through SNS fill email_suppressions,
// which the notification pipeline skips (notifications.ts), and optional emails' one-click unsubscribe links.

type Fetch = typeof fetch;
const TIMEOUT_MS = 5_000;

// ---------- POST /hooks/ses: SNS, signed ----------

// SNS's certificates and confirmation links live only on sns.<the topic's region>.amazonaws.com, exactly (a pattern
// would let in sns.s3.amazonaws.com, an S3 bucket anyone can own), over https on the default port, with no user or
// password. A certificate link also has no query and ends .pem. Anything else is refused before it's fetched.
const snsUrl = (u: unknown, region: string | undefined, cert: boolean) => {
  if (typeof u !== "string" || !region) return null;
  try {
    const url = new URL(u);
    const ok =
      url.protocol === "https:" &&
      url.hostname === `sns.${region}.amazonaws.com` &&
      !url.port &&
      !url.username &&
      !url.password &&
      (!cert || (!url.search && url.pathname.endsWith(".pem")));
    return ok ? url : null;
  } catch {
    return null;
  }
};
const regionOf = (topicArn: string) => topicArn.split(":")[3];

// The keys SNS signs, in order (AWS: "Verifying the signatures of Amazon SNS messages"); Subject only when present.
const SIGNED: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

type Sns = Record<string, unknown>;

// "ok" when the message is SNS's, signed by the certificate at its SigningCertURL, for our topic; "unavailable" when
// the certificate couldn't be fetched (SNS should retry); else "bad".
// Both signature versions pass: whether the topic signs with 2 (SignatureVersion on the topic) isn't known here, and
// version 1 is still SNS's default. ponytail: refuse "1" once the topic is set to 2.
// ponytail: no Timestamp freshness check; a replayed message only repeats idempotent writes.
export async function snsVerified(m: Sns, topicArn: string, cert: (url: string) => Promise<string>): Promise<"ok" | "bad" | "unavailable"> {
  const type = String(m.Type);
  const keys = Object.hasOwn(SIGNED, type) ? SIGNED[type]! : null;
  const alg = m.SignatureVersion === "1" ? "RSA-SHA1" : m.SignatureVersion === "2" ? "RSA-SHA256" : null;
  const certUrl = snsUrl(m.SigningCertURL, regionOf(topicArn), true);
  if (!keys || !alg || !certUrl || m.TopicArn !== topicArn || typeof m.Signature !== "string") return "bad";
  let text = "";
  for (const k of keys) {
    if (k === "Subject" && m.Subject === undefined) continue;
    if (typeof m[k] !== "string") return "bad";
    text += `${k}\n${m[k]}\n`;
  }
  let pem: string;
  try {
    pem = await cert(certUrl.href);
  } catch {
    return "unavailable";
  }
  try {
    return createVerify(alg).update(text).verify(pem, m.Signature, "base64") ? "ok" : "bad";
  } catch {
    return "bad";
  }
}

// One certificate fetch per URL, the last 10 kept for the process (SNS rotates them rarely). A failed fetch isn't kept.
const CERTS_KEPT = 10;
const certCache = (fetchImpl: Fetch) => {
  const cache = new Map<string, Promise<string>>();
  return (url: string) => {
    let p = cache.get(url);
    if (!p) {
      p = fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" }).then(async (r) => {
        if (!r.ok) throw new Error(`certificate ${r.status}`);
        return r.text();
      });
      p.catch(() => cache.delete(url));
      cache.set(url, p);
      if (cache.size > CERTS_KEPT) cache.delete(cache.keys().next().value!); // the oldest
    }
    return p;
  };
};

// What SES puts in a Notification's Message (the fields read here).
type SesEvent = {
  notificationType?: string;
  mail?: { messageId?: string };
  bounce?: { bounceType?: string; bouncedRecipients?: { emailAddress?: string }[] };
  complaint?: { complainedRecipients?: { emailAddress?: string }[] };
};
const addresses = (list: { emailAddress?: unknown }[] | undefined) =>
  (Array.isArray(list) ? list : [])
    .map((r) => (typeof r?.emailAddress === "string" ? r.emailAddress.trim().toLowerCase() : ""))
    .filter((a) => a.includes("@") && a.length <= 320);

// Off (404) unless SES_SNS_TOPIC_ARN is set (app.ts mounts it only then). `fetch` reaches SNS: the certificate and the
// subscription's confirmation link.
export function sesHookRoutes({ db, topicArn, fetch: fetchImpl = fetch, now = Date.now }: { db: Db; topicArn: string; fetch?: Fetch; now?: () => number }) {
  const app = new Hono();
  const cert = certCache(fetchImpl);
  const deny = () => new Response(null, { status: 403 });
  app.post("/hooks/ses", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.body(null, 413) }), async (c) => {
    // SNS posts JSON as text/plain, so the body is read and parsed here.
    let m: Sns;
    try {
      m = JSON.parse(await c.req.text());
      if (!m || typeof m !== "object") return deny();
    } catch {
      return deny();
    }
    const verified = await snsVerified(m, topicArn, cert);
    if (verified === "unavailable") return c.body(null, 503); // the certificate didn't come: SNS retries later
    if (verified !== "ok") return deny();

    if (m.Type === "SubscriptionConfirmation") {
      const url = snsUrl(m.SubscribeURL, regionOf(topicArn), false);
      if (!url) return deny();
      const r = await fetchImpl(url.href, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" }).catch(() => null);
      console.log(`[ses-hook] subscription to ${topicArn} ${r?.ok ? "confirmed" : `not confirmed (${r?.status ?? "no answer"})`}`);
      return c.body(null, r?.ok ? 200 : 502);
    }
    if (m.Type !== "Notification") return c.body(null, 200);

    // Signed by SNS but not SES's shape: nothing to do, and no retry.
    // ponytail: reads identity notifications only (notificationType); a configuration set's event publishing (eventType)
    // isn't read.
    let e: SesEvent;
    try {
      e = JSON.parse(String(m.Message));
    } catch {
      return c.body(null, 200);
    }
    if (!e || typeof e !== "object") return c.body(null, 200);
    const reason: "bounce" | "complaint" | null = e.notificationType === "Bounce" && e.bounce?.bounceType === "Permanent" ? "bounce" : e.notificationType === "Complaint" ? "complaint" : null;
    if (!reason) return c.body(null, 200); // a transient bounce, a delivery: nothing to keep
    const list = addresses(reason === "bounce" ? e.bounce?.bouncedRecipients : e.complaint?.complainedRecipients);
    const at = new Date(now());
    // Idempotent, as SNS retries. A bounce outranks a complaint (it stops Must email too); the first time stays.
    if (list.length)
      await db
        .insert(emailSuppressions)
        .values(list.map((address) => ({ address, reason, at })))
        .onConflictDoUpdate({ target: emailSuppressions.address, set: { reason: sql`case when excluded.reason = 'bounce' then 'bounce' else ${emailSuppressions.reason} end` } });
    const id = e.mail?.messageId;
    if (typeof id === "string" && id)
      await db
        .update(deliveries)
        .set({ status: "failed", reason: reason === "bounce" ? "bounced" : "complained" })
        .where(and(eq(deliveries.channel, "email"), eq(deliveries.providerId, id)));
    console.log(`[ses-hook] ${reason}: ${list.length} suppressed`);
    return c.body(null, 200);
  });
  return app;
}

// ---------- /public/unsubscribe?t= ----------

// A small page in the emails' look: Charcoal, white type. `form`: a button that posts back to this same link.
const page = (status: 200 | 400, heading: string, form?: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Orbit</title></head>
<body style="margin:0;padding:24px;background:#121215;color:#ffffff;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<p style="margin:0 0 16px;font-size:18px">${esc(heading)}</p>
${form ? `<form method="post" action="${esc(form)}"><button type="submit" style="padding:10px 20px;border:1px solid #ffffff;border-radius:999px;background:transparent;color:#ffffff;font-size:15px">Stop these emails</button></form>` : ""}
</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
const BAD = "This link doesn’t work. You can turn emails off in the Orbit app, under Account › Notifications.";
const done = (s: EmailSwitch) => `Done. Emails about ${SWITCH_ABOUT[s]} are off. You can turn them back on in the Orbit app, under Account › Notifications.`;

export function unsubscribeRoutes({ db, secret, now = Date.now }: { db: Db; secret: string; now?: () => number }) {
  const app = new Hono();
  const read = (t: string | undefined) => (t && t.length <= 512 ? readUnsubscribeToken(secret, t) : null);

  // GET only asks: mail scanners open links, so nothing changes here.
  app.get("/public/unsubscribe", (c) => {
    const t = c.req.query("t");
    const v = read(t);
    return v ? page(200, `Stop emails about ${SWITCH_ABOUT[v.s]}?`, `?t=${encodeURIComponent(t!)}`) : page(400, BAD);
  });

  // POST: the page's button, or a mail app's one-click (body List-Unsubscribe=One-Click, RFC 8058). The body isn't
  // needed: the token says who and which switch. A deleted account gets the same page.
  app.post("/public/unsubscribe", bodyLimit({ maxSize: 4096, onError: () => page(400, BAD) }), async (c) => {
    const v = read(c.req.query("t"));
    if (!v) return page(400, BAD);
    const [u] = isUuid(v.u) ? await db.select({ id: users.id, city: users.city }).from(users).where(and(eq(users.id, v.u), isNull(users.deletedAt))) : [];
    if (u) await saveSettings(db, u, { switches: { [`email.${v.s}`]: false } }, new Date(now()));
    return page(200, done(v.s));
  });
  return app;
}
