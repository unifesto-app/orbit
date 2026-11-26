// The ways to pay (owner, 19 Nov 2026: "bring the payment methods screen from unifesto but with orbit's ui"), from
// Unifesto's pay-method sheet (mobile/src/components/registration/Steps.tsx, PayMethodsSheet): UPI apps (the big three
// first, four showing and the rest under Show more), your UPI IDs (checked with Razorpay, then added), card, wallets and
// Apple Pay on iPhones; no netbanking (owner, 19 Nov 2026: "remove netbanking"). Every payment goes through Razorpay at
// checkout (Booking doc, Paying); Orbit keeps no card or bank detail, only which way you like to pay and the UPI IDs you
// added, on this phone (src/session.ts). Pure, so pay.test.ts runs it on Node.
// ponytail: fixed lists until the API reads our Razorpay account's own (Unifesto's /v1/methods, cached) and the phone's
// installed UPI apps (Razorpay's SDK finds them at checkout).

import type { MyPayment, MyRefund, PayOrder, Verified } from '@orbit/contract';

import type { makeApi, Result } from './api.ts';

export type PayWith =
  | { kind: 'upiApp'; id: string }
  | { kind: 'vpa'; vpa: string }
  | { kind: 'card' }
  | { kind: 'wallet'; code: string }
  | { kind: 'applePay' };

export const UPI_APPS = [
  { id: 'gpay', name: 'Google Pay' },
  { id: 'phonepe', name: 'PhonePe' },
  { id: 'paytm', name: 'Paytm' },
  { id: 'bhim', name: 'BHIM' },
  { id: 'cred', name: 'CRED' },
  { id: 'amazonpay', name: 'Amazon Pay' },
  { id: 'navi', name: 'Navi' },
  { id: 'supermoney', name: 'super.money' },
] as const;

// Named as wallets: PhonePe and Amazon Pay are often UPI apps too (Unifesto's WALLET_NAMES).
export const WALLETS = [
  { code: 'amazonpay', name: 'Amazon Pay' },
  { code: 'mobikwik', name: 'MobiKwik' },
  { code: 'payzapp', name: 'PayZapp' },
  { code: 'freecharge', name: 'Freecharge' },
  { code: 'airtelmoney', name: 'Airtel Money' },
] as const;

/** How many of a long list show before Show more (Unifesto shows four UPI apps). */
export const SHOWN = 4;

/** name@bank: a UPI ID worth sending to Razorpay, which checks it's real (Unifesto's isVpa). */
export const isVpa = (v: string) => /^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(v.trim());

/** A UPI ID you added, with the name Razorpay found on it. */
export type UpiId = { vpa: string; name: string };

// Our Razorpay account's public key id (rzp_live_… or rzp_test_…), the one its checkout shows anyone; never the secret.
// Set as EXPO_PUBLIC_RAZORPAY_KEY_ID (eas.json, or .env when running locally). Without it no UPI ID can be checked.
export const RAZORPAY_KEY = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? '';

/** Whose UPI ID it is, asked of Razorpay as its checkout does (Unifesto's verifyUpiId): the holder's name, 'invalid'
 * when there's no such ID, or null when it couldn't say (no key, offline, slower than 8 seconds). */
