import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Sales, available, earnings, hostDecidesRefunds, payoutOpens, rupees } from './money.ts';

test('the host decides refunds until 24 hours before the start, then Orbit does', () => {
  const start = '2026-11-20T20:00:00+05:30';
  assert.equal(hostDecidesRefunds(start, Date.parse('2026-11-19T19:59:00+05:30')), true);
  assert.equal(hostDecidesRefunds(start, Date.parse('2026-11-19T20:00:00+05:30')), false);
  assert.equal(hostDecidesRefunds(start, Date.parse('2026-11-20T09:00:00+05:30')), false);
});

const s = (over: Partial<Sales> = {}): Sales => ({
  eventId: 'e',
  endsAt: '2026-11-13T23:00:00+05:30',
  booked: 10,
  seats: 10,
  checkedIn: 0,
  salesPaise: 299000,
  feesPaise: 16450,
  feeBy: 'buyers',
  refundedPaise: 0,
  paidOutPaise: 0,
  openRefundsPaise: 0,
  refundsWaiting: 0,
  ...over,
});

test('earnings: a fee the buyers paid stays out; one the host paid and refunds come off', () => {
  assert.equal(earnings(s()), 299000);
  assert.equal(earnings(s({ feeBy: 'host' })), 299000 - 16450);
  assert.equal(earnings(s({ refundedPaise: 29900 })), 299000 - 29900);
});

test('available holds back what is paid out and refunds still open', () => {
  assert.equal(available(s({ paidOutPaise: 100000, openRefundsPaise: 29900 })), 299000 - 100000 - 29900);
});

test('payouts open exactly 3 days after the scheduled end', () => {
  assert.equal(payoutOpens(s()), Date.parse('2026-11-16T23:00:00+05:30'));
});

test('a money figure of nothing reads ₹0, never Free', () => {
  assert.equal(rupees(0), '₹0');
  assert.equal(rupees(1106300), '₹11,063');
});

test('paise show only when there are some', () => {
  assert.equal(rupees(4950), '₹49.50');
});
