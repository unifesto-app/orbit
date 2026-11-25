// The money rules both host apps share (Money flow; fees per the owner, 25 Nov 2026): rupees as they're written, the
// fee plans, the two-part price, and the bank account and amount forms. Station builds a venue's numbers on these per
// booking (src/station/money.ts), Launch a host's per event (src/launch/money.ts). Pure, so money.test.ts runs on Node.
// - Each host picks one of two fee plans, from day one with no intro months: 3% from the buyer + 2% commission from the
//   host, or 5% from the buyer + 0% from the host. With the fee on top Orbit keeps ₹60 on ₹1,200 either way; with it
//   included a little less (₹58.25 on 3+2, ₹57.14 on 5+0).
// - Two parts on every paid sale: the plan's buyer fee with no cap, on top of the price, or carved out of it
//   (price × b ÷ (1 + b)) where staff set the host to include it; and the plan's commission out of the host's sales, on
//   what's left after an included fee (decision 19). A refund hands the commission back; an included fee stays the
//   host's cost and the buyer gets the whole price (decision 13). Amounts round half up to the paisa.
// - A bank account (holder, 9 to 18 digits and an IFSC, or a UPI ID) starts Checking for 72 hours; staff check it by
//   hand, with no penny drop.
// ponytail: the server works all of this out, with the plan frozen per sale, once the money API lands.

const MIN = 60_000;
const HOUR = 60 * MIN;
/** The two fee plans as shares: what the buyer pays on top, and Orbit's commission from the host. */
export const PLANS = { '3+2': { buyer: 0.03, host: 0.02 }, '5+0': { buyer: 0.05, host: 0 } } as const;
export type Plan = keyof typeof PLANS;

// "₹0", "₹11,063" or "₹49.50": paise only when there are some, and nothing is ever "Free" here.
// ponytail: @orbit/contract's formatPrice says "Free" for 0; use it once the host apps read the API's shapes.
const inr = (fraction: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: fraction, minimumFractionDigits: fraction });
const whole = inr(0);
const withPaise = inr(2);
export const rupees = (paise: number) => (paise % 100 ? withPaise : whole).format(paise / 100);
/** A rate as a share, read as a percent: 0.065 → "6.5%", 0.0325 → "3.25%". */
export const percent = (rate: number) => `${+(rate * 100).toFixed(2)}%`;

/**
 * One sale's two parts on fee `plan`: what the buyer pays, the buyer fee, the part of it the host included (else 0), the
 * commission (on what's left after an included fee), what went back on a refund, and the host's earnings.
 */
export function twoPart(price: number, plan: Plan, feeIncluded: boolean, refunded = false) {
  const { buyer, host } = PLANS[plan];
  const fee = Math.round(feeIncluded ? (price * buyer) / (1 + buyer) : price * buyer);
  const commission = refunded ? 0 : Math.round((feeIncluded ? price - fee : price) * host);
  const included = feeIncluded ? fee : 0; // the host's cost even when the price goes back
  const back = refunded ? price : 0;
  return { buyerPays: feeIncluded ? price : price + fee, fee, included, commission, refunded: back, earnings: price - commission - included - back };
}

export type Bank = { bank: string; last4: string; holder: string; state: 'checking' | 'verified' | 'rejected'; until?: number } | null;
// The bank's name from the IFSC's first four letters; others read "Your bank" until the API looks IFSCs up.
const BANKS: Record<string, string> = {
  HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', SBIN: 'State Bank of India', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank',
  YESB: 'Yes Bank', IDIB: 'Indian Bank', PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda', CNRB: 'Canara Bank',
};
export type BankForm = { holder?: string; account?: string; ifsc?: string; upi?: string };
/**
 * The account from Add or Replace: the holder's name, an account number of 9 to 18 digits and an IFSC, or a UPI ID,
 * never both. It starts Checking for 72 hours. Otherwise, why not, in the words the sheet shows.
 */
export function bankFrom(f: BankForm, hostName: string, now: number): { bank: Bank & object } | { why: string } {
  const holder = (f.holder ?? '').trim();
  const account = (f.account ?? '').replace(/\s/g, '');
  const ifsc = (f.ifsc ?? '').toUpperCase().replace(/\s/g, '');
  const upi = (f.upi ?? '').trim();
  const until = now + 72 * HOUR;
  if ((account || ifsc) && upi) return { why: 'Add the account or a UPI ID, not both.' };
  if (upi) {
    const [name, handle] = upi.split('@');
    return /^[\w.-]{2,}@[a-z0-9]{2,}$/i.test(upi)
      ? { bank: { bank: `UPI · ${handle}`, last4: name.slice(-4), holder: holder || hostName, state: 'checking', until } }
      : { why: 'A UPI ID reads like name@bank.' };
  }
  if (holder.length > 1 && /^\d{9,18}$/.test(account) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))
    return { bank: { bank: BANKS[ifsc.slice(0, 4)] ?? 'Your bank', last4: account.slice(-4), holder, state: 'checking', until } };
  return { why: 'Add the holder’s name, an account number of 9 to 18 digits and an 11-character IFSC, or a UPI ID.' };
}

/** Rupees typed for a payout ("1,000.50") in paise, or undefined: digits with at most 2 after the point. */
export function paiseFrom(text: string): number | undefined {
  if (/,\d{1,2}$/.test(text.trim())) return undefined; // a decimal comma ("1000,50"): Indian grouping never ends so
  const t = text.replace(/[\s,]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : undefined;
}
