// Run with `pnpm --filter @orbit/app test`. Pins how the API's event and host cards become what the screens draw.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EventCard, TierCard } from '@orbit/contract';

import { isKnown } from './account/seen.ts';
import { eventsApi, hostsOf, toEvent, toHost, toPlace, whereOf } from './events.ts';
import { search } from './search.ts';
import { eventStatus } from './status.ts';

const host = { id: '3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b', slug: 'punchline', name: 'Punchline Collective', kind: 'comedy-group', city: 'Hyderabad', verified: true, logo: null };
const tier = (o: Partial<TierCard> = {}): TierCard => ({ id: 't', name: 'General', pricePaise: 29900, quantity: null, left: null, salesStartAt: null, salesEndAt: null, note: null, perPersonLimit: 10, ...o });
const card = (o: Partial<EventCard> = {}): EventCard => ({
  id: 'e1', slug: 'open-mic', title: 'Open Mic', category: 'comedy', startsAt: '2026-11-27T14:30:00.000Z', endsAt: '2026-11-27T17:30:00.000Z', timezone: 'Asia/Kolkata',
  publishedAt: '2026-11-20T04:30:00.000Z', status: 'published', visibility: 'public',
  place: { venue: 'The Green Room', address: 'Road 36', area: 'Jubilee Hills', city: 'Hyderabad', lat: 17.43, lng: 78.4 },
  online: false, poster: 'https://x/p.png', wide: null, wideEdge: null, tone: null, pricePaise: 29900, tiers: [tier()], host, distanceKm: null, ...o,
});

test('a host card reads as a host, its colour from its id', () => {
  const h = toHost(host);
  assert.equal(h.initials, 'PC');
  assert.equal(h.kind, 'Comedy group');
  assert.equal(h.about, 'Comedy group · Hyderabad');
  assert.equal(h.slug, 'punchline');
  assert.equal(h.followers, 0);
  assert.equal(toHost({ ...host, city: null }).about, 'Comedy group');
});

test('one tier: price, when and where in India time, the host\'s colour for a missing tone', () => {
  const e = toEvent(card(), true);
  assert.equal(e.when, 'Fri 27 Nov · 8:00 PM');
  assert.equal(e.area, 'Jubilee Hills');
  assert.deepEqual(e.venue, { name: 'The Green Room', address: 'Road 36' });
  assert.equal(e.pricePaise, 29900);
  assert.equal(e.near, true);
  assert.equal(e.announced, '2026-11-20T04:30:00.000Z');
  assert.equal(e.tiers, undefined); // only with more than one
  assert.equal(e.capacity, undefined); // no quantity: no cap worth showing
  assert.equal(e.tone, toHost(host).bg);
  assert.deepEqual(e.poster, { source: { uri: 'https://x/p.png' }, ratio: '3:4' });
  assert.equal(toEvent(card()).near, undefined);
});

test('two tiers with one sold out; seats are summed when every tier has a quantity', () => {
  const e = toEvent(card({ pricePaise: 14900, tiers: [tier({ name: 'Early bird', pricePaise: 14900, quantity: 10, left: 0 }), tier({ name: 'Team', pricePaise: 29900, quantity: 20, left: 5 })] }));
  assert.deepEqual(e.tiers, [{ name: 'Early bird', pricePaise: 14900, soldOut: true }, { name: 'Team', pricePaise: 29900, soldOut: false }]);
  assert.equal(e.capacity, 30);
  assert.equal(e.left, 5);
  assert.equal(eventStatus(e, Date.parse('2026-11-25T00:00:00Z')).kind, 'almostFull');
});

test('every tier sold out is sold out', () => {
  const e = toEvent(card({ tiers: [tier({ quantity: 10, left: 0 })] }));
  assert.equal(eventStatus(e, Date.parse('2026-11-25T00:00:00Z')).kind, 'soldOut');
});

test('one tier with no quantity among others means no cap', () => {
  const e = toEvent(card({ tiers: [tier({ quantity: 10, left: 4 }), tier({ quantity: null })] }));
  assert.equal(e.capacity, undefined);
  assert.equal(e.left, undefined);
});

test('online only: Online for area and venue, a published event with no tiers reads free', () => {
  const e = toEvent(card({ place: null, online: true, pricePaise: null, tiers: [] }));
  assert.equal(e.area, 'Online');
  assert.deepEqual(e.venue, { name: 'Online', address: '' });
  assert.equal(e.pricePaise, 0);
  assert.equal(e.salesOpen, undefined);
});

