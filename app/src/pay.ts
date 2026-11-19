// The ways to pay (owner, 19 Nov 2026: "bring the payment methods screen from unifesto but with orbit's ui"), from
// Unifesto's pay-method sheet (mobile/src/components/registration/Steps.tsx, PayMethodsSheet): UPI apps (the big three
// first, four showing and the rest under Show more), your UPI IDs (checked with Razorpay, then added), card, wallets and
// Apple Pay on iPhones; no netbanking (owner, 19 Nov 2026: "remove netbanking"). Every payment goes through Razorpay at
// checkout (Booking doc, Paying); Orbit keeps no card or bank detail, only which way you like to pay and the UPI IDs you
// added, on this phone (src/session.ts). Pure, so pay.test.ts runs it on Node.
// ponytail: fixed lists until the API reads our Razorpay account's own (Unifesto's /v1/methods, cached) and the phone's
// installed UPI apps (Razorpay's SDK finds them; that's a native module and a rebuild).

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
const RAZORPAY_KEY = process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? '';

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
