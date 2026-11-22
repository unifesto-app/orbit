import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bankFrom, introRate, monthOf, monthsAfter, paiseFrom, percent, rupees, twoPart } from './money.ts';

const HOUR = 3_600_000;
const IST = 330 * 60_000;
const india = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) - IST;

test("the Money doc's ₹299: ₹310.96 with the fee on top; commission ₹10.47 at 3.5%, ₹20.93 at 7%", () => {
  assert.deepEqual([twoPart(29900, 0, false).buyerPays, twoPart(29900, 0.035, false).commission, twoPart(29900, 0.07, false).commission], [31096, 1047, 2093]);
  assert.equal(twoPart(29900, 0.07, false).earnings, 27807);
  assert.deepEqual([twoPart(29900, 0.07, false).fee, twoPart(29900, 0.07, false).included], [1196, 0]); // on top: none of it the host's
});

test("an included fee: ₹11.50 carved out of ₹299, commission on the ₹287.50 left, and a refund still costs the fee", () => {
  assert.deepEqual(twoPart(29900, 0, true), { buyerPays: 29900, fee: 1150, included: 1150, commission: 0, refunded: 0, earnings: 28750 });
  assert.equal(twoPart(29900, 0.07, true).commission, 2013); // ₹20.125 rounds half up
  assert.deepEqual(twoPart(29900, 0.07, true, true), { buyerPays: 29900, fee: 1150, included: 1150, commission: 0, refunded: 29900, earnings: -1150 });
  assert.equal(twoPart(29900, 0.07, false, true).earnings, 0); // with the fee on top, the buyer bore it
});

test('the intro: nothing for 3 months, half for 3, then the rate, in whatever unit the rate is', () => {
  assert.deepEqual([1, 3, 4, 6, 7, 20].map((m) => introRate(0.065, m)), [0, 0, 0.0325, 0.0325, 0.065, 0.065]);
  assert.equal(introRate(7, 5), 3.5);
  assert.equal(monthsAfter(india(2027, 1, 31), 1), india(2027, 2, 28)); // February has no 31st
  assert.equal(monthsAfter(india(2027, 1, 31), 13), india(2028, 2, 29)); // a leap February, a year on
  assert.equal(monthsAfter(india(2026, 11, 22, 23, 30), 2), india(2027, 1, 22)); // from late evening: still that day
});

test('a bank account needs a name, 9 to 18 digits and an IFSC, or a UPI ID; it starts Checking for 72 hours', () => {
  const now = india(2026, 11, 22, 18, 20);
  const bank = (f: Parameters<typeof bankFrom>[0]) => {
    const r = bankFrom(f, 'Smash Court', now);
    return 'bank' in r ? r.bank : r.why;
  };
  assert.deepEqual(bank({ holder: 'Smash Court', account: '5010 0223 3445 56', ifsc: 'hdfc0001234' }), { bank: 'HDFC Bank', last4: '4556', holder: 'Smash Court', state: 'checking', until: now + 72 * HOUR });
  assert.equal(typeof bank({ holder: 'S', account: '50100223344556', ifsc: 'HDFC0001234' }), 'string'); // no real name
  assert.equal(typeof bank({ holder: 'Smash Court', account: '12345678', ifsc: 'HDFC0001234' }), 'string'); // 8 digits
  assert.equal(typeof bank({ holder: 'Smash Court', account: '123456789012345678', ifsc: 'HDFC0001234' }), 'object'); // 18
  assert.equal(typeof bank({ holder: 'Smash Court', account: '1234567890123456789', ifsc: 'HDFC0001234' }), 'string'); // 19
  assert.equal(typeof bank({ holder: 'Smash Court', account: '50100223344556', ifsc: 'HDFC1001234' }), 'string'); // 5th isn't 0
  assert.deepEqual(bank({ upi: 'smashcourt@okhdfcbank' }), { bank: 'UPI · okhdfcbank', last4: 'ourt', holder: 'Smash Court', state: 'checking', until: now + 72 * HOUR });
  assert.equal((bank({ upi: 'venue@s2b' }) as { bank: string }).bank, 'UPI · s2b'); // handles with digits
  assert.equal(bank({ upi: 'smashcourt' }), 'A UPI ID reads like name@bank.');
  assert.equal(bank({ holder: 'Smash Court', ifsc: 'HDFX0001234', upi: 'smash@okhdfc' }), 'Add the account or a UPI ID, not both.');
});


test('money reads ₹0, ₹11,063 or ₹49.50; rates read 6.5% or 3.25%', () => {
  assert.deepEqual([rupees(0), rupees(1106300), rupees(4950)], ['₹0', '₹11,063', '₹49.50']);
  assert.deepEqual([percent(0.065), percent(0.0325), percent(0.06)], ['6.5%', '3.25%', '6%']);
});


test('rupees typed for a payout: commas and spaces go, at most 2 places, anything else is nothing', () => {
  assert.deepEqual(['1,000.50', '1,00,050', ' 25 ', '25.5', '1000,50', '1.000,50', '10.999', '', 'abc'].map(paiseFrom), [100050, 10005000, 2500, 2550, undefined, undefined, undefined, undefined, undefined]);
});


test('months turn across a year end, a leap February, and from an onboarding in the evening', () => {
  assert.equal(monthOf(india(2026, 11, 30), india(2027, 2, 28)), 4); // 30 Nov: 30 Dec, 30 Jan, then Feb's last
  assert.equal(monthOf(india(2027, 8, 31), india(2028, 2, 29)), 7); // leap year: 29 Feb
  assert.equal(monthOf(india(2027, 8, 31), india(2028, 2, 28, 23, 59)), 6);
  assert.equal(monthOf(india(2026, 11, 22, 23), india(2026, 12, 22)), 2); // turns at 00:00, whatever the hour onboarded
});


test("Launch's days must be real YYYY-MM-DD days: no rolling 30 February into March", async () => {
  const { addMonths, commission } = await import('./launch/money.ts');
  assert.equal(addMonths('2026-10-18', 3), '2027-01-18');
  for (const bad of ['2026-02-30', '2026-04-31', '2026-10-00', '2026-10-18T00:00:00+05:30', '']) assert.throws(() => addMonths(bad, 1), /Not a day/);
  assert.throws(() => commission('2026-02-30', 7, Date.now()), /Not a day/);
});
