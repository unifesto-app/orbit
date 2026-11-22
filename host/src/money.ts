// The money rules both host apps share (Money flow, 17 Nov 2026): rupees as they're written, the commission's intro
// months, the two-part price, and the bank account and amount forms. Station builds a venue's numbers on these per
// booking (src/station/money.ts), Launch a host's per event (src/launch/money.ts). Pure, so money.test.ts runs on Node.
// - Two parts on every paid sale: a 4% buyer fee with no cap, on top of the price, or carved out of it (price × 4 ÷ 104)
//   where staff set the host to include it; and the host's commission out of its sales, on what's left after an
//   included fee (decision 19). A refund hands the commission back; an included fee stays the host's cost and the buyer
//   gets the whole price (decision 13). Amounts round half up to the paisa.
// - The commission: 0% for the first 3 months from onboarding, half the rate for the next 3, then the rate (5% to 7%).
//   A month turns at 00:00 India time on the onboarding day of the month, or the month's last day when it's shorter.
// - A bank account (holder, 9 to 18 digits and an IFSC, or a UPI ID) starts Checking for 72 hours; staff check it by
//   hand, with no penny drop.
// ponytail: the server works all of this out, with the rates frozen per sale, once the money API lands.

const MIN = 60_000;
const HOUR = 60 * MIN;
const IST = 330 * MIN; // +05:30, all year
export const FEE = 0.04;

// "₹0", "₹11,063" or "₹49.50": paise only when there are some, and nothing is ever "Free" here.
// ponytail: @orbit/contract's formatPrice says "Free" for 0; use it once the host apps read the API's shapes.
const inr = (fraction: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: fraction, minimumFractionDigits: fraction });
const whole = inr(0);
const withPaise = inr(2);
export const rupees = (paise: number) => (paise % 100 ? withPaise : whole).format(paise / 100);
/** A rate as a share, read as a percent: 0.065 → "6.5%", 0.0325 → "3.25%". */
export const percent = (rate: number) => `${+(rate * 100).toFixed(2)}%`;

/** Midnight in India, `k` calendar months after `start`'s day: the same day of the month, or the month's last. */
export function monthsAfter(start: number, k: number): number {
  const d = new Date(start + IST);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + k;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last)) - IST;
}
/** Which of its months a host is in at `at`: 1 from its onboarding day (and before it). */
export function monthOf(onboarded: number, at: number): number {
  let k = 0;
  while (monthsAfter(onboarded, k + 1) <= at) k += 1;
  return k + 1;
}
/** The commission in a host's `month`: nothing for 3 months, half its `rate` for 3, then its rate, in the rate's own unit
 * (Station passes a share, 0.07; Launch a percent, 7). */
export const introRate = (rate: number, month: number) => (month <= 3 ? 0 : month <= 6 ? rate / 2 : rate);

/**
 * One sale's two parts at commission `rate`, a share (0.07, never a percent like 7): what the buyer pays, the fee the host included (else 0),
 * the commission (on what's left after an included fee), what went back on a refund, and the host's earnings.
 */
export function twoPart(price: number, rate: number, feeIncluded: boolean, refunded = false) {
  const fee = Math.round(feeIncluded ? (price * 4) / 104 : price * FEE);
  const commission = refunded ? 0 : Math.round((feeIncluded ? price - fee : price) * rate);
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
