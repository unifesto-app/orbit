// Run with `pnpm --filter @orbit/app test`. Pins the reason sheet's guard: only a ticket this app made runs an action.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Held, hold, release, take } from './held.ts';

const job = (title: string): Held => ({ title, line: '', action: 'Suspend', who: '', feature: 'hosts', run: async () => ({ ok: true, data: null }) });

test('the sheet takes its own job once; a link without the ticket gets nothing', () => {
  const t = hold(job('Suspend A?'));
  assert.equal(take(undefined), null);
  assert.equal(take(''), null);
  assert.equal(take('made-up'), null);
  assert.equal(take(t)?.title, 'Suspend A?');
  assert.equal(take(t), null); // spent: a second open of the same link does nothing
});

test('a newer action replaces an older one, and an action with no API holds nothing', () => {
  const old = hold(job('Suspend A?'));
  const now = hold(job('Verify B?'));
  assert.equal(take(old), null);
  assert.equal(take(now)?.title, 'Verify B?');
  const t = hold(job('Lift C?'));
  release();
  assert.equal(take(t), null);
});
