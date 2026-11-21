import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bookAction, eventStatus, HELD, indiaWhen, isNews, rowTag, seatsLine, type StatusEvent } from './status.ts';

const NOW = Date.parse('2026-11-20T09:00:00+05:30');
const base: StatusEvent = { startsAt: '2026-11-25T18:00:00+05:30', announced: '2026-11-01T10:00:00+05:30', pricePaise: 29900 };
// Bookings on, as after January: BOOKINGS_OPEN is passed, so flipping it changes no test but the held one.
const status = (e: StatusEvent, now: number) => eventStatus(e, now, true);
const label = (e: Partial<StatusEvent>, now = NOW) => status({ ...base, ...e }, now).label;

test('one status, the first that holds', () => {
  assert.equal(label({}), 'Booking open');
  assert.equal(label({ pricePaise: 0 }), 'Registration open');
  assert.equal(label({ announced: '2026-11-18T10:00:00+05:30' }), 'Just announced');
  assert.equal(label({ capacity: 100, left: 40 }), 'Filling fast'); // 60% booked
  assert.equal(label({ capacity: 100, left: 41 }), 'Booking open');
  assert.equal(label({ capacity: 60, left: 9 }), 'Almost full'); // 10 or fewer, three quarters booked
  assert.equal(label({ capacity: 20, left: 5 }), 'Almost full'); // exactly 75% booked
  assert.equal(label({ capacity: 20, left: 6 }), 'Filling fast'); // 70%: a small room can fill fast too
  assert.equal(label({ capacity: 20, left: 10 }), 'Booking open'); // half free isn't almost full
  assert.equal(label({ capacity: 10, left: 6 }), 'Booking open'); // a small class, mostly free
  assert.equal(label({ capacity: 400, left: 40 }), 'Almost full'); // a tenth of a big room
  assert.equal(label({ capacity: 60, left: 9, announced: '2026-11-19T10:00:00+05:30' }), 'Almost full'); // seats beat news
  assert.equal(label({ capacity: 20, left: 0 }), 'Sold out');
  assert.equal(label({ capacity: 20, left: 0, waitlist: true }), 'Waitlist open');
  assert.equal(label({ capacity: 20, left: -2 }), 'Sold out'); // oversold
  assert.equal(label({ tiers: [{ soldOut: true }, { soldOut: true }] }), 'Sold out'); // every ticket type gone
  assert.equal(label({ tiers: [{ soldOut: true }, {}] }), 'Booking open');
  assert.equal(label({ left: 3 }), 'Booking open'); // seats left but no capacity to judge by
  assert.equal(label({ capacity: 20, left: 0, waitlist: true, salesClose: '2026-11-20T08:00:00+05:30' }), 'Booking closed'); // closed beats the waitlist
  assert.equal(label({ salesClose: '2026-11-20T08:00:00+05:30' }), 'Booking closed');
  assert.equal(label({ salesOpen: '2026-11-21T18:00:00+05:30', capacity: 20, left: 0 }), 'Booking opens Sat 21 Nov · 6:00 PM');
  assert.equal(label({ pricePaise: 0, salesOpen: '2026-11-21T18:00:00+05:30' }), 'Registration opens Sat 21 Nov · 6:00 PM');
  assert.equal(label({ startsAt: '2026-11-20T08:00:00+05:30' }), 'On now');
  assert.equal(label({ startsAt: '2026-11-20T09:00:00+05:30' }), 'On now'); // from the start
  assert.equal(label({ startsAt: '2026-11-20T06:00:01+05:30' }), 'On now'); // a second short of three hours
  assert.equal(label({ startsAt: '2026-11-20T06:00:00+05:30' }), 'Ended'); // three hours on
  assert.equal(label({ cancelled: true, capacity: 60, left: 9 }), 'Cancelled');
});

test('just announced lasts three days', () => {
  const at = Date.parse('2026-11-18T10:00:00+05:30');
  const e = { ...base, announced: '2026-11-18T10:00:00+05:30' };
  assert.equal(status(e, at + 3 * 86_400_000 - 1).kind, 'justAnnounced');
  assert.equal(status(e, at + 3 * 86_400_000).kind, 'open');
});

test('a row\'s tag is short', () => {
  assert.equal(status({ ...base, salesOpen: '2026-11-21T18:00:00+05:30' }, NOW).short, 'Opens Sat 21 Nov');
  assert.equal(status({ ...base, capacity: 20, left: 0 }, NOW).short, 'Sold out');
});

test('news is anything but the everyday open and ended', () => {
  assert.equal(isNews(status(base, NOW)), false);
  assert.equal(isNews(status({ ...base, startsAt: '2026-11-01T18:00:00+05:30' }, NOW)), false);
  assert.equal(isNews(status({ ...base, capacity: 20, left: 0 }, NOW)), true);
});

