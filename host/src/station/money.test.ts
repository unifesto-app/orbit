import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Claim, HOUR, MIN, type StationType } from './day.ts';
import { balance, numbers, type Payout, priceOf, split, type Terms } from './money.ts';

const IST = 330 * MIN;
const india = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) - IST;
const ticket: StationType = { id: 'x', name: 'Ticket', count: 1, unit: ['seat', 'seats'], step: 60, whole: true, price: 29900 };
const hour = (start: number, over: Partial<Claim> = {}): Claim => ({ id: 'b', type: 'x', kind: 'booking', count: 1, start, end: start + HOUR, ...over });


test("the owner's ₹1,200 hour on each plan, from day one: 3% + 2% → ₹1,236 and ₹1,176; 5% + 0% → ₹1,260 and ₹1,200", () => {
  const court: StationType = { ...ticket, price: 120000 };
  const at = (plan: Terms['plan']) => split(court, hour(india(2026, 11, 20, 18)), { plan, feeIncluded: false });
  assert.deepEqual([at('3+2').buyerPays, at('3+2').commission, at('3+2').earnings], [123600, 2400, 117600]);
  assert.deepEqual([at('5+0').buyerPays, at('5+0').commission, at('5+0').earnings], [126000, 0, 120000]);
});


test('a fee the venue includes is carved out of the price: ₹8.71 on ₹299 at 3%, ₹14.24 at 5%', () => {
  const s = split(ticket, hour(india(2026, 1, 20, 18)), { plan: '3+2', feeIncluded: true });
  assert.deepEqual([s.buyerPays, s.included, s.commission, s.earnings], [29900, 871, 581, 28448]); // 2% of ₹290.29
  assert.equal(split(ticket, hour(india(2026, 1, 20, 18)), { plan: '5+0', feeIncluded: true }).included, 1424);
});


test('a slot is priced by the half hour, off-peak where it falls, per station', () => {
  const pc: StationType = { id: 'pc', name: 'Gaming PC', count: 12, unit: ['PC', 'PCs'], step: 30, whole: false, price: 16200, offPeak: { from: 11, to: 16, weekdays: true, price: 12000 } };
  const fri = india(2026, 11, 20); // a Friday
  assert.equal(priceOf(pc, { ...hour(fri + 15.5 * HOUR), type: 'pc', count: 2 }), (6000 + 8100) * 2); // 3:30 to 4:30 PM, half off-peak
  assert.equal(priceOf(pc, { ...hour(india(2026, 11, 22, 15)), type: 'pc' }), 16200); // Sunday: weekdays only
});


test('the seven numbers: a refund gives the price and the commission back, an included fee stays out; commission is on what is left', () => {
  const terms: Terms = { plan: '3+2', feeIncluded: true };
  const day = india(2026, 9, 20, 18);
  const sold = [{ t: ticket, c: hour(day) }, { t: ticket, c: hour(day, { refunded: true }) }, { t: ticket, c: hour(day, { kind: 'walkin' }) }];
  assert.deepEqual(numbers(sold, terms), { bookings: 2, sales: 59800, commission: 581, included: 1742, refunded: 29900, earnings: 59800 - 581 - 1742 - 29900 });
});


