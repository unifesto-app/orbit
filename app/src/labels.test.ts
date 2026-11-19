// Run with `pnpm --filter @orbit/app test`. Pins which label an event carries and how a promoted one moves up.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eventLabel, promoteOne } from './labels.ts';
import { eventStatus } from './status.ts';

const NOW = Date.parse('2026-11-20T09:00:00+05:30');
const ev = { startsAt: '2026-11-24T08:30:00+05:30', announced: '2026-11-01T10:00:00+05:30', pricePaise: 19900 };
const old = { joined: '2026-05-31T10:00:00+05:30' };
const label = (e: typeof ev & { promoted?: boolean; left?: number; capacity?: number; cancelled?: boolean }, host: { joined: string; lovedBy?: number }) =>
  eventLabel(e, host, eventStatus(e, NOW), NOW);

test('Promoted, then People’s choice, then New on Orbit; none for an ordinary event', () => {
  assert.equal(label({ ...ev, promoted: true }, { joined: '2026-11-15T10:00:00+05:30', lovedBy: 500 }), 'Promoted');
  assert.equal(label(ev, { ...old, lovedBy: 100 }), 'People’s choice');
  assert.equal(label(ev, { ...old, lovedBy: 99 }), undefined);
  assert.equal(label(ev, { joined: '2026-11-15T10:00:00+05:30' }), 'New on Orbit');
  assert.equal(label(ev, { joined: '2026-10-14T10:00:00+05:30' }), undefined); // 37 days
});

test('no label once it can’t be booked: sold out, cancelled or ended', () => {
  assert.equal(label({ ...ev, promoted: true, capacity: 40, left: 0 }, old), undefined);
  assert.equal(label({ ...ev, promoted: true, cancelled: true }, old), undefined);
  assert.equal(label({ ...ev, promoted: true, startsAt: '2026-11-19T08:30:00+05:30' }, old), undefined);
  assert.equal(label({ ...ev, promoted: true, capacity: 40, left: 3 }, old), 'Promoted'); // almost full still is
});

test('promoteOne moves the first promoted event up, one per list, and never adds one', () => {
  const list = [{ id: 'a' }, { id: 'b', p: true }, { id: 'c', p: true }];
  assert.deepEqual(promoteOne(list, (e) => !!e.p).map((e) => e.id), ['b', 'a', 'c']);
  assert.deepEqual(promoteOne(list, () => false).map((e) => e.id), ['a', 'b', 'c']);
  assert.deepEqual(promoteOne([], () => true), []);
});
