import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NoticeKind } from "@orbit/contract";
import { mimeMessage, NotSent, sesMail } from "./auth/senders.ts";
import { deliveries, emailSuppressions, notificationPrefs, users } from "./db/schema.ts";
import { sesHookRoutes } from "./email-hygiene.ts";
import { readUnsubscribeToken, unsubscribeToken } from "./notification-emails.ts";
import { testApp } from "./testkit.ts";

// Notifications PR 6: SES's bounces and complaints through a signed SNS hook, the suppression list, and optional emails'
// one-click unsubscribe links.
type Mailed = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> };
let mailed: Mailed[] = [];
let ids = 0;
// SNS, played by a key pair of our own: the hook fetches the "certificate" (the public key PEM) through `fetch`.
const TOPIC = "arn:aws:sns:ap-south-1:123456789012:orbit-ses";
const CERT = "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-abc.pem";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
let fetched: string[] = [];
const snsFetch = (async (url: string | URL) => {
  fetched.push(String(url));
  return new Response(String(url).endsWith(".pem") ? pem : "<ok/>", { status: 200 });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof testApp>>;
let ses: ReturnType<typeof sesHookRoutes>;
before(async () => {
  t = await testApp({ mail: async (to, m) => (mailed.push({ to, ...m }), `ses-${++ids}`) });
  ses = sesHookRoutes({ db: t.db, topicArn: TOPIC, now: t.now, fetch: snsFetch });
});
after(() => t.close());
beforeEach(async () => {
  await t.db.delete(deliveries);
  await t.db.delete(emailSuppressions);
  mailed = [];
  fetched = [];
});

const KEYS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};
const signed = (m: Record<string, string>, version: "1" | "2" = "2") => {
  const text = KEYS[m.Type!]!.filter((k) => m[k] !== undefined).map((k) => `${k}\n${m[k]}\n`).join("");
  const Signature = createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256").update(text).sign(privateKey, "base64");
  return { SigningCertURL: CERT, SignatureVersion: version, ...m, Signature };
};
const notification = (message: object, extra: Record<string, string> = {}) =>
  signed({ Type: "Notification", MessageId: crypto.randomUUID(), TopicArn: TOPIC, Message: JSON.stringify(message), Timestamp: new Date().toISOString(), ...extra });
const post = (body: object) => ses.request("/hooks/ses", { method: "POST", headers: { "content-type": "text/plain; charset=UTF-8" }, body: JSON.stringify(body) });
const bounce = (messageId: string, emails: string[], bounceType = "Permanent") => ({
  notificationType: "Bounce",
  mail: { messageId },
  bounce: { bounceType, bouncedRecipients: emails.map((emailAddress) => ({ emailAddress })) },
});

const device = { name: "iPhone", client: "app" as const };
let n = 0;
type A = { access: string; me: { id: string }; email: string };
const join = async (): Promise<A> => {
  const p = `8${String(6_000_000 + ++n * 19).padStart(9, "0")}`;
  t.tick(30_000);
  await t.call("POST", "/auth/code", { to: p });
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  const email = `h${n}@example.com`;
  await t.db.update(users).set({ email, emailVerifiedAt: new Date(t.now()) }).where(eq(users.id, s.body.me.id));
  return { ...s.body, email };
};
const emailsOf = (a: A, kind: NoticeKind) =>
  t.db.select().from(deliveries).where(and(eq(deliveries.userId, a.me.id), eq(deliveries.kind, kind), eq(deliveries.channel, "email")));
const suppressions = () => t.db.select().from(emailSuppressions);

test("a hard bounce suppresses the address and fails its delivery; a repeat is a no-op; the next sends skip", async () => {
  const a = await join();
  await t.notify({ to: { userId: a.me.id }, kind: "accountLifted", data: {} });
  await t.deliver();
  const [sent] = await emailsOf(a, "accountLifted");
  assert.deepEqual([sent!.status, sent!.providerId?.startsWith("ses-")], ["sent", true]);
  await t.notify({ to: { userId: a.me.id }, kind: "accountSuspended", data: { reason: "x" } }); // queued, not yet sent

  const body = notification(bounce(sent!.providerId!, [a.email.toUpperCase()]));
  assert.equal((await post(body)).status, 200);
  assert.deepEqual((await suppressions()).map((s) => [s.address, s.reason]), [[a.email, "bounce"]]);
  const [failed] = await emailsOf(a, "accountLifted");
  assert.deepEqual([failed!.status, failed!.reason], ["failed", "bounced"]);
  const at = (await suppressions())[0]!.at;
  t.tick(1000);
  assert.equal((await post(body)).status, 200); // SNS retries
  assert.deepEqual((await suppressions()).map((s) => s.at.getTime()), [at.getTime()]);

  // Queued before the bounce: the worker skips it. Written after: skipped at once.
  await t.deliver();
  const [held] = await emailsOf(a, "accountSuspended");
  assert.deepEqual([held!.status, held!.reason], ["skipped", "suppressed"]);
  await t.notify({ to: { userId: a.me.id }, kind: "deletionCancelled", data: {} });
  const [next] = await emailsOf(a, "deletionCancelled");
  assert.deepEqual([next!.status, next!.reason], ["skipped", "suppressed"]);
  assert.equal(mailed.length, 1);
  assert.equal(fetched.filter((u) => u === CERT).length, 1); // the certificate is fetched once
});

test("signature version 1 verifies too; a forged body, the wrong topic or an off-host certificate get 403", async () => {
  const a = await join();
  const good = notification(bounce("m-1", [a.email]));
  const forged = { ...good, Message: JSON.stringify(bounce("m-1", ["someone@else.com"])) };
  assert.equal((await post(forged)).status, 403);
  assert.equal((await post(notification(bounce("m-1", [a.email]), { TopicArn: "arn:aws:sns:ap-south-1:1:other" }))).status, 403);
  assert.equal((await post({ ...notification({}), Message: "x", Signature: "AAAA" })).status, 403);
  assert.equal((await suppressions()).length, 0);

  fetched = [];
  for (const url of [
    "https://evil.example.com/cert.pem",
    "http://sns.ap-south-1.amazonaws.com/cert.pem",
    "https://sns.ap-south-1.amazonaws.com.evil.com/cert.pem",
    "https://sns.ap-south-1.amazonaws.com/cert.txt",
    "https://sns.s3.amazonaws.com/cert.pem", // an S3 bucket anyone can own
    "https://sns.us-east-1.amazonaws.com/cert.pem", // not the topic's region
    "https://user:pw@sns.ap-south-1.amazonaws.com/cert.pem",
    "https://sns.ap-south-1.amazonaws.com:8443/cert.pem",
    "https://sns.ap-south-1.amazonaws.com/cert.pem?x=1",
  ]) {
    assert.equal((await post({ ...good, SigningCertURL: url })).status, 403, url);
  }
  assert.deepEqual(fetched, []); // refused without a fetch
  assert.equal((await suppressions()).length, 0);
  assert.equal((await ses.request("/hooks/ses", { method: "POST", body: "not json" })).status, 403);
  for (const body of ["null", "[]", "1"]) assert.equal((await ses.request("/hooks/ses", { method: "POST", body })).status, 403, body);
  // Prototype keys as the Type: refused, never a 500. A signed Message that isn't an object: nothing to do.
  for (const Type of ["constructor", "__proto__", "toString"]) assert.equal((await post({ ...good, Type })).status, 403, Type);
  assert.equal((await post(signed({ Type: "Notification", MessageId: "1", TopicArn: TOPIC, Message: "null", Timestamp: "t" }))).status, 200);

  assert.equal((await post(signed({ Type: "Notification", MessageId: "1", TopicArn: TOPIC, Message: JSON.stringify(bounce("m-2", [a.email])), Timestamp: "t" }, "1"))).status, 200);
  assert.equal((await suppressions()).length, 1);
});

test("a transient bounce keeps nothing; a complaint suppresses and marks its delivery", async () => {
  const a = await join();
  assert.equal((await post(notification(bounce("m-3", [a.email], "Transient")))).status, 200);
  assert.equal((await suppressions()).length, 0);

  await t.notify({ to: { userId: a.me.id }, kind: "accountLifted", data: {} });
  await t.deliver();
  const [sent] = await emailsOf(a, "accountLifted");
  const complaint = { notificationType: "Complaint", mail: { messageId: sent!.providerId }, complaint: { complainedRecipients: [{ emailAddress: a.email }] } };
  assert.equal((await post(notification(complaint, { Subject: "Amazon SES Email Event Notification" }))).status, 200);
  assert.deepEqual((await suppressions()).map((s) => s.reason), ["complaint"]);
  const [marked] = await emailsOf(a, "accountLifted");
  assert.deepEqual([marked!.status, marked!.reason], ["failed", "complained"]);
});

test("a certificate that doesn't come (5xx, timeout) answers 503 and isn't kept; the next try fetches again", async () => {
  const a = await join();
  const answers: (number | "throw")[] = [500, "throw"];
  const tries: string[] = [];
  const flaky = sesHookRoutes({
    db: t.db,
    topicArn: TOPIC,
    now: t.now,
    fetch: (async (url: string | URL) => {
      tries.push(String(url));
      const next = answers.shift() ?? 200;
      if (next === "throw") throw new Error("timed out");
      return new Response(next === 200 ? pem : "", { status: next });
    }) as typeof fetch,
  });
  const body = notification(bounce("m-9", [a.email]));
  const send = (b: object = body) => flaky.request("/hooks/ses", { method: "POST", body: JSON.stringify(b) });
  assert.equal((await send()).status, 503);
  assert.equal((await send()).status, 503);
  assert.equal((await suppressions()).length, 0);
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  assert.equal(tries.length, 3); // the two failures weren't kept; the good one was
  assert.equal((await suppressions()).length, 1);
  // A bad signature stays 403 with the certificate in hand.
  assert.equal((await send({ ...body, Signature: "AAAA" })).status, 403);
});

test("a complaint stops optional email only; a hard bounce stops Must too; a code to the address clears it", async () => {
  const a = await join();
  const complaint = { notificationType: "Complaint", mail: { messageId: "m-5" }, complaint: { complainedRecipients: [{ emailAddress: a.email }] } };
  assert.equal((await post(notification(complaint))).status, 200);
  await t.notify({ to: { userId: a.me.id }, kind: "accountLifted", data: {} }); // Must
  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data: {} }); // optional
  assert.deepEqual((await emailsOf(a, "accountLifted")).map((d) => d.status), ["queued"]);
  assert.deepEqual((await emailsOf(a, "hostAnnouncement")).map((d) => [d.status, d.reason]), [["skipped", "suppressed"]]);

  // A bounce after the complaint outranks it; a complaint after a bounce doesn't lower it.
  assert.equal((await post(notification(bounce("m-6", [a.email])))).status, 200);
  assert.equal((await post(notification(complaint))).status, 200);
  assert.deepEqual((await suppressions()).map((s) => s.reason), ["bounce"]);
  await t.deliver();
  assert.deepEqual((await emailsOf(a, "accountLifted")).map((d) => [d.status, d.reason]), [["skipped", "suppressed"]]);

  // Signing in with a code to the address proves it again.
  t.tick(30_000);
  await t.call("POST", "/auth/code", { to: a.email });
  const v = await t.call("POST", "/auth/code/verify", { to: a.email, code: t.lastCode(a.email), device });
  assert.equal(v.status, 200);
  assert.equal((await suppressions()).length, 0);
});

