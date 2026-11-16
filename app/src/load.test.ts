// Run with `pnpm --filter @orbit/app test`. Pins what a screen draws from its requests (src/load.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Got, forget, nothing, settle, view } from './load.ts';

const ok = <T>(data: T) => ({ ok: true as const, data });
const no = (status: number) => ({ ok: false as const, status, error: { error: status === 0 ? 'offline' : 'notFound', message: 'm' } });

test('loading until the key has its answer, then the data', () => {
  assert.deepEqual(view(nothing, 'a', false), { data: null, error: null, status: 0, loading: true });
  assert.equal(view(nothing, null, false).loading, false); // nothing asked
  const g = settle(nothing as Got<number>, 'a', ok(1));
  assert.deepEqual(view(g, 'a', false), { data: 1, error: null, status: 200, loading: false });
});

test('a failed reload keeps the good data and says what went wrong', () => {
  const g = settle(settle(nothing as Got<number>, 'a', ok(1)), 'a', no(0));
  const v = view(g, 'a', false);
  assert.equal(v.data, 1);
  assert.equal(v.error?.error, 'offline');
  assert.equal(v.loading, false);
});

test('a new key draws nothing old, unless asked to keep it while it loads', () => {
  const g = settle(nothing as Got<number>, 'a', ok(1));
  assert.deepEqual(view(g, 'b', false), { data: null, error: null, status: 0, loading: true });
  assert.deepEqual(view(g, 'b', true), { data: 1, error: null, status: 0, loading: true });
  // The new key failed: kept data stays, and the error is the new key's.
  const failed = settle(g, 'b', no(404));
  assert.deepEqual(view(failed, 'b', true), { data: 1, error: { error: 'notFound', message: 'm' }, status: 404, loading: false });
  assert.equal(view(failed, 'b', false).data, null);
});

test("coming back to a key that failed before waits for this visit's answer", () => {
  const a = settle(nothing as Got<number>, 'a', ok(1));
  const bFailed = settle(a, 'b', no(0)); // a switch to b timed out
  const backToA = forget(bFailed);
  const backToB = forget(settle(backToA, 'a', ok(2)));
  assert.deepEqual(view(backToB, 'b', true), { data: 2, error: null, status: 0, loading: true });
});