test('sales windows count only when every tier has one', () => {
  const partial = toEvent(card({ tiers: [tier({ salesStartAt: '2026-11-22T00:00:00.000Z', salesEndAt: '2026-11-26T00:00:00.000Z' }), tier()] }));
  assert.equal(partial.salesOpen, undefined);
  assert.equal(partial.salesClose, undefined);
  const complete = toEvent(
    card({
      tiers: [
        tier({ salesStartAt: '2026-11-22T00:00:00.000Z', salesEndAt: '2026-11-26T00:00:00.000Z' }),
        tier({ salesStartAt: '2026-11-21T00:00:00.000Z', salesEndAt: '2026-11-25T00:00:00.000Z' }),
      ],
    }),
  );
  assert.equal(complete.salesOpen, '2026-11-21T00:00:00.000Z'); // the earliest
  assert.equal(complete.salesClose, '2026-11-26T00:00:00.000Z'); // the latest
});

test('cancelled; wide and tone', () => {
  assert.equal(toEvent(card({ status: 'cancelled' })).cancelled, true);
  assert.equal(toEvent(card()).cancelled, false);
  assert.equal(toEvent(card()).wide, undefined);
  const e = toEvent(card({ wide: 'https://x/w.png', wideEdge: '#112233', tone: '#445566' }));
  assert.deepEqual(e.wide, { source: { uri: 'https://x/w.png' }, edge: '#112233' });
  assert.equal(e.tone, '#445566');
});

test('the page fields come with a full event', () => {
  const e = toEvent({
    ...card(),
    about: 'Ten comics.',
    agenda: [{ at: '2026-11-27T14:00:00.000Z', item: 'Doors' }],
    faq: [{ q: 'Food?', a: 'Snacks.' }],
    terms: ['No outside food.'],
  });
  assert.equal(e.about, 'Ten comics.');
  assert.deepEqual(e.agenda, [{ time: '7:30 PM', item: 'Doors' }]); // a one-day event: the time alone
  assert.deepEqual(e.faq, [{ q: 'Food?', a: 'Snacks.' }]);
  assert.deepEqual(e.terms, ['No outside food.']);
  assert.deepEqual(e.people, []);
  assert.equal(toEvent(card()).agenda, undefined); // a card carries none
});

test('agenda times: the day too once the event spans days, midnight in India included', () => {
  const at = (iso: string) => [{ at: iso, item: 'x' }];
  const span = (start: string, end: string, agenda: string) => toEvent({ ...card({ startsAt: start, endsAt: end }), about: null, agenda: at(agenda), faq: [], terms: [] }).agenda![0]!.time;
  // 11 PM to 2 AM IST: two India days
  assert.equal(span('2026-11-27T17:30:00.000Z', '2026-11-27T20:30:00.000Z', '2026-11-27T18:30:00.000Z'), 'Sat 12:00 AM');
  // 18:30Z to 18:45Z is 00:00 to 00:15 IST on one day: time alone
  assert.equal(span('2026-11-27T18:30:00.000Z', '2026-11-27T18:45:00.000Z', '2026-11-27T18:40:00.000Z'), '12:10 AM');
  assert.equal(span('2026-11-28T03:30:00.000Z', '2026-11-29T01:30:00.000Z', '2026-11-28T03:30:00.000Z'), 'Sat 9:00 AM');
});

test('status from the adapted sales windows', () => {
  const opens = toEvent(card({ tiers: [tier({ salesStartAt: '2026-11-26T04:30:00.000Z', salesEndAt: '2026-11-27T00:00:00.000Z' })] }));
  assert.equal(eventStatus(opens, Date.parse('2026-11-25T00:00:00Z')).kind, 'opensSoon');
  assert.equal(eventStatus(opens, Date.parse('2026-11-27T01:00:00Z')).kind, 'closed');
});

test('end time is the clock: a 24 hour event four hours in is on, not ended', () => {
  const e = toEvent(card({ startsAt: '2026-11-27T04:00:00.000Z', endsAt: '2026-11-28T04:00:00.000Z' }));
  assert.equal(e.endsAt, '2026-11-28T04:00:00.000Z');
  assert.equal(eventStatus(e, Date.parse('2026-11-27T08:00:00Z')).kind, 'onNow');
  assert.equal(eventStatus(e, Date.parse('2026-11-28T04:00:00Z')).kind, 'ended');
});

test('missing poster and category do not break a card', () => {
  const e = toEvent(card({ poster: null, category: null }));
  assert.equal(e.category, 'events');
  assert.deepEqual(e.poster.source, { uri: '' });
});

test('a tier with a quantity but no left count is no cap; a negative left is sold out', () => {
  const none = toEvent(card({ tiers: [tier({ quantity: 10, left: null })] }));
  assert.equal(none.capacity, undefined);
  assert.equal(none.left, undefined);
  const over = toEvent(card({ tiers: [tier({ quantity: 10, left: -2 }), tier({ quantity: 5, left: -1 })] }));
  assert.deepEqual(over.tiers!.map((t) => t.soldOut), [true, true]);
  assert.equal(eventStatus(over, Date.parse('2026-11-25T00:00:00Z')).kind, 'soldOut');
});

test('hosts of events once each', () => {
  assert.equal(hostsOf([card(), card({ id: 'e2' })]).length, 1);
});

