import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayWord } from './day.ts';

const at = (iso: string) => Date.parse(`${iso}+05:30`);
const now = at('2026-11-20T09:00:00');

test('an evening start today is Tonight, a daytime one Today', () => {
  assert.equal(dayWord('2026-11-20T20:00:00+05:30', now), 'Tonight');
  assert.equal(dayWord('2026-11-20T11:00:00+05:30', now), 'Today');
});

test('a start on the next India day is Tomorrow, even before midnight UTC', () => {
  assert.equal(dayWord('2026-11-21T09:00:00+05:30', now), 'Tomorrow');
  assert.equal(dayWord('2026-11-21T01:00:00+05:30', at('2026-11-20T23:00:00')), 'Tomorrow');
});

test('an event still running from an earlier day takes its word from now', () => {
  assert.equal(dayWord('2026-11-19T21:00:00+05:30', at('2026-11-20T00:30:00')), 'Tonight');
  assert.equal(dayWord('2026-11-19T21:00:00+05:30', at('2026-11-20T14:00:00')), 'Today');
});
