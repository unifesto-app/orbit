// The ways to pay (owner, 19 Nov 2026: "bring the payment methods screen from unifesto but with orbit's ui"), from
// Unifesto's pay-method sheet (mobile/src/components/registration/Steps.tsx, PayMethodsSheet): UPI apps (the big three
// first, four showing and the rest under Show more), your UPI IDs (checked with Razorpay, then added), card, wallets and
// Apple Pay on iPhones; no netbanking (owner, 19 Nov 2026: "remove netbanking"). Every payment goes through Razorpay at
// checkout (Booking doc, Paying); Orbit keeps no card or bank detail, only which way you like to pay and the UPI IDs you
// added, on this phone (src/session.ts). Pure, so pay.test.ts runs it on Node.
// ponytail: fixed lists until the API reads our Razorpay account's own (Unifesto's /v1/methods, cached). The UPI apps
// show only when this phone has them (upiOnPhone, from Razorpay's Custom UI).

import type { MyPayment, MyRefund, PayOrder, Verified } from '@orbit/contract';

import type { makeApi, Result } from './api.ts';

export type PayWith =
  | { kind: 'upiApp'; id: string }
  | { kind: 'vpa'; vpa: string }
  | { kind: 'card' }
  | { kind: 'wallet'; code: string }
  | { kind: 'applePay' };

