// One event's money as Events shows it (Money flow, Sales), worked out on the server once the money API lands; these
// stand in until then. Amounts in whole paise. Ported from the Orbit app's Console (git 58351ce^1:
// app/src/console/money.ts).

// @orbit/contract's formatPrice, without "Free": "₹0", "₹11,063" or "₹49.50".
// ponytail: copied while host/ has no @orbit/contract; use formatPrice once Launch reads the API's shapes.
const inr = (fraction: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: fraction, minimumFractionDigits: fraction });
const whole = inr(0);
const withPaise = inr(2);

export type Sales = {
  eventId: string;
  endsAt: string; // the scheduled end; payouts open 3 days after it (Money decision 10)
  booked: number; // people with a ticket
  seats: number | null; // null = unlimited
  checkedIn: number;
  salesPaise: number; // after coupons, before any fee
  feesPaise: number;
  feeBy: 'buyers' | 'host';
  refundedPaise: number;
  paidOutPaise: number;
  openRefundsPaise: number; // held back from Available while a request is open
  refundsWaiting: number;
};

// Ticket sales, less fees the host paid, less refunded.
export const earnings = (s: Sales) => s.salesPaise - (s.feeBy === 'host' ? s.feesPaise : 0) - s.refundedPaise;
// ponytail: leaves out a shortfall on the host's other events, which the server takes off too.
export const available = (s: Sales) => earnings(s) - s.paidOutPaise - s.openRefundsPaise;
export const payoutOpens = (s: Sales) => Date.parse(s.endsAt) + 3 * 86_400_000;
// The host decides refund requests until 24 hours before the start (Money flow); after that a request is Orbit's, and
// the card says "With Orbit".
// ponytail: every event takes the default, and a request unanswered for 3 days (also Orbit's) isn't counted; both come
// with the refund endpoints.
export const hostDecidesRefunds = (startsAt: string, now: number, hoursBefore = 24) => now < Date.parse(startsAt) - hoursBefore * 3_600_000;
export const rupees = (paise: number) => (paise % 100 ? withPaise : whole).format(paise / 100);