test("a queued email of a kind this build doesn't know doesn't stop the worker", async () => {
  const a = await join();
  await t.db.insert(deliveries).values({ userId: a.me.id, kind: "noSuchKind", channel: "email", target: a.email, dedupeKey: "x", payload: {}, status: "queued", runAt: new Date(t.now()) });
  await t.deliver();
  const [row] = await t.db.select().from(deliveries).where(eq(deliveries.kind, "noSuchKind"));
  assert.notEqual(row!.status, "sending");
});

test("a signed subscription confirmation is confirmed by fetching its SubscribeURL", async () => {
  const url = "https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc";
  const m = signed({ Type: "SubscriptionConfirmation", MessageId: "1", TopicArn: TOPIC, Message: "m", SubscribeURL: url, Timestamp: "t", Token: "abc" });
  assert.equal((await post(m)).status, 200);
  assert.ok(fetched.includes(url));
  fetched = [];
  const off = signed({ Type: "SubscriptionConfirmation", MessageId: "1", TopicArn: TOPIC, Message: "m", SubscribeURL: "https://evil.example.com/", Timestamp: "t", Token: "abc" });
  assert.equal((await post(off)).status, 403);
  assert.ok(!fetched.includes("https://evil.example.com/"));
});

test("unsubscribe token: round trip; a changed switch or user, or garbage, is refused", () => {
  const u = crypto.randomUUID();
  const tok = unsubscribeToken(t.secret, u, "follows");
  assert.deepEqual(readUnsubscribeToken(t.secret, tok), { u, s: "follows" });
  const sig = tok.split(".")[1];
  const forge = (o: object) => `${Buffer.from(JSON.stringify(o)).toString("base64url")}.${sig}`;
  assert.equal(readUnsubscribeToken(t.secret, forge({ u, s: "reminders" })), null);
  assert.equal(readUnsubscribeToken(t.secret, forge({ u: crypto.randomUUID(), s: "follows" })), null);
  assert.equal(readUnsubscribeToken("another-secret-that-is-at-least-32-chars", tok), null);
  for (const g of ["", "x", "a.b", `${tok}.x`, "!!!.???"]) assert.equal(readUnsubscribeToken(t.secret, g), null, g);
});

