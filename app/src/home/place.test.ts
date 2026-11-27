// Run with `pnpm --filter @orbit/app test`. Pins how the geocoder's address becomes Home's two lines.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { locationStatusOf, placeName } from './layout.ts';

const none = { district: null, city: null, subregion: null, region: null };

test('a neighbourhood leads over its city', () => {
  assert.deepEqual(
    placeName({ district: 'Gachibowli', city: 'Hyderabad', subregion: 'Ranga Reddy', region: 'Telangana' }),
    { area: 'Gachibowli', city: 'Hyderabad', state: 'Telangana' }, // the state rides along
  );
});

test('with no neighbourhood the city leads over its state', () => {
  assert.deepEqual(placeName({ ...none, city: 'Hyderabad', region: 'Telangana' }), {
    area: 'Hyderabad',
    city: 'Telangana',
    state: 'Telangana',
  });
});

test('never the same name twice', () => {
  assert.deepEqual(placeName({ ...none, district: 'Hyderabad', city: 'Hyderabad', region: 'Telangana' }), {
    area: 'Hyderabad',
    city: 'Telangana',
    state: 'Telangana',
  });
});

test('the subregion stands in for a missing city', () => {
  assert.deepEqual(placeName({ ...none, district: 'Gachibowli', subregion: 'Ranga Reddy', region: 'Telangana' }), {
    area: 'Gachibowli',
    city: 'Ranga Reddy',
    state: 'Telangana',
  });
});

test('a city-state has no second line', () => {
  assert.deepEqual(placeName({ ...none, city: 'Hyderabad' }), { area: 'Hyderabad', city: '' }); // no region, no state
  assert.deepEqual(placeName({ ...none, city: 'Delhi', region: 'Delhi' }), { area: 'Delhi', city: '', state: 'Delhi' });
});

test('nothing usable gives null', () => {
  assert.equal(placeName(none), null);
});

test('location permission: on, ask while the prompt can still come up, else blocked', () => {
  assert.equal(locationStatusOf({ granted: true, status: 'granted', canAskAgain: true }), 'on');
  assert.equal(locationStatusOf({ granted: false, status: 'undetermined', canAskAgain: true }), 'ask');
  assert.equal(locationStatusOf({ granted: false, status: 'denied', canAskAgain: true }), 'ask'); // Android, after one no
  assert.equal(locationStatusOf({ granted: false, status: 'denied', canAskAgain: false }), 'blocked');
});