export async function verifyUpiId(vpa: string, keyId = RAZORPAY_KEY): Promise<{ name: string } | 'invalid' | null> {
  if (!keyId) return null;
  const ask = fetch(`https://api.razorpay.com/v1/payments/validate/account?key_id=${encodeURIComponent(keyId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `entity=vpa&value=${encodeURIComponent(vpa.trim())}`,
  })
    .then((res) => res.json())
    .then((body): { name: string } | 'invalid' | null => {
      if (body?.success === true) return { name: String(body.customer_name ?? '').trim() };
      // No such ID: 200 with success false. Not a UPI ID at all: 400 invalid_vpa.
      return body?.success === false || body?.error?.reason === 'invalid_vpa' ? 'invalid' : null;
    })
    .catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), 8000)));
  try {
    return await Promise.race([ask, slow]);
  } finally {
    clearTimeout(timer);
  }
}

/** One key per choice, to tell which row is picked; a typed UPI ID ticks its row whatever's typed. */
export function payKey(p: PayWith): string {
  switch (p.kind) {
    case 'upiApp':
      return `upi:${p.id}`;
    case 'wallet':
      return `wallet:${p.code}`;
    default:
      return p.kind;
  }
}

/** A pick's name on its own, as the Pay with line shows it: "Google Pay", "ravi@ybl", "MobiKwik wallet". */
export function payName(p: PayWith): string {
  switch (p.kind) {
    case 'upiApp':
      return UPI_APPS.find((a) => a.id === p.id)?.name ?? 'UPI';
    case 'vpa':
      return p.vpa.trim();
    case 'card':
      return 'Credit or debit card';
    case 'wallet':
      return `${WALLETS.find((w) => w.code === p.code)?.name ?? 'Your'} wallet`;
    case 'applePay':
      return 'Apple Pay';
  }
}

/** Whether a pick can pay: there is one, and a typed UPI ID looks like name@bank. */
export const payReady = (p?: PayWith): p is PayWith => !!p && (p.kind !== 'vpa' || isVpa(p.vpa));

/** What the pay bar says (Unifesto: "Pay with …", or a prompt). */
export function payLabel(p?: PayWith): string {
  if (!p) return 'Choose how to pay';
  if (!payReady(p)) return 'Add your UPI ID';
  return `Pay with ${p.kind === 'card' ? 'a card' : payName(p)}`;
}

// ---------- Paying for a ticket (X3; api/src/payments/routes.ts): the calls, the Booking doc's words, checkout's bits ----------

type Api = Pick<ReturnType<typeof makeApi>, 'authed'>;
export const paymentsApi = (api: Api) => ({
  order: (eventId: string, ticketTypeId: string, quantity: number) => api.authed<PayOrder>('POST', `/events/${eventId}/pay`, { ticketTypeId, quantity }),
  verify: (orderId: string, paymentId: string, signature: string) =>
    api.authed<Verified>('POST', `/payments/${encodeURIComponent(orderId)}/verify`, { paymentId, signature }),
  status: (orderId: string) => api.authed<Verified>('GET', `/payments/${encodeURIComponent(orderId)}`),
  mine: () => api.authed<MyPayment[]>('GET', '/me/payments'),
  refunds: () => api.authed<MyRefund[]>('GET', '/me/refunds'),
});

/** The Booking flow's lines for paying, word for word. */
export const PAY_SAYS = {
  dismissed: 'Payment not completed. Nothing was charged.',
  failed: 'Payment failed. Try again, or pick another way to pay.',
  already: 'You’re already paying for this ticket. Finish there, or wait a few minutes.',
  confirming: 'We’re confirming your payment. Your ticket appears here within a few minutes.',
  refunded: 'That sold out while you were paying. We’ve refunded you in full.',
  off: 'Orbit isn’t taking payments yet, so nothing was charged.',
};

/** Why a payment went back with no ticket (settle's reason, api/src/payments/routes.ts), in a short true line. */
export function refundSays(reason?: string): string {
  switch (reason) {
    case 'fewLeft':
      return PAY_SAYS.refunded;
    case 'booked':
      return 'You already have this ticket. We’ve refunded this payment in full.';
    case 'cancelled':
      return 'This event was cancelled. We’ve refunded you in full.';
    case 'ended':
      return 'This event has ended. We’ve refunded you in full.';
    case 'closed':
      return 'Booking closed while you were paying. We’ve refunded you in full.';
    case 'notOpen':
      return 'Booking isn’t open yet. We’ve refunded you in full.';
    case 'tooMany':
      return 'That’s more tickets than one person can book. We’ve refunded you in full.';
    default:
      return 'We couldn’t give you this ticket, so we’ve refunded you in full.';
  }
}

/** What the booking sheet does next while paying. `again`: nothing was taken, so Pay can be tapped again; `reread`: the
 * event changed, so it's read again and the pick shown; `confirming`: never reopen checkout, the ticket comes later. */
export type PayNext =
  | { next: 'open'; order: PayOrder }
  | { next: 'already'; order: PayOrder; say: string }
  | { next: 'ticket'; bookingId: string }
  | { next: 'confirming'; say: string }
  | { next: 'refunded'; say: string }
  | { next: 'again'; say: string }
  | { next: 'reread'; say: string };
/** Every next step but opening checkout. */
export type PayDone = Exclude<PayNext, { order: PayOrder }>;

/** The answer to Pay's order request. An open order this sheet didn't make ("already") is said, not opened: the next tap
 * opens it. One this sheet made is reused without a word. */
export function orderNext(r: Result<PayOrder>, ours: ReadonlySet<string>): PayNext {
  if (r.ok) return r.data.already && !ours.has(r.data.orderId) ? { next: 'already', order: r.data, say: PAY_SAYS.already } : { next: 'open', order: r.data };
  if (r.status === 503 && r.error.error === 'paymentsOff') return { next: 'again', say: PAY_SAYS.off };
  if (r.status === 409) return { next: 'reread', say: r.error.message };
  return { next: 'again', say: r.error.message };
}

/** Where a payment stands once checkout is done: verify's answer after Razorpay took it (`closed` unset), or the order's
 * status after checkout closed without it (`closed`: how). Only a bad signature, or an order still open, failed or
 * expired, lets Pay go again; anything unknown is confirming, so checkout never reopens on money that may have gone. */
export function paidNext(r: Result<Verified>, closed?: 'dismissed' | 'failed'): PayDone {
  const confirming: PayDone = { next: 'confirming', say: PAY_SAYS.confirming };
  if (!r.ok) return !closed && r.error.error === 'badSignature' ? { next: 'again', say: PAY_SAYS.failed } : confirming;
  const v = r.data;
  if (v.status === 'paid' && v.bookingId) return { next: 'ticket', bookingId: v.bookingId };
  if (v.status === 'refundPending' || v.status === 'refunded') return { next: 'refunded', say: refundSays(v.reason) };
  if (closed && (v.status === 'created' || v.status === 'failed' || v.status === 'expired')) return { next: 'again', say: PAY_SAYS[closed] };
  return confirming;
}

/** Whether Razorpay's checkout closed because the payer closed it (no money tried): code 0 on Android, 2 on iOS, and
 * either says "cancel" in its reason. Anything else is a failed payment. */
export function checkoutCancelled(err: unknown, os: string): boolean {
  const e = (err ?? {}) as { code?: number; description?: string; reason?: string };
  return e.code === (os === 'ios' ? 2 : 0) || /cancel/i.test(`${e.reason ?? ''} ${e.description ?? ''}`);
}

/** The way you picked, as checkout's prefill: it opens on that method (Razorpay's prefill.method; a UPI ID filled in). */
export function prefillOf(p?: PayWith): { method?: 'upi' | 'card' | 'wallet'; vpa?: string } {
  if (!p) return {};
  if (p.kind === 'upiApp') return { method: 'upi' };
  if (p.kind === 'vpa') return { method: 'upi', vpa: p.vpa.trim() };
  if (p.kind === 'card') return { method: 'card' };
  if (p.kind === 'wallet') return { method: 'wallet' };
  return {};
}

/** A refund's status in the Booking doc's words. */
export const refundWord = (s: MyRefund['status']) => (s === 'processed' ? 'Refunded' : s === 'failed' ? 'Refund failed, retrying' : 'Requested');
