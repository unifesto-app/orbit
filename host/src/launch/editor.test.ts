import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TeamEvent } from '@orbit/contract';

import { bodyOf, fixesOf, formOf, lastsLabel, paiseOf, placeHalf, priceLabel, saveable } from './editor.ts';

// A 90-minute event at a place found by search, with coordinates the form can't show.
const e = {
  title: 'Open Mic',
  category: 'comedy',
  startsAt: '2026-12-12T14:00:00.000Z',
  endsAt: '2026-12-12T15:30:00.000Z',
  place: { venue: 'Hall', address: 'Road 1', area: 'Jubilee Hills', city: 'Hyderabad', lat: 17.43, lng: 78.41, placeId: 'abc' },
  about: null,
} as unknown as TeamEvent;
const was = formOf(e);

test('untouched, nothing is sent; a title edit sends only the title', () => {
  assert.deepEqual(bodyOf(was, was), {});
  assert.ok(!saveable(was, was));
  assert.equal(was.minutes, 90);
  assert.deepEqual(bodyOf({ ...was, title: ' Open Mic Night ' }, was), { title: 'Open Mic Night' });
  assert.ok(saveable({ ...was, title: 'Open Mic Night' }, was));
});

test('a new start keeps the 90 minutes; a new length moves only the end', () => {
  assert.deepEqual(bodyOf({ ...was, startsAt: '2026-12-13T19:30:00+05:30' }, was), { startsAt: '2026-12-13T19:30:00+05:30', endsAt: '2026-12-13T15:30:00.000Z' });
  assert.deepEqual(bodyOf({ ...was, minutes: 120 }, was), { endsAt: '2026-12-12T16:00:00.000Z' });
  assert.equal(lastsLabel(90), '1 hr 30 min');
});

test('a retyped place goes whole, without coordinates; half of one is held back; blank about stays unsent', () => {
  assert.deepEqual(bodyOf({ ...was, venue: 'Big Hall' }, was), { place: { venue: 'Big Hall', address: 'Road 1', area: 'Jubilee Hills', city: 'Hyderabad' } });
  assert.ok(placeHalf({ ...was, area: ' ' }));
  assert.ok(!saveable({ ...was, area: '' }, was));
  const none = { ...was, venue: '', address: '', area: '' };
  assert.deepEqual(bodyOf(none, was), { place: null });
  assert.ok(saveable(none, was));
  assert.deepEqual(bodyOf({ ...was, about: '  ' }, was), {});
  assert.ok(!saveable({ ...was, title: '  ' }, was));
});

test('prices in whole rupees', () => {
  assert.equal(paiseOf(''), 0);
  assert.equal(paiseOf('0'), 0);
  assert.equal(paiseOf('499'), 49_900);
  assert.equal(paiseOf('1,000'), 100_000);
  assert.equal(paiseOf('10,00,000'), 100_000_000);
  assert.equal(paiseOf('1000001'), null);
  assert.equal(paiseOf('49.50'), null);
  assert.equal(paiseOf('-5'), null);
  assert.equal(priceLabel(0), 'Free');
  assert.equal(priceLabel(149_900), '₹1,499');
});

test('publish refusals as fixes', () => {
  assert.deepEqual(fixesOf(['poster', 'tickets']), ['Add a 3:4 poster.', 'Add at least one ticket type.']);
  assert.deepEqual(fixesOf(['later']), ['Something else is missing.']);
});