test("optional email: sent with the unsubscribe headers and footer; GET asks, one-click POST turns the switch off", async () => {
  const a = await join();
  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data: {} });
  await t.deliver();
  const m = mailed.find((x) => x.to === a.email)!;
  const link = m.headers!["List-Unsubscribe"]!.slice(1, -1);
  assert.match(link, /^https:\/\/api\.test\/public\/unsubscribe\?t=/);
  assert.equal(m.headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(m.text.includes(`emails about host announcements are on. Stop them: ${link}`));
  assert.ok(m.html.includes(`href="${link}"`));
  const path = link.replace("https://api.test", "");

  const get = await t.app.request(path);
  assert.equal(get.status, 200);
  assert.match(await get.text(), /Stop emails about host announcements\?/);
  assert.equal((await t.db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, a.me.id))).length, 0); // GET changes nothing

  const one = () =>
    t.app.request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  const res = await one();
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Done\. Emails about host announcements are off\./);
  assert.equal((await one()).status, 200); // again: the same
  const s = await t.call("GET", "/me/notification-settings", undefined, a.access);
  assert.equal(s.body.switches["email.announcements"], false);
  assert.equal(s.body.switches["email.follows"], true);

  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data: {} });
  const last = (await emailsOf(a, "hostAnnouncement")).find((d) => d.status === "skipped")!;
  assert.equal(last.reason, "switchOff");

  // Queued, then unsubscribed before the worker came: skipped at send time.
  await t.call("PUT", "/me/notification-settings", { switches: { "email.announcements": true } }, a.access);
  await t.notify({ to: { userId: a.me.id }, kind: "hostAnnouncement", data: { n: 2 } });
  assert.equal((await emailsOf(a, "hostAnnouncement")).filter((d) => d.status === "queued").length, 1);
  await one();
  const before = mailed.length;
  await t.deliver();
  assert.equal(mailed.length, before);
  assert.equal((await emailsOf(a, "hostAnnouncement")).filter((d) => d.reason === "switchOff").length, 2);

  assert.equal((await t.app.request("/public/unsubscribe?t=bad", { method: "POST" })).status, 400);
  assert.equal((await t.app.request("/public/unsubscribe?t=bad")).status, 400);
  // A deleted account: the same page, nothing written.
  const gone = unsubscribeToken(t.secret, crypto.randomUUID(), "orbit");
  assert.equal((await t.app.request(`/public/unsubscribe?t=${gone}`, { method: "POST" })).status, 200);
});

