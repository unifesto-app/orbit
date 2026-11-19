import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countLine, FEST_TYPES, fests, fromPricePaise, hackathons, perHour, startsLine, venues, withActs } from './kinds.ts';

test('"with" shows three acts, then the rest as +N', () => {
  assert.deepEqual(withActs(['a']), { names: ['a'], more: 0 });
  assert.deepEqual(withActs(['a', 'b', 'c', 'd', 'e']), { names: ['a', 'b', 'c'], more: 2 });
  assert.deepEqual(withActs([]), { names: [], more: 0 });
});

test("a venue's Starting from is its cheapest hour, off-peak included", () => {
  assert.equal(fromPricePaise(venues['respawn-zone']!), 12000); // a PC before 4 PM on a weekday
  assert.equal(fromPricePaise(venues['smash-court']!), 35000);
  assert.equal(perHour(16200), '₹162/hr');
});

test('pitches and courts are booked whole on the hour; gaming starts every 30 minutes', () => {
  assert.match(startsLine(venues['kickoff-arena']!), /whole.*on the hour/);
  assert.match(startsLine(venues['smash-court']!), /on the hour/);
  assert.match(startsLine(venues['respawn-zone']!), /30 minutes/);
  assert.equal(countLine(venues['kickoff-arena']!.stations[0]!), '2 pitches');
  assert.equal(countLine(venues['kickoff-arena']!.stations[1]!), '1 box');
});

test("every hackathon's criteria weigh 100 in all; every fest has a known kind", () => {
  for (const h of Object.values(hackathons)) assert.equal(h.criteria.reduce((n, c) => n + c.weight, 0), 100);
  for (const f of Object.values(fests)) assert.ok((FEST_TYPES as readonly string[]).includes(f.type));
});
