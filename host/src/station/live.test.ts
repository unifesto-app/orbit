import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VenueDay } from '@orbit/contract';

import { HOUR, MIN, atDoor, door, heldLine, steps, taken } from './day.ts';
import { fromApi, plural } from './live.ts';

const day = Date.UTC(2026, 10, 22) - 330 * MIN; // Sun 22 Nov 2026, midnight in India
const iso = (h: number, m = 0) => new Date(day + h * HOUR + m * MIN).toISOString();
const host = { hostId: 'h1', name: 'Respawn Zone' };
const claim = { who: null, why: null, admitted: 0, checkedInAt: null, checkedInBy: null, releasedAt: null, holdEndsAt: null };
const api: VenueDay = {
  opening: { day: iso(0), opens: iso(11), closes: iso(26), state: 'open' },
  logsWalkIns: false,
  stations: [
    { id: 'pc', name: 'Gaming PC', unit: 'PC', tile: 'gaming', count: 12, whole: false, step: 30, archived: false, charges: true },
    { id: 'old', name: 'Old PC', unit: 'PC', tile: 'gaming', count: 2, whole: false, step: 30, archived: true, charges: true },
  ],
  claims: [
    { ...claim, id: 'b1', stationId: 'pc', kind: 'booking', status: 'paid', count: 2, start: iso(18), end: iso(20), who: 'Rahul S.' },
    { ...claim, id: 'b2', stationId: 'pc', kind: 'booking', status: 'checked_in', count: 1, start: iso(17), end: iso(19), admitted: 1, checkedInAt: iso(17, 5), checkedInBy: 'Ravi' },
    { ...claim, id: 'b3', stationId: 'pc', kind: 'booking', status: 'released', count: 3, start: iso(16), end: iso(18), releasedAt: iso(16, 20) },
    { ...claim, id: 'b4', stationId: 'pc', kind: 'booking', status: 'refunded', count: 4, start: iso(18), end: iso(20) },
    { ...claim, id: 'w1', stationId: 'pc', kind: 'walkin', status: 'paid', count: 1, start: iso(18), end: iso(19) },
    { ...claim, id: 'k1', stationId: 'pc', kind: 'block', status: 'paid', count: 2, start: iso(14), end: iso(21), why: 'Repair' },
  ],
  free: {},
};

test('a day from the API reads as Today draws it, with no money', () => {
  const at = day + 18 * HOUR + 10 * MIN;
  const t = fromApi(api, host, at);
  assert.deepEqual(t.venue.open, [11, 26]);
  assert.deepEqual(t.venue.types.map((x) => [x.id, x.unit, x.price]), [['pc', ['PC', 'PCs'], 0]]);
  assert.equal(t.hours.state, 'open');
  assert.equal(t.closed, false);
  assert.equal(steps(t.venue, t.venue.types[0]!, t.hours.day).length, 30);
  assert.deepEqual(t.claims.map((c) => c.id), ['b1', 'b2', 'b3', 'w1', 'k1']); // refunded left out
  assert.deepEqual(taken(t.claims, t.venue.types[0]!, at), { booking: 3, walkin: 1, block: 2, free: 6 }); // released takes nothing
  const [b1, b2, b3] = t.claims;
  assert.equal(door(b1!, at), 'late');
  assert.equal(door(b2!, at), 'here');
  assert.equal(b2!.by, 'Ravi');
  assert.equal(b2!.who, 'Someone');
  assert.equal(door(b3!, at), 'released');
});

test('a closed day reads as closed', () => {
  const t = fromApi({ ...api, opening: { day: iso(0), opens: iso(0), closes: iso(0), state: 'after' }, claims: [] }, host, day + 12 * HOUR);
  assert.equal(t.closed, true);
  assert.equal(t.hours.state, 'after');
});

test('units say their many', () => {
  assert.deepEqual(['PC', 'pitch', 'box', 'court', 'bus'].map(plural), ['PCs', 'pitches', 'boxes', 'courts', 'buses']);
});

test('a held booking takes its stations but nobody is due at the door', () => {
  const held = { ...claim, id: 'h', stationId: 'pc', kind: 'booking' as const, status: 'held' as const, count: 3, start: iso(18), end: iso(19), who: 'Aditi K.' };
  const t = fromApi({ ...api, claims: [held] }, host, day + 18 * HOUR);
  assert.equal(taken(t.claims, t.venue.types[0]!, day + 18 * HOUR).booking, 3);
  assert.equal(atDoor(t.claims[0]!), false);
  assert.equal(atDoor(fromApi(api, host, day).claims[0]!), true); // a paid one is
});

test('a held online booking: Paying… on a priced station, Holding on a free one, with minutes left, gone once lapsed', () => {
  const now = day + 18 * HOUR;
  const pitch = { id: 'pitch', name: 'Pitch', unit: 'pitch', tile: 'sports' as const, count: 1, whole: true, step: 60 as const, archived: false, charges: false };
  const h = (id: string, stationId: string, ends: number) =>
    ({ ...claim, id, stationId, kind: 'booking' as const, status: 'held' as const, count: 1, start: iso(20), end: iso(21), holdEndsAt: new Date(ends).toISOString() });
  const t = fromApi({ ...api, stations: [...api.stations, pitch], claims: [h('a', 'pc', now + 7 * MIN), h('b', 'pitch', now + 90_000), h('c', 'pc', now - 1)] }, host, now);
  assert.deepEqual(t.claims.map((c) => heldLine(c, now)), ['Paying… · 7 min left', 'Holding · 2 min left', null]);
  assert.equal(heldLine(fromApi(api, host, now).claims[0]!, now), null); // a paid one isn't held
});

test('a pitch booked whole by the hour, and a claim on an archived station', () => {
  const pitch = { id: 'pitch', name: '5-a-side football', unit: 'pitch', tile: 'sports' as const, count: 2, whole: true, step: 60 as const, archived: false, charges: false };
  const onOld = { ...claim, id: 'o', stationId: 'old', kind: 'walkin' as const, status: 'paid' as const, count: 1, start: iso(18), end: iso(19) };
  const t = fromApi({ ...api, stations: [...api.stations, pitch], claims: [onOld] }, host, day + 18 * HOUR);
  const p = t.venue.types.find((x) => x.id === 'pitch')!;
  assert.deepEqual([p.whole, p.step, p.unit], [true, 60, ['pitch', 'pitches']]);
  assert.equal(steps(t.venue, p, t.hours.day).length, 15); // 11 AM to 2 AM by the hour
  assert.deepEqual(t.venue.types.map((x) => x.id), ['pc', 'pitch']); // the archived one isn't drawn
  assert.equal(taken(t.claims, t.venue.types[0]!, day + 18 * HOUR).walkin, 0); // and its claim touches nothing drawn
});

test('an opening past midnight is still open at 1 AM and done at 2 AM', () => {
  assert.equal(fromApi(api, host, day + 25 * HOUR).hours.state, 'open');
  assert.equal(fromApi(api, host, day + 26 * HOUR).hours.state, 'after');
  assert.equal(fromApi(api, host, day + 10 * HOUR).hours.state, 'before');
});
