// Run with `pnpm --filter @orbit/app test`. Pins what the Search tab finds and how it counts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countLine, search, span } from './search.ts';

const NOW = Date.parse('2026-11-20T09:00:00+05:30'); // a Friday morning in India
const at = (iso: string) => `${iso}+05:30`;
const hosts = [
  { id: 'jam', name: 'Jam Circle', area: 'KBR Park' },
  { id: 'punch', name: 'Punchline', area: 'Jubilee Hills' },
];
const ev = (id: string, hostId: string, title: string, startsAt: string, category: 'jams' | 'comedy', pricePaise = 0) => ({
  id,
  hostId,
  title,
  area: hostId === 'jam' ? 'KBR Park' : 'Jubilee Hills',
  category,
  startsAt: at(startsAt),
  pricePaise,
});
const events = [
  ev('mic', 'punch', 'Open Mic', '2026-11-20T20:00:00', 'comedy', 29900), // tonight
  ev('jam', 'jam', 'Sunday Jam', '2026-11-22T17:00:00', 'jams'), // Sunday
  ev('late', 'jam', 'Late Jam', '2026-11-26T21:00:00', 'jams'), // Thursday
  ev('past', 'jam', 'Old Jam', '2026-11-19T17:00:00', 'jams'), // yesterday
];
const ids = (r: { events: { id: string }[] }) => r.events.map((e) => e.id);
const none = { q: '', free: false };

test('with nothing typed, every upcoming event, soonest first, and no hosts', () => {
  const r = search(none, events, hosts, NOW);
  assert.deepEqual(ids(r), ['mic', 'jam', 'late']);
  assert.deepEqual(r.hosts, []);
});

test('text matches title, host, area or category, any case, and finds hosts by name or area', () => {
  assert.deepEqual(ids(search({ ...none, q: 'MIC' }, events, hosts, NOW)), ['mic']);
  assert.deepEqual(ids(search({ ...none, q: 'punchline' }, events, hosts, NOW)), ['mic']);
  assert.deepEqual(ids(search({ ...none, q: 'kbr' }, events, hosts, NOW)), ['jam', 'late']);
  assert.deepEqual(ids(search({ ...none, q: 'comedy' }, events, hosts, NOW)), ['mic']);
  assert.deepEqual(search({ ...none, q: ' jam ' }, events, hosts, NOW).hosts.map((h) => h.id), ['jam']);
});

test('chips narrow by When, Free and category', () => {
  assert.deepEqual(ids(search({ ...none, when: 'today' }, events, hosts, NOW)), ['mic']);
  assert.deepEqual(ids(search({ ...none, when: 'weekend' }, events, hosts, NOW)), ['jam']);
  assert.deepEqual(ids(search({ ...none, when: 'week' }, events, hosts, NOW)), ['mic', 'jam', 'late']);
  assert.deepEqual(ids(search({ ...none, free: true }, events, hosts, NOW)), ['jam', 'late']);
  assert.deepEqual(ids(search({ ...none, category: 'comedy' }, events, hosts, NOW)), ['mic']);
});

test('a tile alone lists its places to play; every typed word must appear', () => {
  const places = [...hosts, { id: 'turf', name: 'Kickoff Arena', area: 'Gachibowli', about: 'Turf and box cricket', tile: 'sports' as const }];
  const hostIds = (f: typeof none & { q?: string; category?: 'sports' | 'comedy'; free?: boolean }) =>
    search({ ...none, ...f }, events, places, NOW).hosts.map((h) => h.id);
  assert.deepEqual(hostIds({ category: 'sports' }), ['turf']);
  assert.deepEqual(hostIds({ category: 'comedy' }), []);
  assert.deepEqual(hostIds({ category: 'sports', free: true }), []); // no place to play is free
  assert.deepEqual(hostIds({ q: 'cricket turf' }), ['turf']);
  assert.deepEqual(hostIds({ q: 'cricket kbr' }), []);
});

test('this weekend is Saturday and Sunday in India time, or what is left of it', () => {
  const day = (iso: string) => Date.parse(at(iso));
  assert.deepEqual(span('weekend', NOW), [day('2026-11-21T00:00:00'), day('2026-11-23T00:00:00')]);
  const saturdayNoon = day('2026-11-21T12:00:00');
  assert.deepEqual(span('weekend', saturdayNoon), [saturdayNoon, day('2026-11-23T00:00:00')]);
  const sundayNoon = day('2026-11-22T12:00:00');
  assert.deepEqual(span('weekend', sundayNoon), [sundayNoon, day('2026-11-23T00:00:00')]);
  // Late Friday night in India is still Friday, though it is Friday afternoon in UTC.
  assert.equal(span('today', day('2026-11-20T23:30:00'))[1], day('2026-11-21T00:00:00'));
});

test('the count says what is showing', () => {
  assert.equal(countLine(3, none), '3 events coming up');
  assert.equal(countLine(1, { ...none, q: 'jam' }), '1 event for “jam”');
  assert.equal(countLine(4, { q: 'jam', free: false, category: 'jams' }), '4 events for “jam” in Jams');
  assert.equal(countLine(2, { q: '', free: true, when: 'weekend' }), '2 free events this weekend');
});

test("hosts match by their one line too, so a kind of place finds it", () => {
  const places = [
    { id: 'kickoff-arena', name: 'Kickoff Arena', area: 'Gachibowli', about: 'Turf and box cricket · Gachibowli' },
    { id: 'respawn-zone', name: 'Respawn Zone', area: 'Gachibowli', about: 'Gaming café · Gachibowli' },
  ];
  const find = (q: string) => search({ ...none, q }, [], places, NOW).hosts.map((h) => h.id);
  assert.deepEqual(find('turf'), ['kickoff-arena']);
  assert.deepEqual(find('GAMING'), ['respawn-zone']);
  assert.deepEqual(find('chess'), []);
});
