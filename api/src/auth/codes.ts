import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Contact } from "@orbit/contract";
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

export type SendResult = { ok: true } | { ok: false; error: "tooSoon" | "tooMany" };

export async function sendCode(store: Store, send: Sender, secret: string, to: Contact, ip: string): Promise<SendResult> {
  const id = idOf(to);
  if ((await store.incr(`send:gap:${id}:${ip}`, RESEND_AFTER * SEC)) > 1) return { ok: false, error: "tooSoon" };
  const counts = await Promise.all([
    store.incr(`send:day:${id}:${ip}`, DAY),
    store.incr(`send:day:${id}`, DAY),
    store.incr(`send:hour:${ip}`, HOUR),
  ]);
  if (counts[0] > 10 || counts[1] > 20 || counts[2] > 100) return { ok: false, error: "tooMany" };
  // ponytail: no Turnstile or App Attest check on sends yet, and no platform-wide daily cap. Both before going public.

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  try {
    await send(to, code);
  } catch (e) {
    await store.del(`send:gap:${id}:${ip}`); // a failed send doesn't make them wait to try again
    throw e;
  }
  await store.set(`code:${id}`, mac(secret, id, code), CODE_TTL); // only now, so a failed send keeps the last code good
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
