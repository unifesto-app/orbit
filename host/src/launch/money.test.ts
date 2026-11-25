import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  type Sales,
  available,
  dayLabel,
  earnings,
  hostDecidesRefunds,
  istDate,
  momentLabel,
  payoutOpens,
  readyNow,
  requestable,
  rupees,
} from './money.ts';

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
  commissionPaise: 0,
  feesPaise: 8970, // 3% on top of ten ₹299 tickets (3% + 2%)
  feeBy: 'buyers',
  refundedPaise: 0,
  paidOutPaise: 0,
  openRefundsPaise: 0,
  refundsWaiting: 0,
  ...over,
});

test('earnings: a fee the buyers paid stays out; commission, a fee the host included and refunds come off', () => {
  assert.equal(earnings(s()), 299000);
  assert.equal(earnings(s({ commissionPaise: 5980 })), 299000 - 5980);
  assert.equal(earnings(s({ feeBy: 'host', feesPaise: 8710 })), 299000 - 8710);
  assert.equal(earnings(s({ refundedPaise: 29900 })), 299000 - 29900);
});

test('ready now counts only events whose payout is open, and never below nothing', () => {
  const now = Date.parse('2026-11-20T18:40:00+05:30');
  const open = s(); // ended 13 Nov, open since 16 Nov
  const tonight = s({ endsAt: '2026-11-20T23:00:00+05:30' });
  const owing = s({ openRefundsPaise: 400000 }); // refunds bigger than its earnings
  assert.equal(readyNow([open, tonight, owing], now), 299000);
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

test('days read as "Mon 18 Jan"', () => {
  assert.equal(dayLabel('2027-01-18'), 'Mon 18 Jan');
  assert.equal(dayLabel('2026-11-23'), 'Mon 23 Nov');
});

// Ten ₹299 tickets on 3% + 2% with the fee included: ₹8.71 fee and ₹5.81 commission each, one refunded (its commission back).
test('earnings take off commission and an included fee together', () => {
  assert.equal(earnings(s({ commissionPaise: 5229, feeBy: 'host', feesPaise: 8710, refundedPaise: 29900 })), 299000 - 5229 - 8710 - 29900);
});

test('what can be asked for never passes the host’s Available, and a payout opens on the dot', () => {
  const opens = Date.parse('2026-11-16T23:00:00+05:30');
  const ready = s({ salesPaise: 299000 });
  const short = s({ salesPaise: 0, openRefundsPaise: 101000 }); // a refund bigger than its earnings
  assert.equal(readyNow([ready, short], opens), 198000);
  assert.equal(requestable(ready, [ready, short], opens), 198000);
  assert.equal(requestable(short, [ready, short], opens), 0);
  assert.equal(readyNow([ready], opens - 1), 0);
  assert.equal(readyNow([s({ salesPaise: 0, openRefundsPaise: 5000 })], opens), 0); // never below nothing
});

test('days turn at midnight India time, and moments read with their hour', () => {
  assert.equal(istDate(Date.parse('2026-12-31T18:29:59Z')), '2026-12-31');
  assert.equal(istDate(Date.parse('2026-12-31T18:30:00Z')), '2027-01-01');
  assert.equal(momentLabel(Date.parse('2026-11-23T23:00:00+05:30')), 'Mon 23 Nov, 11 PM');
  assert.equal(momentLabel(Date.parse('2026-11-24T00:30:00+05:30')), 'Tue 24 Nov, 12:30 AM');
});

