// A host's money as Launch shows it (Money flow: Sales, The buyer fee and the commission, Bank account and payouts),
// worked out on the server once the money API lands; these stand in until then. Amounts in whole paise, days in India
// time. Events' rules came from the Orbit app's Console (git 58351ce^1: app/src/console/money.ts); the commission is
// the Money flow's two-part model, on the fee plans of 25 Nov 2026 (src/money.ts).

// Rupees and the fee plans are the host apps' shared rules (src/money.ts).
export { rupees } from '../money.ts';

const IST = 19_800_000; // +05:30, all year
const DAY = 86_400_000;

export type Sales = {
  eventId: string;
  endsAt: string; // the scheduled end; payouts open 3 days after it (Money decision 10)
  booked: number; // people with a ticket
  seats: number | null; // null = unlimited
  checkedIn: number;
  salesPaise: number; // what buyers paid for tickets, after coupons, before any fee
  commissionPaise: number; // Orbit's commission on these sales, less what refunds handed back
  feesPaise: number; // the plan's buyer fee, 3% or 5%
  feeBy: 'buyers' | 'host'; // buyers pay it on top, or the host includes it in its price (decision 19)
  refundedPaise: number;
  paidOutPaise: number;
  paidOn?: string; // the last payout's day, YYYY-MM-DD
  openRefundsPaise: number; // held back from Available while a request is open
  refundsWaiting: number;
};

// Your earnings: ticket sales, minus commission, minus any buyer fee the host included, minus refunded.
export const earnings = (s: Sales) => s.salesPaise - s.commissionPaise - (s.feeBy === 'host' ? s.feesPaise : 0) - s.refundedPaise;
// Available: your earnings, minus paid out, minus refunds still open.
// ponytail: leaves out disputes, what the host owes and a shortfall on its other events, which the server takes off too.
export const available = (s: Sales) => earnings(s) - s.paidOutPaise - s.openRefundsPaise;
// Payouts open 3 days after the scheduled end, so ending early doesn't bring it forward.
export const payoutOpens = (s: Sales) => Date.parse(s.endsAt) + 3 * DAY;
export const total = (all: readonly Sales[], f: (s: Sales) => number) => all.reduce((n, s) => n + f(s), 0);
// What a host can ask for now: Available on the events whose payout is open, never more than its Available across all
// events (a shortfall on one event comes off the others) and never below nothing.
export const readyNow = (all: readonly Sales[], now: number) =>
  Math.max(0, Math.min(total(all, (s) => (payoutOpens(s) <= now ? Math.max(0, available(s)) : 0)), total(all, available)));
// One event's Request: its Available, within what the host can ask for now.
export const requestable = (s: Sales, all: readonly Sales[], now: number) => (payoutOpens(s) <= now ? Math.max(0, Math.min(available(s), readyNow(all, now))) : 0);

// The host decides refund requests until 24 hours before the start (Money flow); after that a request is Orbit's, and
// the card says "With Orbit".
// ponytail: every event takes the default, and a request unanswered for 3 days (also Orbit's) isn't counted; both come
// with the refund endpoints.
export const hostDecidesRefunds = (startsAt: string, now: number, hoursBefore = 24) => now < Date.parse(startsAt) - hoursBefore * 3_600_000;

// A day, YYYY-MM-DD in India time, as "Mon 18 Jan".
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
// A moment's day in India time, YYYY-MM-DD.
export const istDate = (t: number) => new Date(t + IST).toISOString().slice(0, 10);
// A moment as "Mon 23 Nov, 11 PM" in India time (minutes only when there are some).
export function momentLabel(t: number) {
  const at = new Date(t + IST);
  const h = at.getUTCHours();
  const m = at.getUTCMinutes();
  return `${dayLabel(istDate(t))}, ${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
