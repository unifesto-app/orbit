import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bodyOf, type Form, fixesOf, paiseOf, placeHalf, priceLabel, saveable } from './editor.ts';

const f: Form = { title: ' Open Mic ', category: 'comedy', startsAt: '2026-12-12T19:30:00+05:30', hours: 2, venue: 'Hall', address: 'Road 1', area: 'Jubilee Hills', city: 'Hyderabad', about: '' };

test('the body: endsAt from the hours, a whole place with no coordinates, blank about as null', () => {
  const b = bodyOf(f);
  assert.equal(b.title, 'Open Mic');
  assert.equal(b.endsAt, '2026-12-12T16:00:00.000Z');
  assert.deepEqual(b.place, { venue: 'Hall', address: 'Road 1', area: 'Jubilee Hills', city: 'Hyderabad' });
  assert.equal(b.about, null);
  assert.ok(saveable(f));
  assert.equal(bodyOf({ ...f, hours: null }).endsAt, null);
});

test('half a place is held back; none at all saves as null', () => {
  assert.ok(placeHalf({ ...f, area: ' ' }));
  assert.ok(!saveable({ ...f, area: '' }));
  const none = { ...f, venue: '', address: '', area: '' };
  assert.ok(!placeHalf(none));
  assert.equal(bodyOf(none).place, null);
  assert.ok(saveable(none));
  assert.ok(!saveable({ ...f, title: '  ' }));
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
