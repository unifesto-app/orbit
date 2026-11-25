import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bankFrom, paiseFrom, percent, rupees, twoPart } from './money.ts';

const HOUR = 3_600_000;
const IST = 330 * 60_000;
const india = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) - IST;

test("the owner's ₹1,200: 3% + 2% → buyer ₹1,236, host ₹1,176; 5% + 0% → buyer ₹1,260, host ₹1,200; Orbit ₹60 either way", () => {
  const a = twoPart(120000, '3+2', false);
  const b = twoPart(120000, '5+0', false);
  assert.deepEqual(a, { buyerPays: 123600, fee: 3600, included: 0, commission: 2400, refunded: 0, earnings: 117600 });
  assert.deepEqual(b, { buyerPays: 126000, fee: 6000, included: 0, commission: 0, refunded: 0, earnings: 120000 });
  assert.deepEqual([a.fee + a.commission, b.fee + b.commission], [6000, 6000]);
});

test("an included fee: carved out of the price (× b ÷ (1 + b)), commission on what's left, and a refund still costs the fee", () => {
  assert.deepEqual(twoPart(120000, '3+2', true), { buyerPays: 120000, fee: 3495, included: 3495, commission: 2330, refunded: 0, earnings: 114175 }); // 2% of ₹1,165.05
  assert.deepEqual(twoPart(120000, '5+0', true), { buyerPays: 120000, fee: 5714, included: 5714, commission: 0, refunded: 0, earnings: 114286 });
  assert.deepEqual(twoPart(120000, '3+2', true, true), { buyerPays: 120000, fee: 3495, included: 3495, commission: 0, refunded: 120000, earnings: -3495 });
  assert.equal(twoPart(120000, '3+2', false, true).earnings, 0); // with the fee on top, the buyer bore it
});

test('amounts round half up to the paisa', () => {
  assert.equal(twoPart(125, '3+2', false).commission, 3); // 2.5 paise
  assert.equal(twoPart(50, '3+2', false).fee, 2); // 1.5 paise
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