test("MIME: headers present, subject encoded, no line breaks let in; sesMail sends raw when there are headers", async () => {
  const raw = mimeMessage({
    from: "Orbit <no-reply@updates.heyorbit.in>",
    to: "a@example.com",
    subject: "You’re invited to a team on Orbit — with a long subject that needs folding over",
    html: "<p>hi</p>",
    text: "hi ".repeat(100),
    headers: { "List-Unsubscribe": "<https://api.test/public/unsubscribe?t=x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
  const [head] = raw.split("\r\n\r\n");
  assert.match(head!, /^From: Orbit <no-reply@updates\.heyorbit\.in>\r\nTo: a@example\.com\r\n/);
  assert.match(head!, /\r\nList-Unsubscribe: <https:\/\/api\.test\/public\/unsubscribe\?t=x>\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
  assert.match(head!, /\r\nMIME-Version: 1\.0\r\nContent-Type: multipart\/alternative; boundary="orbit-/);
  const subject = head!.match(/\r\nSubject: ((?:.|\r\n )+?)\r\nMIME/)![1]!;
  const words = subject.split("\r\n ");
  assert.ok(words.length > 1 && words.every((w) => w.length <= 75));
  assert.equal(words.map((w) => Buffer.from(w.match(/^=\?UTF-8\?B\?(.*)\?=$/)![1]!, "base64").toString()).join(""), "You’re invited to a team on Orbit — with a long subject that needs folding over");
  assert.ok(raw.split("\r\n").every((l) => l.length <= 998));
  assert.ok(raw.split("\r\n\r\n")[2]!.split("\r\n").every((l) => l.length <= 76 || l.startsWith("--")));

  for (const bad of [{ subject: "a\r\nBcc: x@y.z" }, { to: "a@example.com\nBcc: x@y.z" }, { headers: { "List-Unsubscribe": "<x>\r\nBcc: y" } }])
    assert.throws(() => mimeMessage({ from: "f", to: "a@example.com", subject: "s", html: "", text: "", ...bad }), (e) => e instanceof NotSent && e.reason === "refused");

  const raws: string[] = [];
  const plain: unknown[] = [];
  const mail = sesMail({ from: "f@x.com", send: async (i) => (plain.push(i), { MessageId: "p" }), sendRaw: async (r) => (raws.push(Buffer.from(r).toString()), { MessageId: "r" }) });
  assert.equal(await mail("a@example.com", { subject: "s", html: "h", text: "t", headers: { "List-Unsubscribe": "<u>" } }), "r");
  assert.equal(await mail("a@example.com", { subject: "s", html: "h", text: "t" }), "p");
  assert.deepEqual([raws.length, plain.length], [1, 1]);
  await assert.rejects(sesMail({ from: "f", send: async () => ({ MessageId: "p" }) })("a@x.com", { subject: "s", html: "", text: "", headers: { a: "b" } }), (e) => e instanceof NotSent && e.reason === "notSetUp");
});