test('where the viewer is: a position inside India, else the city; a picked city is its name', () => {
  assert.deepEqual(whereOf(null), {});
  assert.deepEqual(whereOf({ area: 'Gachibowli', city: 'Hyderabad', nearAreas: [], lat: 17.44, lng: 78.35 }), { lat: 17.44, lng: 78.35, city: 'Hyderabad' });
  assert.deepEqual(whereOf({ area: 'Pune', city: 'Maharashtra', state: 'Maharashtra', nearAreas: [], source: 'pick' }), { city: 'Pune' });
  assert.deepEqual(whereOf({ area: 'Pune', city: 'Maharashtra', state: 'Maharashtra', nearAreas: [], source: 'gps', lat: 18.5, lng: 73.8 }), { lat: 18.5, lng: 73.8, city: 'Pune' }); // GPS with no district
  assert.deepEqual(whereOf({ area: 'X', city: 'London', nearAreas: [], lat: 51.5, lng: -0.1 }), { city: 'London' }); // outside India: the API would refuse it
});

test('public reads use call, never authed, and send what was asked', async () => {
  const calls: string[] = [];
  const data = { near: [card({ id: 'n1' })], elsewhere: [], events: [card({ id: 's1' })], hosts: [], upcoming: [card({ id: 'u1' })], past: [card({ id: 'p1' })], ...card({ id: 'one' }) };
  const api = { call: async (m: string, p: string) => (calls.push(`${m} ${p}`), { ok: true as const, data: data as never }) };
  const e = eventsApi(api);
  await e.discover({});
  await e.discover({ lat: 17.4, lng: 78.4, city: 'Hyderabad' });
  await e.search({ q: ' jam ', when: 'weekend', free: true, category: 'jams' }, { city: 'Pune' });
  await e.search({ q: '', free: false }, {});
  await e.event('open mic');
  await e.hostEvents('punchline');
  assert.deepEqual(calls, [
    'GET /public/discover',
    'GET /public/discover?lat=17.4&lng=78.4&city=Hyderabad',
    'GET /public/search?q=jam&when=weekend&free=true&category=jams&city=Pune',
    'GET /public/search',
    'GET /public/events/open%20mic',
    'GET /public/hosts/punchline/events',
  ]);
  // What they returned is kept for the Saved screens.
  for (const id of ['n1', 's1', 'u1', 'p1', 'one']) assert.ok(isKnown(id), id);
});

test('a public event brings its people and fest items; a card has neither', () => {
  const person = { id: 'p1', name: 'Asha Rao', headline: 'Poet', role: 'Judge' };
  const item = { id: 'f1', title: 'Food court', kind: 'Food' as const, when: 'All day', where: 'Lawns', about: 'Stalls.', team: null, prize: null, act: host };
  const full = { ...card(), about: null, agenda: [], faq: [], terms: [], vibes: [], interested: 0, people: [person], festItems: [item] };
  const e = toEvent(full);
  assert.deepEqual(e.lineup, [person]);
  assert.deepEqual(e.festItems, [item]);
  const none = toEvent({ ...full, people: [], festItems: [] });
  assert.equal(none.lineup, undefined);
  assert.equal(none.festItems, undefined);
  assert.equal(toEvent(card()).lineup, undefined);
});

test('a place to play keeps its tile and area, and is near within 25 km only when the API measured it', async () => {
  const p = { ...host, kind: 'venue', tile: 'gaming' as const, area: 'Madhapur', stations: 'Gaming PC, PS5', distanceKm: 3.2 };
  const h = toPlace(p);
  assert.equal(h.tile, 'gaming');
  assert.equal(h.area, 'Madhapur');
  assert.equal(h.near, true);
  assert.equal(toPlace({ ...p, distanceKm: 40 }).near, false);
  assert.equal(toPlace({ ...p, distanceKm: null }).near, undefined);
  // Typed search finds it by a station's name, not only its own.
  const turf = toPlace({ ...p, id: 'turf', tile: 'sports', stations: 'Badminton court, Box cricket turf' });
  const found = (q: string) => search({ q, free: false }, [], [h, turf], Date.now()).hosts.map((x) => x.id);
  assert.deepEqual(found('gaming'), [h.id]);
  assert.deepEqual(found('ps5'), [h.id]);
  assert.deepEqual(found('turf'), ['turf']);
  assert.deepEqual(found('badminton madhapur'), ['turf']);
  const calls: string[] = [];
  const places = eventsApi({ call: async (m: string, path: string) => (calls.push(`${m} ${path}`), { ok: true as const, data: { places: [] } as never }) }).places;
  await places({ city: 'Pune' });
  await places({ lat: 17.4, lng: 78.4, city: 'Hyderabad' });
  assert.deepEqual(calls, ['GET /public/places', 'GET /public/places?lat=17.4&lng=78.4']);
});
