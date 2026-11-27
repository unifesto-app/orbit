import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toHost } from './events.ts';
import { countLine, FEST_TYPES, festDays, fests, fromPricePaise, hackathonOf, hackathons, perHour, runtime, startsLine, venues, withActs } from './kinds.ts';

test('"with" shows three acts, then the rest as +N', () => {
  assert.deepEqual(withActs(['a']), { names: ['a'], more: 0 });
  assert.deepEqual(withActs(['a', 'b', 'c', 'd', 'e']), { names: ['a', 'b', 'c'], more: 2 });
  assert.deepEqual(withActs([]), { names: [], more: 0 });
  const hosts = ['a', 'b', 'c', 'd'].map((id) => toHost({ id, slug: id, name: id.toUpperCase(), kind: 'performer', city: null, verified: false, logo: null }));
  const { names, more } = withActs(hosts);
  assert.deepEqual(names.map((h) => h.name), ['A', 'B', 'C']);
  assert.equal(more, 1);
});

test("a real event's runtime and a fest's days come from its start and end, in India time", () => {
  assert.equal(runtime('2026-11-27T14:30:00Z', '2026-11-27T16:30:00Z'), 'About 2 hours');
  assert.equal(runtime('2026-11-27T14:30:00Z', '2026-11-27T16:00:00Z'), 'About 1.5 hours');
  assert.equal(runtime('2026-11-27T14:30:00Z', '2026-11-27T15:30:00Z'), 'About 1 hour');
  assert.equal(runtime('2026-11-27T14:30:00Z', '2026-11-27T15:15:00Z'), 'About 45 minutes');
  assert.equal(festDays('2026-11-27T04:30:00Z', '2026-11-27T17:30:00Z'), 'One day, 10:00 AM to 11:00 PM');
  // Fri 10 AM to Sun 11 PM India time: three calendar days, not a rounded 2.5
  assert.equal(festDays('2026-11-27T04:30:00Z', '2026-11-29T17:30:00Z'), '3 days, Fri 27 Nov to Sun 29 Nov');
});

test("a real hackathon's details: empty lists for what's missing, team size from either end, no winners", () => {
  const h = hackathonOf({ teamMax: 4, prizes: [{ place: 'First', prize: 'Rs 10,000' }] }, 5);
  assert.deepEqual(h, { team: [1, 4], teams: 5, tracks: [], prizes: [{ place: 'First', prize: 'Rs 10,000' }], rounds: [], criteria: [] });
  assert.equal(hackathonOf({}, null).team, undefined);
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
