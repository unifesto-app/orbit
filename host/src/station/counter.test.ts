import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Authed, counter } from './counter.ts';

test('each counter write sends its method, path and body', async () => {
  const sent: unknown[][] = [];
  const authed = (async (...a: unknown[]) => (sent.push(a), { ok: true, data: null })) as Authed;
  const c = counter('h1', authed);
  await c.walkIn({ stationId: 's1', hours: 2, count: 3 });
  await c.freeOne({ stationId: 's1' });
  await c.block({ stationId: 's1', hours: 1, count: 1, why: 'Maintenance' });
  await c.admit('c1', { total: 4 });
  await c.release('c1');
  assert.deepEqual(sent, [
    ['POST', '/venues/h1/walk-ins', { stationId: 's1', hours: 2, count: 3 }],
    ['POST', '/venues/h1/walk-ins/free', { stationId: 's1' }],
    ['POST', '/venues/h1/blocks', { stationId: 's1', hours: 1, count: 1, why: 'Maintenance' }],
    ['POST', '/venues/h1/claims/c1/admit', { total: 4 }],
    ['POST', '/venues/h1/claims/c1/release'],
  ]);
});