export const UPI_APPS = [
  // android: the package Razorpay's Custom UI opens it by; ios: the shortcode it opens it by, then other ids the iOS
  // SDK may report for it (Razorpay's android table; iOS shortcodes from razorpay-customui-pod and Unifesto).
  { id: 'gpay', name: 'Google Pay', android: 'com.google.android.apps.nbu.paisa.user', ios: ['google_pay', 'googlepay'] },
  { id: 'phonepe', name: 'PhonePe', android: 'com.phonepe.app', ios: ['phonepe'] },
  { id: 'paytm', name: 'Paytm', android: 'net.one97.paytm', ios: ['paytm'] },
  { id: 'bhim', name: 'BHIM', android: 'in.org.npci.upiapp', ios: ['bhim'] },
  { id: 'cred', name: 'CRED', android: 'com.dreamplug.androidapp', ios: ['cred'] },
  { id: 'amazonpay', name: 'Amazon Pay', android: 'in.amazon.mShop.android.shopping', ios: ['amazonpay'] },
  { id: 'navi', name: 'Navi', android: 'com.naviapp', ios: ['navi'] },
  // ponytail: super.money's iOS shortcode is a guess (its scheme is "super"); the SDK's own report wins when it has one.
  { id: 'supermoney', name: 'super.money', android: 'money.super.payments', ios: ['super', 'supermoney', 'super.money'] },
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

/** What a UPI ID can hold, as typed: letters, digits, dot, hyphen and underscore before one @, letters and digits after
 * it (the bank's handle). Anything else, emoji and spaces too, is dropped, and it's lower case (UPI ignores case). */
export function cleanVpa(v: string): string {
  const [name = '', ...rest] = v.toLowerCase().split('@');
  const keepName = name.replace(/[^a-z0-9._-]/g, '');
  return rest.length ? `${keepName}@${rest.join('').replace(/[^a-z0-9]/g, '')}` : keepName;
}

// The banks' handles people have most (owner, 27 Nov 2026: "bring some @___"): PhonePe, Google Pay's four, Paytm,
// Amazon Pay and BHIM. Most-used first.
export const UPI_HANDLES = ['ybl', 'okhdfcbank', 'oksbi', 'okicici', 'okaxis', 'paytm', 'ptyes', 'ibl', 'axl', 'apl', 'slc', 'upi'] as const;

// Which app a handle belongs to (owner, 27 Nov 2026: "based on id extension display the logo of that app"): PhonePe's
// ybl/ibl/axl, Google Pay's ok…, Paytm's paytm and pt…, Amazon Pay's apl/yapl/rapl, BHIM's upi, slice's slc, WhatsApp's wa…, and the
// rest's own. A handle whose app has no logo in assets/pay shows the @.
const HANDLE_APP: Record<string, string> = {
  ybl: 'phonepe', ibl: 'phonepe', axl: 'phonepe', paytm: 'paytm', apl: 'amazonpay', yapl: 'amazonpay', rapl: 'amazonpay',
  upi: 'bhim', slc: 'slice', waicici: 'whatsapp', waaxis: 'whatsapp', wahdfcbank: 'whatsapp', wasbi: 'whatsapp', axisb: 'cred', naviaxis: 'navi', superyes: 'supermoney', ikwik: 'mobikwik', freecharge: 'freecharge', airtel: 'airtelmoney',
};
/** The app (a logo id) a UPI ID's handle belongs to, or undefined for a bank's own (the @ glyph then). */
export function vpaApp(vpa: string): string | undefined {
  const handle = vpa.trim().toLowerCase().split('@')[1] ?? '';
  return HANDLE_APP[handle] ?? (handle.startsWith('ok') ? 'gpay' : /^pt[a-z]+$/.test(handle) ? 'paytm' : undefined);
}

/** The handles to offer under the field once a name is typed: those starting with what's after the @, not one already
 * typed in full. Tapping one completes the ID. */
export function handleHints(v: string): string[] {
  const [name, typed = ''] = v.split('@');
  if (!name) return [];
  return UPI_HANDLES.filter((h) => h.startsWith(typed) && h !== typed).map((h) => `${name}@${h}`);
}

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
  pending: 'If you approved it, your ticket appears here shortly. Otherwise nothing was charged.',
  unknown: 'We couldn’t check that payment. Pull down on Your tickets in a minute, or try again.',
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
 * status after checkout closed without it (`closed`: how). After verify, a bad signature says the server's line and Pay
 * stays; any other trouble is confirming, so checkout never reopens on money that went. After a close, an attempt still
 * open at Razorpay ("pending") or a status we couldn't get ("unknown") keeps Pay on the same order. */
export function paidNext(r: Result<Verified>, closed?: 'dismissed' | 'failed'): PayDone {
  const confirming: PayDone = { next: 'confirming', say: PAY_SAYS.confirming };
  if (!r.ok) {
    if (closed) return { next: 'again', say: PAY_SAYS.unknown };
    return r.error.error === 'badSignature' ? { next: 'again', say: r.error.message } : confirming;
  }
  const v = r.data;
  if (v.status === 'paid' && v.bookingId) return { next: 'ticket', bookingId: v.bookingId };
  if (v.status === 'refundPending' || v.status === 'refunded') return { next: 'refunded', say: refundSays(v.reason) };
  if (closed && v.status === 'pending') return { next: 'again', say: PAY_SAYS.pending };
  if (closed && (v.status === 'created' || v.status === 'failed' || v.status === 'expired')) return { next: 'again', say: PAY_SAYS[closed] };
  return confirming;
}

/** Whether Razorpay's checkout closed because the payer closed it (no money tried): code 0 on Android, 2 on iOS, and
 * either says "cancel" in its reason. Anything else is a failed payment. */
export function checkoutCancelled(err: unknown, os: string): boolean {
  const e = (err ?? {}) as { code?: number; description?: string; reason?: string };
  return e.code === (os === 'ios' ? 2 : 0) || /cancel|back button/i.test(`${e.reason ?? ''} ${e.description ?? ''}`);
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

// Paying a UPI app without the sheet (owner, 27 Nov 2026: "Zomato-style direct"), as Unifesto does (mobile/src/lib/pay.ts):
// Razorpay's Custom UI lists the phone's UPI apps and opens the picked one. src/checkout.ts is the native half.

/** A UPI app on this phone: our id, and the id Razorpay's Custom UI opens it by. */
export type OnPhone = { id: string; app: string };

/** What Custom UI reports per app. iOS wraps the SDK's { appName, shortcode } in appName. */
export type FoundUpiApp = { appName?: string | { appName?: string; shortcode?: string }; packageName?: string };

/** The phone's UPI apps we know, in our order (Custom UI's list, matched by Android package or iOS shortcode). */
export function upiOnPhone(found: readonly FoundUpiApp[], os: string): OnPhone[] {
  const ids = new Map<string, string>(); // how the phone named it -> the id Custom UI takes back
  for (const f of found) {
    if (os !== 'ios') {
      if (f.packageName) ids.set(f.packageName, f.packageName);
      continue;
    }
    const ios = typeof f.appName === 'object' ? f.appName : undefined;
    const name = (typeof f.appName === 'string' ? f.appName : ios?.appName) ?? '';
    const code = ios?.shortcode || name.toLowerCase().replace(/\s/g, '');
    if (code) ids.set(code, ios?.shortcode ?? '');
  }
  return UPI_APPS.flatMap((a) => {
    const seen = os === 'ios' ? a.ios.find((c) => ids.has(c)) : ids.has(a.android) ? a.android : undefined;
    return seen === undefined ? [] : [{ id: a.id, app: ids.get(seen) || a.ios[0] }];
  });
}

/** Custom UI's options for paying the picked UPI app straight away, or null for the sheet: not a UPI app, not on
 * this phone (or can't tell), or no email or phone (Razorpay needs both outside the sheet; the sheet asks). */
export function directOf(
  p: PayWith | undefined,
  onPhone: readonly OnPhone[] | null,
  o: { key: string; order_id: string; amount: number; description?: string; email?: string; contact?: string },
): Record<string, unknown> | null {
  const app = p?.kind === 'upiApp' ? onPhone?.find((a) => a.id === p.id) : undefined;
  if (!app || !o.email || !o.contact) return null;
  return {
    key_id: o.key,
    order_id: o.order_id,
    // Razorpay's sample sends paise as a string; the Android bridge turns numbers into doubles.
    amount: String(o.amount),
    currency: 'INR',
    description: o.description,
    email: o.email,
    contact: o.contact,
    method: 'upi',
    '_[flow]': 'intent',
    upi_app_package_name: app.app,
  };
}

/** Whether Custom UI's error is the payer's answer (they went to the UPI app, or cancelled), so the sheet must not
 * open too (it could charge twice). Anything else failed before an app opened: the sheet pays instead. */
export function directFinal(err: unknown, left: boolean, os: string): boolean {
  const d = (err as { description?: unknown } | null)?.description;
  const text = typeof d === 'string' ? d : '';
  // Android: Custom UI's own screen backgrounds the app before any UPI app opens, so only its pre-submit errors retry.
  if (os !== 'ios') return !/^(Payment options not found|API key|Invalid payment options format|Failed to submit|Unable to start the payment)/.test(text);
  return left || /User Cancelled Payment|back button/i.test(text);
}
