// A venue's money in Orbit Station (Money flow: the buyer fee and the commission, the seven numbers, payouts and the
// bank account; Play: slot prices, payouts at most once a week), pure so money.test.ts runs it on Node.
// - A slot's price: each 30-minute step at half the hourly price in force then, off-peak where it falls, per station.
// - Two parts on every paid booking (src/money.ts): the 4% buyer fee, on top or included, and the venue's commission,
//   0% for 3 months, half for 3, then its rate.
// - A player's own cancel gives the price back from the venue's share and hands the commission back; the fee stays.
// - The seven numbers: ticket sales, commission, buyer fee you included, refunded, your earnings, paid out, available.
// - A booking's money can be asked for 3 days after it ends; a venue asks at most once a week. Cash walk-ins stay off.
// The rules both host apps share (rupees, the intro months, the two-part split, the bank form) are in src/money.ts.
// ponytail: worked from the booking's start where the doc takes the sale's own time and seat; the server does it
// exactly, with the rates frozen per booking, once the money API lands.
import { introRate, monthOf, monthsAfter, twoPart } from '../money.ts';
import { type Claim, HOUR, indiaMidnight, MIN, type StationType } from './day.ts';

const IST = 330 * MIN;
const DAY = 24 * HOUR;
export const WAIT = 3 * DAY; // after a booking's end, before its money can be asked for
export const WEEK = 7 * DAY; // between a venue's payout asks

export type Terms = { onboarded: number; rate: number; feeIncluded: boolean }; // rate 0.05 to 0.07
export type Payout = { id: string; asked: number; paise: number; status: 'requested' | 'paid' | 'cancelled'; paid?: number; utr?: string; why?: string };

/** The commission rate in force at `at`: 0 for 3 months, half for 3, then the venue's rate. */
export const rateAt = (t: Terms, at: number) => introRate(t.rate, monthOf(t.onboarded, at));
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
  return { price, ...twoPart(price, rateAt(terms, c.start), terms.feeIncluded, !!c.refunded) };
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
