// A venue's money in Orbit Station (Money flow: the buyer fee and the commission, the seven numbers, payouts and the
// bank account; Play: slot prices, payouts at most once a week), pure so money.test.ts runs it on Node.
// - A slot's price: each 30-minute step at half the hourly price in force then, off-peak where it falls, per station.
// - Two parts on every paid booking: a 4% buyer fee with no cap, on top of the price (or carved out of it, 4/104, where
//   staff set the host to include it), and the venue's commission out of its sales: 0% for its first 3 months, half
//   its rate for the next 3, then its rate (5% to 7%). Months turn on the onboarding day of the month, or the month's
//   last day when it's shorter. Amounts round half up to the paisa.
// - A player's own cancel gives the price back from the venue's share and hands the commission back; the fee stays.
// - The seven numbers: ticket sales, commission, buyer fee you included, refunded, your earnings, paid out, available.
// - A booking's money can be asked for 3 days after it ends; a venue asks at most once a week. Cash walk-ins stay off.
// ponytail: worked from the booking's start where the doc takes the sale's own time and seat; the server does it
// exactly, with the rates frozen per booking, once the money API lands.
import { type Claim, HOUR, indiaMidnight, MIN, type StationType } from './day.ts';

const IST = 330 * MIN;
const DAY = 24 * HOUR;
export const FEE = 0.04;
export const WAIT = 3 * DAY; // after a booking's end, before its money can be asked for
export const WEEK = 7 * DAY; // between a venue's payout asks

export type Terms = { onboarded: number; rate: number; feeIncluded: boolean }; // rate 0.05 to 0.07
export type Payout = { id: string; asked: number; paise: number; status: 'requested' | 'paid' | 'cancelled'; paid?: number; utr?: string; why?: string };
export type Bank = { bank: string; last4: string; holder: string; state: 'checking' | 'verified' | 'rejected'; until?: number } | null;

/** Midnight in India, `k` calendar months after `start`'s day: the same day of the month, or the month's last. */
function monthsAfter(start: number, k: number): number {
  const d = new Date(start + IST);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + k;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last)) - IST;
}
/** Which of its months a venue is in at `at`: 1 from its onboarding day. */
export function monthOf(onboarded: number, at: number): number {
  let k = 0;
  while (monthsAfter(onboarded, k + 1) <= at) k += 1;
  return k + 1;
}
/** The commission rate in force at `at`: 0 for 3 months, half for 3, then the venue's rate. */
export function rateAt(t: Terms, at: number): number {
  const m = monthOf(t.onboarded, at);
  return m <= 3 ? 0 : m <= 6 ? t.rate / 2 : t.rate;
}
/** When the intro's next step comes: month 4 (half) and month 7 (the full rate); none after. */
export function nextStep(t: Terms, at: number): { at: number; rate: number } | null {
  const m = monthOf(t.onboarded, at);
  return m <= 3 ? { at: monthsAfter(t.onboarded, 3), rate: t.rate / 2 } : m <= 6 ? { at: monthsAfter(t.onboarded, 6), rate: t.rate } : null;
}

function offPeakAt(t: StationType, at: number): boolean {
  if (!t.offPeak) return false;
  const d = new Date(at + IST);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const weekday = d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
  return hour >= t.offPeak.from && hour < t.offPeak.to && (!t.offPeak.weekdays || weekday);
}
/**
 * What a booking cost: each 30-minute step at half its hourly price in force, for each station.
 * ponytail: no co-op price yet (the people app has the PS5's for two); add it with the slots API's booking shape.
 */
export function priceOf(t: StationType, c: Claim): number {
  let paise = 0;
  for (let at = c.start; at < c.end; at += 30 * MIN) paise += ((offPeakAt(t, at) ? t.offPeak!.price : t.price) / 2) * c.count;
  return Math.round(paise);
}

/**
 * One booking's money: its price, the buyer fee (on top, or included), and the commission at the rate then, on what's
 * left after an included fee (Money decision 19: ₹299 → fee ₹11.50, commission on ₹287.50). A refunded booking hands
 * its commission back and the player gets the whole price; an included fee stays the venue's cost (decision 13).
 */
