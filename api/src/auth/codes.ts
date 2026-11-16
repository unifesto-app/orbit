import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Contact } from "@orbit/contract";
import { NotSent } from "./senders.ts";
import type { Store } from "./store.ts";

// 6-digit codes on WhatsApp or by email, with the limits the User flow keeps from today (Account security).

export type Sender = (to: Contact, code: string) => Promise<void>;

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const CODE_TTL = 10 * MIN;
export const RESEND_AFTER = 30; // seconds

export const idOf = (c: Contact) => (c.kind === "phone" ? c.e164 : c.email);

// Who may get a code, and when the team hears that too many are going out.
// `openTo` is the opening gate (User flow): while it's set, only those numbers and emails get codes; everyone else
// hears Orbit isn't open yet. Null opens Orbit to everyone, which waits for the Turnstile and App Attest checks on
// sends: the WhatsApp number and the SES sender are the live Unifesto app's too, and every WhatsApp send is billed.
// `dailyCap` is the platform-wide daily count per channel past which the team is alerted (User flow, Account
// security); sends go on.
// ponytail: the alert is a log line, once a day per channel, until the Notifications flow sends messages.
export type SendPolicy = { openTo: ReadonlySet<string> | null; dailyCap: number };
export const OPEN: SendPolicy = { openTo: null, dailyCap: Infinity };

export type SendResult =
  | { ok: true; unsure?: true } // unsure: the provider didn't answer clearly; the code is kept in case it arrives
  | { ok: false; error: "notOpen" | "tooSoon" | "tooMany" }
  | { ok: false; error: "notSent"; reason: "refused" | "throttled" | "notSetUp" };

export async function sendCode(store: Store, send: Sender, secret: string, to: Contact, ip: string, policy: SendPolicy = OPEN): Promise<SendResult> {
  const id = idOf(to);
  if (policy.openTo && !policy.openTo.has(id)) return { ok: false, error: "notOpen" };
  if ((await store.incr(`send:gap:${id}:${ip}`, RESEND_AFTER * SEC)) > 1) return { ok: false, error: "tooSoon" };
  const counts = await Promise.all([
    store.incr(`send:day:${id}:${ip}`, DAY),
    store.incr(`send:day:${id}`, DAY),
    store.incr(`send:hour:${ip}`, HOUR),
  ]);
  if (counts[0] > 10 || counts[1] > 20 || counts[2] > 100) return { ok: false, error: "tooMany" };
  if ((await store.incr(`send:all:${to.kind}`, DAY)) === policy.dailyCap + 1)
    console.error(`[codes] more than ${policy.dailyCap} ${to.kind} codes in a day: check for abuse`);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const keep = () => store.set(`code:${id}`, mac(secret, id, code), CODE_TTL);
  try {
    await send(to, code);
  } catch (e) {
    if (!(e instanceof NotSent)) throw e;
    // A provider's error can quote the request back, so the code is blanked out before anything is logged.
    console.error(`[codes] ${e.message.replaceAll(code, "••••••")}`);
    // It may yet arrive: keep it, and let them ask again after the usual wait.
    if (e.reason === "unknown") return keep().then(() => ({ ok: true, unsure: true }));
    await store.del(`send:gap:${id}:${ip}`); // it never went, so no wait before trying again
    return { ok: false, error: "notSent", reason: e.reason };
  }
  await keep(); // only now, so a send that never went leaves the last code good
  return { ok: true };
}

export type CheckResult = { ok: true } | { ok: false; error: "tooMany" | "expired" | "wrongCode" };

// Every try is counted before the code is compared, so guesses sent all at once still meet the limits: 5 per number
// or email and IP, 50 per IP, then 40 per number or email, which also deletes the code. Counted in that order, one
// address can't use up a number's 40.
// Right once: the code is deleted by the first request that matches it, so two at once can't both sign in.
export async function checkCode(store: Store, secret: string, to: Contact, code: string, ip: string): Promise<CheckResult> {
  const id = idOf(to);
  const window = 15 * MIN;
  if ((await store.incr(`tries:${id}:${ip}`, window)) > 5) return { ok: false, error: "tooMany" };
  if ((await store.incr(`tries:ip:${ip}`, window)) > 50) return { ok: false, error: "tooMany" };
  if ((await store.incr(`tries:${id}`, window)) > 40) {
    await store.del(`code:${id}`);
    return { ok: false, error: "tooMany" };
  }

  const held = await store.get(`code:${id}`);
  if (!held) return { ok: false, error: "expired" };
  if (!timingSafeEqual(Buffer.from(held), Buffer.from(mac(secret, id, code)))) return { ok: false, error: "wrongCode" };
  if (!(await store.del(`code:${id}`))) return { ok: false, error: "expired" };
  // The limits are on wrong codes, so a right one gives its try back: many people signing in from one gate's Wi-Fi
  // never add up to a lockout.
  await Promise.all([store.del(`tries:${id}:${ip}`), store.incr(`tries:ip:${ip}`, window, -1), store.incr(`tries:${id}`, window, -1)]);
  return { ok: true };
}

// The code is never stored as typed.
const mac = (secret: string, id: string, code: string) => createHmac("sha256", secret).update(`code:${id}:${code}`).digest("hex");