test('available: ended 3 days ago, less paid out and less asked for; a week between asks', () => {
  const terms: Terms = { plan: '5+0', feeIncluded: false }; // no commission: each booking earns its ₹299
  const now = india(2026, 11, 22, 18, 20);
  const sold = [
    { t: ticket, c: hour(india(2026, 11, 15, 18)) }, // 7 days ago: ready
    { t: ticket, c: hour(india(2026, 11, 19, 16)) }, // ended 5 PM on the 19th: ready at 5 PM today
    { t: ticket, c: hour(india(2026, 11, 21, 18)) }, // yesterday: opens at 7 PM on the 24th
    { t: ticket, c: hour(india(2026, 11, 22, 20)) }, // tonight: not played yet
  ];
  const paid: Payout[] = [{ id: 'p', asked: india(2026, 11, 17, 11), paise: 29900, status: 'paid', paid: india(2026, 11, 18, 12), utr: 'HDFC00001' }];
  assert.deepEqual(balance(sold, terms, paid, now), { available: 29900, waiting: 29900, opensBy: india(2026, 11, 24, 19), paidOut: 29900, asked: 0, nextAsk: india(2026, 11, 24) });
  const asked: Payout[] = [...paid, { id: 'q', asked: india(2026, 11, 21, 10), paise: 29900, status: 'requested' }];
  assert.equal(balance(sold, terms, asked, now).available, 0);
  assert.equal(balance(sold, terms, asked, now).nextAsk, india(2026, 11, 28)); // from the start of the day a week on
  // A partial ask leaves the rest available; a cancelled one gives its money back and doesn't count as an ask.
  const part: Payout[] = [...paid, { id: 'q', asked: india(2026, 11, 21, 10), paise: 10000, status: 'requested' }];
  assert.equal(balance(sold, terms, part, now).available, 19900);
  const off: Payout[] = [...paid, { id: 'q', asked: india(2026, 11, 21, 10), paise: 29900, status: 'cancelled', why: 'Wrong amount' }];
  assert.deepEqual([balance(sold, terms, off, now).available, balance(sold, terms, off, now).nextAsk], [29900, india(2026, 11, 24)]);
  // An ask still waiting after a week doesn't stop the next one.
  assert.ok(balance(sold, terms, asked, india(2026, 11, 29, 9)).nextAsk <= india(2026, 11, 29, 9));
});


test("the mock venues' money adds up: payouts never exceed what was ready", async () => {
  const { mockDay, mockMoney, venues } = await import('./fixtures.ts');
  const now = Date.UTC(2026, 10, 22, 18, 20) - IST;
  for (const v of venues) {
    const money = mockMoney(v, now, mockDay(v, now));
    const sold = money.days.flatMap((d) => d.sold);
    const b = balance(sold, money.terms, money.payouts, now);
    const ready = sold.filter((x) => x.c.end + 3 * 24 * HOUR <= now).reduce((a, x) => a + split(x.t, x.c, money.terms).earnings, 0);
    assert.ok(b.paidOut + b.asked <= ready, v.id);
    assert.ok(money.days.length > 0 && money.days.every((d) => d.day >= money.onboarded - 24 * HOUR), v.id);
  }
});


test('a refund with the fee on top leaves the venue at nothing; the player bore the fee', () => {
  const s = split(ticket, hour(india(2026, 9, 20, 18), { refunded: true }), { plan: '3+2', feeIncluded: false });
  assert.deepEqual([s.refunded, s.commission, s.earnings], [29900, 0, 0]);
});


test('off-peak ends at 4 PM sharp, and a café past midnight is priced by the hour it is', () => {
  const pc: StationType = { id: 'pc', name: 'Gaming PC', count: 12, unit: ['PC', 'PCs'], step: 30, whole: false, price: 16201, offPeak: { from: 11, to: 16, weekdays: true, price: 12000 } };
  const fri = india(2026, 11, 20);
  assert.equal(priceOf(pc, { ...hour(fri + 16 * HOUR), type: 'pc' }), 16201); // 4 PM: peak, an odd price
  assert.equal(priceOf(pc, { ...hour(fri + 25 * HOUR), type: 'pc' }), 16201); // 1 AM Saturday
});


test("an included fee: commission on what's left after it, and a cancel still costs the venue the fee (decisions 19, 13)", () => {
  const terms: Terms = { plan: '3+2', feeIncluded: true };
  const kept = split(ticket, hour(india(2026, 9, 20, 18)), terms); // 2% on ₹290.29 = ₹5.8058, to the paisa ₹5.81
  assert.deepEqual([kept.included, kept.commission, kept.earnings], [871, 581, 29900 - 871 - 581]);
  const back = split(ticket, hour(india(2026, 9, 20, 18), { refunded: true }), terms); // the player gets ₹299 back
  assert.deepEqual([back.refunded, back.commission, back.earnings], [29900, 0, -871]);
});
