import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ago, due, oldestFirst } from './due.ts';

const now = Date.parse('2026-11-20T09:00:00+05:30');

test('due counts 24 hours from the ask', () => {
  assert.deepEqual(due('2026-11-20T06:00:00+05:30', now), { overdue: false, line: 'Due in 21h' });
  assert.deepEqual(due('2026-11-19T06:00:00+05:30', now), { overdue: true, line: 'Overdue 3h' });
  assert.equal(due('2026-11-19T09:00:00+05:30', now).overdue, true); // exactly 24 hours is overdue
});

test('ago says hours, then days', () => {
  assert.equal(ago('2026-11-20T06:00:00+05:30', now), '3h ago');
  assert.equal(ago('2026-11-20T08:59:00+05:30', now), '1h ago'); // never "0h"
  assert.equal(ago('2026-11-18T09:00:00+05:30', now), '2 days ago');
});

test('oldest first puts the most overdue on top', () => {
  const ids = oldestFirst([{ id: 'b', askedAt: '2026-11-20T06:00:00+05:30' }, { id: 'a', askedAt: '2026-11-19T06:00:00+05:30' }]).map((x) => x.id);
  assert.deepEqual(ids, ['a', 'b']);
});