export function split(t: StationType, c: Claim, terms: Terms) {
  const price = priceOf(t, c);
  const fee = Math.round(terms.feeIncluded ? (price * 4) / 104 : price * FEE);
  const commission = Math.round((terms.feeIncluded ? price - fee : price) * rateAt(terms, c.start));
  const refunded = c.refunded ? price : 0;
  return {
    price,
    buyerPays: terms.feeIncluded ? price : price + fee,
    included: terms.feeIncluded ? fee : 0, // stays out of the venue's earnings even when the price goes back
    commission: c.refunded ? 0 : commission, // a refund hands the commission back
    refunded,
    earnings: price - (c.refunded ? 0 : commission) - (terms.feeIncluded ? fee : 0) - refunded,
  };
}

export type Sold = { t: StationType; c: Claim };
/** The first five numbers over bookings: ticket sales, commission, buyer fee you included, refunded, your earnings. */
export function numbers(sold: readonly Sold[], terms: Terms) {
  const n = { bookings: 0, sales: 0, commission: 0, included: 0, refunded: 0, earnings: 0 };
  for (const { t, c } of sold) {
    if (c.kind !== 'booking') continue; // cash walk-ins and blocks stay off Orbit
    const s = split(t, c, terms);
    n.bookings += 1;
    n.sales += s.price;
    n.commission += s.commission;
    n.included += s.included;
    n.refunded += s.refunded;
    n.earnings += s.earnings;
  }
  return n;
}

/**
 * What can be asked for now (available: earnings from bookings that ended 3 or more days ago, less paid out and less
 * what's asked for and not yet paid), what's still waiting its 3 days and when the last of it opens, and when the venue
 * may ask next: from the start of the day a week after its last ask. An ask still waiting to be paid blocks nothing more.
 */
export function balance(sold: readonly Sold[], terms: Terms, payouts: readonly Payout[], now: number) {
  let ready = 0;
  let waiting = 0;
  let opensBy = 0;
  for (const x of sold) {
    if (x.c.kind !== 'booking' || x.c.end > now) continue;
    const e = split(x.t, x.c, terms).earnings;
    if (x.c.end + WAIT <= now) ready += e;
    else {
      waiting += e;
      opensBy = Math.max(opensBy, x.c.end + WAIT);
    }
  }
  const sum = (s: Payout['status']) => payouts.filter((p) => p.status === s).reduce((a, p) => a + p.paise, 0);
  const paidOut = sum('paid');
  const asked = sum('requested');
  const last = Math.max(0, ...payouts.filter((p) => p.status !== 'cancelled').map((p) => p.asked));
  return { available: Math.max(ready - paidOut - asked, 0), waiting, opensBy, paidOut, asked, nextAsk: last ? indiaMidnight(last + WEEK) : now };
}

// "₹0", "₹11,063" or "₹49.50": paise only when there are some, and nothing is ever "Free" here.
// ponytail: Launch has the same in src/launch/money.ts; one host money module when Launch's Money take comes.
const inr = (fraction: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: fraction, minimumFractionDigits: fraction });
const whole = inr(0);
const withPaise = inr(2);
export const rupees = (paise: number) => (paise % 100 ? withPaise : whole).format(paise / 100);
/** "6.5%", "3.25%". */
export const percent = (rate: number) => `${+(rate * 100).toFixed(2)}%`;

// The bank's name from the IFSC's first four letters; others read "Your bank" until the API looks IFSCs up.
const BANKS: Record<string, string> = {
  HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', SBIN: 'State Bank of India', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank',
  YESB: 'Yes Bank', IDIB: 'Indian Bank', PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda', CNRB: 'Canara Bank',
};
export type BankForm = { holder?: string; account?: string; ifsc?: string; upi?: string };
/**
 * The account from Add or Replace (Money flow): the holder's name, an account number of 9 to 18 digits and an IFSC, or
 * a UPI ID, never both. It starts Checking for 72 hours (staff check it by hand; no penny drop). Otherwise, why not.
 */
export function bankFrom(f: BankForm, venueName: string, now: number): { bank: Bank & object } | { why: string } {
  const holder = (f.holder ?? '').trim();
  const account = (f.account ?? '').replace(/\s/g, '');
  const ifsc = (f.ifsc ?? '').toUpperCase().replace(/\s/g, '');
  const upi = (f.upi ?? '').trim();
  const until = now + 72 * HOUR;
  if ((account || ifsc) && upi) return { why: 'Add the account or a UPI ID, not both.' };
  if (upi) {
    const [name, handle] = upi.split('@');
    return /^[\w.-]{2,}@[a-z0-9]{2,}$/i.test(upi)
      ? { bank: { bank: `UPI · ${handle}`, last4: name.slice(-4), holder: holder || venueName, state: 'checking', until } }
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
