// One event's money as Console shows it (Money flow, Sales), worked out once on the server; these stand in until then.
// Amounts in whole paise.
import { formatPrice } from '@orbit/contract';

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
// A money figure: "₹0" where formatPrice, made for ticket prices, says "Free".
export const rupees = (paise: number) => (paise === 0 ? '₹0' : formatPrice(paise));