test('the seats line shows only while booking is open and 10 or fewer are left', () => {
  const line = (e: Partial<StatusEvent>) => seatsLine({ ...base, ...e }, status({ ...base, ...e }, NOW));
  assert.equal(line({ capacity: 60, left: 9 }), '9 seats left');
  assert.equal(line({ capacity: 60, left: 1 }), '1 seat left');
  assert.equal(line({ capacity: 60, left: 11 }), undefined);
  assert.equal(line({ capacity: 60, left: 0 }), undefined);
  assert.equal(line({}), undefined);
  assert.equal(line({ capacity: 60, left: 9, salesClose: '2026-11-20T08:00:00+05:30' }), undefined); // closed
  assert.equal(line({ capacity: 60, left: 9, salesOpen: '2026-11-21T18:00:00+05:30' }), undefined); // not open yet
});

test("a row's tag: given, then news, then the repeat; a row not for booking only says Cancelled", () => {
  const st = (e: Partial<StatusEvent>) => status({ ...base, ...e }, NOW);
  assert.equal(rowTag(st({ capacity: 60, left: 9 }), 'Every Friday', true), 'Almost full');
  assert.equal(rowTag(st({ capacity: 60, left: 9 }), 'Every Friday', true, 'Refund asked'), 'Refund asked');
  assert.equal(rowTag(st({ capacity: 60, left: 9 }), 'Every Friday', false), 'Every Friday'); // your own ticket
  assert.equal(rowTag(st({ capacity: 20, left: 0 }), undefined, false), undefined);
  assert.equal(rowTag(st({ cancelled: true }), 'Every Friday', false), 'Cancelled');
  assert.equal(rowTag(st({}), 'Every Friday', true), 'Every Friday');
});

test('the booking button follows the status', () => {
  const act = (e: Partial<StatusEvent>) => bookAction(status({ ...base, ...e }, NOW), !({ ...base, ...e }.pricePaise), true);
  assert.deepEqual(act({}), { label: 'Book ticket', can: true });
  assert.deepEqual(act({ pricePaise: 0 }), { label: 'Register', can: true });
  assert.deepEqual(act({ capacity: 60, left: 9 }), { label: 'Book ticket', can: true });
  assert.deepEqual(act({ capacity: 20, left: 0, waitlist: true }), { label: 'Join waitlist', can: true });
  assert.deepEqual(act({ capacity: 20, left: 0 }), { label: 'Sold out', can: false });
  assert.deepEqual(act({ salesOpen: '2026-11-21T18:00:00+05:30' }), { label: 'Not open yet', can: false });
  assert.deepEqual(act({ salesClose: '2026-11-20T08:00:00+05:30' }), { label: 'Closed', can: false });
  assert.deepEqual(act({ cancelled: true }), { label: 'Closed', can: false });
});

test('India time, as the app writes it', () => {
  assert.equal(indiaWhen('2026-11-21T12:30:00Z'), 'Sat 21 Nov · 6:00 PM');
  assert.equal(indiaWhen('2026-11-20T18:30:00Z'), 'Sat 21 Nov · 12:00 AM');
});

test('bookings off till January: the status says when, anything that would book says so and books nothing', () => {
  const held = (e: Partial<StatusEvent>, now = NOW) => eventStatus({ ...base, ...e }, now, false);
  const act = (e: Partial<StatusEvent>) => bookAction(held(e), !({ ...base, ...e }.pricePaise), false);
  const on = { startsAt: '2026-11-20T08:00:00+05:30' }; // started an hour before NOW
  assert.equal(held({}).label, 'Booking opens in January');
  assert.equal(held({ pricePaise: 0 }).label, 'Registration opens in January');
  assert.equal(held({ capacity: 20, left: 0, waitlist: true }).kind, 'held');
  assert.equal(isNews(held({})), false); // rows keep their own tags
  assert.equal(seatsLine({ ...base, capacity: 20, left: 5 }, held({ capacity: 20, left: 5 })), undefined);
  assert.deepEqual(act({}), { label: HELD, can: false });
  assert.deepEqual(act({ pricePaise: 0 }), { label: HELD, can: false });
  // On now would book (Book ticket); it doesn't either.
  assert.equal(held(on).kind, 'onNow');
  assert.deepEqual(act(on), { label: HELD, can: false });
  assert.deepEqual(act({ capacity: 20, left: 0, waitlist: true }), { label: HELD, can: false });
  // Cancelled still says why.
  assert.deepEqual(act({ cancelled: true }), { label: 'Closed', can: false });
});
