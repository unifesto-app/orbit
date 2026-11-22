import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HOUR, type StationType } from './day.ts';
import { contactOk, daysLeft, hoursOk, inTheWay, kindFrom, type KindForm, plural, priceLine, span } from './venue.ts';

const pc: StationType = { id: 'pc', name: 'Gaming PC', count: 12, unit: ['PC', 'PCs'], step: 30, whole: false, price: 16200, offPeak: { from: 11, to: 16, weekdays: true, price: 12000 }, coop: 35000, games: 'Valorant, CS2' };

test('a kind reads with its price, off-peak, co-op and games', () => {
  assert.equal(priceLine(pc), '₹162/hr · ₹120/hr 11 AM to 4 PM on weekdays · ₹350/hr for two · Valorant, CS2');
  assert.equal(priceLine({ ...pc, offPeak: undefined, coop: undefined, games: undefined, price: 50000 }), '₹500/hr');
});

test('hours read as Venue writes them, past midnight too', () => {
  assert.deepEqual([span([11, 26]), span([6, 24]), span([5, 23]), span(null)], ['11 AM to 2 AM', '6 AM to midnight', '5 AM to 11 PM', 'Closed']);
});

test('an invite has 14 days, counted down by whole days', () => {
  const sent = Date.UTC(2026, 10, 19, 12);
  assert.deepEqual([daysLeft(sent, sent), daysLeft(sent, sent + 3 * 24 * HOUR + HOUR), daysLeft(sent, sent + 20 * 24 * HOUR)], [14, 11, 0]);
});

test('an invite goes to a phone number or an email', () => {
  assert.deepEqual(['+91 90000 22010', '9000022010', 'ravi@example.com', '12345', 'ravi@', 'call me'].map(contactOk), [true, true, true, false, false, false]);
});

test('bookings in the way: the first three named, then how many more', () => {
  assert.equal(inTheWay(['a', 'b'], (x) => x), 'a; b');
  assert.equal(inTheWay(['a', 'b', 'c', 'd', 'e'], (x) => x), 'a; b; c, and 2 more');
});

test('more than one: pitches, boxes, PCs, bays', () => {
  assert.deepEqual(['pitch', 'box', 'PC', 'bay', 'court', 'bus'].map(plural), ['pitches', 'boxes', 'PCs', 'bays', 'courts', 'buses']);
});

test('a day opens before it closes, at most a day long, and may open at midnight', () => {
  assert.deepEqual([[0, 5], [0, 24], [11, 26], [6, 30]].map((o) => hoursOk(o as [number, number])), [true, true, true, true]);
  assert.deepEqual([[6, 5], [6, 6], [11, 36], [34, 58], [0, 25]].map((o) => hoursOk(o as [number, number])), [false, false, false, false, false]);
});

test("a kind from Venue's sheet: prices in rupees, off-peak cheaper and inside the opening, a new one's plural", () => {
  const form: KindForm = { name: 'Racing sim', unit: 'rig', count: 3, price: '300', coop: '', op: 'none', opFrom: 11, opTo: 16, opPrice: '', games: 'F1 24' };
  const made = kindFrom(form, undefined, [11, 26], true, 'k1');
  assert.ok('kind' in made && made.kind.unit[1] === 'rigs' && made.kind.step === 30 && !made.kind.whole && made.kind.price === 30000 && made.kind.games === 'F1 24');
  const pitch = kindFrom({ ...form, name: 'Futsal', unit: 'pitch', games: 'x' }, undefined, [6, 24], false, 'k2');
  assert.ok('kind' in pitch && pitch.kind.unit[1] === 'pitches' && pitch.kind.whole && pitch.kind.step === 60 && pitch.kind.games === undefined);
  const why = (f: Partial<KindForm>, open: [number, number] = [11, 26]) => {
    const r = kindFrom({ ...form, ...f }, undefined, open, true, 'k');
    return 'why' in r ? r.why : 'ok';
  };
  assert.equal(why({ unit: '' }), 'Say what one is called, like PC or pitch.');
  assert.equal(why({ price: '1000,50' }), 'Its price an hour, in rupees.');
  assert.equal(why({ op: 'weekdays', opPrice: '300' }), 'Off-peak is cheaper than the price an hour.');
  assert.equal(why({ op: 'weekdays', opPrice: '200', opFrom: 9, opTo: 16 }), 'Off-peak hours sit inside your opening, before midnight.'); // before opening
  assert.equal(why({ op: 'every', opPrice: '200', opFrom: 22, opTo: 26 }), 'Off-peak hours sit inside your opening, before midnight.'); // past midnight
  assert.equal(why({ op: 'every', opPrice: '200', opFrom: 22, opTo: 24 }), 'ok');
});
