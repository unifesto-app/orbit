import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eventStatus, indiaWhen, isNews, seatsLine, type StatusEvent } from './status.ts';

const NOW = Date.parse('2026-11-20T09:00:00+05:30');
const base: StatusEvent = { startsAt: '2026-11-25T18:00:00+05:30', announced: '2026-11-01T10:00:00+05:30', pricePaise: 29900 };
const label = (e: Partial<StatusEvent>, now = NOW) => eventStatus({ ...base, ...e }, now).label;

test('one status, the first that holds', () => {
  assert.equal(label({}), 'Booking open');
  assert.equal(label({ pricePaise: 0 }), 'Registration open');
  assert.equal(label({ announced: '2026-11-18T10:00:00+05:30' }), 'Just announced');
  assert.equal(label({ capacity: 100, left: 40 }), 'Filling fast'); // 60% booked
  assert.equal(label({ capacity: 100, left: 41 }), 'Booking open');
  assert.equal(label({ capacity: 60, left: 9 }), 'Almost full'); // 10 or fewer, most booked
  assert.equal(label({ capacity: 10, left: 6 }), 'Booking open'); // a small class, mostly free
  assert.equal(label({ capacity: 400, left: 40 }), 'Almost full'); // a tenth of a big room
  assert.equal(label({ capacity: 60, left: 9, announced: '2026-11-19T10:00:00+05:30' }), 'Almost full'); // seats beat news
  assert.equal(label({ capacity: 20, left: 0 }), 'Sold out');
  assert.equal(label({ capacity: 20, left: 0, waitlist: true }), 'Waitlist open');
  assert.equal(label({ salesClose: '2026-11-20T08:00:00+05:30' }), 'Booking closed');
  assert.equal(label({ salesOpen: '2026-11-21T18:00:00+05:30', capacity: 20, left: 0 }), 'Booking opens Sat 21 Nov · 6:00 PM');
  assert.equal(label({ pricePaise: 0, salesOpen: '2026-11-21T18:00:00+05:30' }), 'Registration opens Sat 21 Nov · 6:00 PM');
  assert.equal(label({ startsAt: '2026-11-20T08:00:00+05:30' }), 'On now');
  assert.equal(label({ startsAt: '2026-11-20T06:00:00+05:30' }), 'Ended'); // three hours on
  assert.equal(label({ cancelled: true, capacity: 60, left: 9 }), 'Cancelled');
});

test('just announced lasts three days', () => {
  const at = Date.parse('2026-11-18T10:00:00+05:30');
  const e = { ...base, announced: '2026-11-18T10:00:00+05:30' };
  assert.equal(eventStatus(e, at + 3 * 86_400_000 - 1).kind, 'justAnnounced');
  assert.equal(eventStatus(e, at + 3 * 86_400_000).kind, 'open');
});

test('a row\'s tag is short', () => {
  assert.equal(eventStatus({ ...base, salesOpen: '2026-11-21T18:00:00+05:30' }, NOW).short, 'Opens Sat 21 Nov');
  assert.equal(eventStatus({ ...base, capacity: 20, left: 0 }, NOW).short, 'Sold out');
});

test('news is anything but the everyday open and ended', () => {
  assert.equal(isNews(eventStatus(base, NOW)), false);
  assert.equal(isNews(eventStatus({ ...base, startsAt: '2026-11-01T18:00:00+05:30' }, NOW)), false);
  assert.equal(isNews(eventStatus({ ...base, capacity: 20, left: 0 }, NOW)), true);
});

test('the seats line shows only once 10 or fewer are left', () => {
  assert.equal(seatsLine({ ...base, capacity: 60, left: 9 }), '9 seats left');
  assert.equal(seatsLine({ ...base, capacity: 60, left: 1 }), '1 seat left');
  assert.equal(seatsLine({ ...base, capacity: 60, left: 11 }), undefined);
  assert.equal(seatsLine({ ...base, capacity: 60, left: 0 }), undefined);
  assert.equal(seatsLine(base), undefined);
});

test('India time, as the app writes it', () => {
  assert.equal(indiaWhen('2026-11-21T12:30:00Z'), 'Sat 21 Nov · 6:00 PM');
  assert.equal(indiaWhen('2026-11-20T18:30:00Z'), 'Sat 21 Nov · 12:00 AM');
});
