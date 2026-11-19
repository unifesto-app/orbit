// The ways to pay (owner, 19 Nov 2026: "bring the payment methods screen from unifesto but with orbit's ui"), from
// Unifesto's pay-method sheet (mobile/src/components/registration/Steps.tsx, PayMethodsSheet): UPI apps (the big three
// first, four showing and the rest under Show more), a typed UPI ID, card, wallets and netbanking, and Apple Pay on
// iPhones. Every payment goes through Razorpay at checkout (Booking doc, Paying); Orbit keeps no card or bank detail,
// only which way you like to pay, on this phone (src/session.ts). Pure, so pay.test.ts runs it on Node.
// ponytail: fixed lists until the API reads our Razorpay account's own (Unifesto's /v1/methods, cached) and the phone's
// installed UPI apps (Razorpay's SDK finds them; that's a native module and a rebuild).

export type PayWith =
  | { kind: 'upiApp'; id: string }
  | { kind: 'vpa'; vpa: string }
  | { kind: 'card' }
  | { kind: 'wallet'; code: string }
  | { kind: 'netbanking'; bank: string }
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

// Razorpay's bank codes, the biggest first.
export const BANKS = [
  { code: 'SBIN', name: 'State Bank of India' },
  { code: 'HDFC', name: 'HDFC Bank' },
  { code: 'ICIC', name: 'ICICI Bank' },
  { code: 'UTIB', name: 'Axis Bank' },
  { code: 'KKBK', name: 'Kotak Mahindra Bank' },
  { code: 'PUNB', name: 'Punjab National Bank' },
  { code: 'BARB', name: 'Bank of Baroda' },
  { code: 'UBIN', name: 'Union Bank of India' },
  { code: 'CNRB', name: 'Canara Bank' },
  { code: 'IDFB', name: 'IDFC FIRST Bank' },
  { code: 'INDB', name: 'IndusInd Bank' },
  { code: 'YESB', name: 'Yes Bank' },
] as const;

/** How many of a long list show before Show more (Unifesto shows four UPI apps). */
export const SHOWN = 4;

/** name@bank: a UPI ID worth sending to Razorpay, which checks it's real (Unifesto's isVpa). */
export const isVpa = (v: string) => /^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(v.trim());

/** One key per choice, to tell which row is picked; a typed UPI ID ticks its row whatever's typed. */
export function payKey(p: PayWith): string {
  switch (p.kind) {
    case 'upiApp':
      return `upi:${p.id}`;
    case 'wallet':
      return `wallet:${p.code}`;
    case 'netbanking':
      return `bank:${p.bank}`;
    default:
      return p.kind;
  }
}

/** A pick's name on its own, as the Pay with line shows it: "Google Pay", "ravi@ybl", "HDFC Bank". */
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
    case 'netbanking':
      return BANKS.find((b) => b.code === p.bank)?.name ?? 'Your bank';
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
