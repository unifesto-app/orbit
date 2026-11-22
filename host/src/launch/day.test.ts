import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkInOpen, dayWord, split, startsToday } from './day.ts';

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

test('check-in opens 24 hours before the start and closes 3 hours after the end', () => {
  const start = '2026-11-20T20:00:00+05:30';
  const end = '2026-11-20T23:00:00+05:30';
  assert.equal(checkInOpen(start, end, at('2026-11-19T19:59:00')), false);
  assert.equal(checkInOpen(start, end, at('2026-11-19T20:00:00')), true);
  assert.equal(checkInOpen(start, end, at('2026-11-21T02:00:00')), true);
  assert.equal(checkInOpen(start, end, at('2026-11-21T02:01:00')), false);
});

const ev = (id: string, start: string, end: string) => ({ id, startsAt: `${start}+05:30`, endsAt: `${end}+05:30` });
const ends = (e: { endsAt: string }) => e.endsAt;
const ids = (es: { id: string }[]) => es.map((e) => e.id);

test('open events group under their word, the group starting soonest first', () => {
  const fri = ev('fri-show', '2026-11-20T21:00:00', '2026-11-20T23:00:00'); // ended, door still open
  const morning = ev('sat-morning', '2026-11-21T11:00:00', '2026-11-21T13:00:00');
  const evening = ev('sat-show', '2026-11-21T20:00:00', '2026-11-21T22:00:00');
  const { groups } = split([morning, evening, fri], ends, at('2026-11-21T00:30:00'));
  assert.deepEqual(
    groups.map((g) => [g.word, ids(g.events)]),
    [
      ['Tonight', ['fri-show', 'sat-show']],
      ['Today', ['sat-morning']],
    ],
  );
});

test('more than 24 hours ahead is coming, ended over 3 hours ago is past, newest first', () => {
  const now = at('2026-11-20T18:40:00');
  const soon = ev('next-week', '2026-11-27T20:00:00', '2026-11-27T23:00:00');
  const old = ev('old', '2026-11-06T20:00:00', '2026-11-06T23:00:00');
  const last = ev('last', '2026-11-13T20:00:00', '2026-11-13T23:00:00');
  const { groups, next, past } = split([soon, old, last], ends, now);
  assert.deepEqual(groups, []);
  assert.deepEqual(ids(next), ['next-week']);
  assert.deepEqual(ids(past), ['last', 'old']);
});

test('a card shows its date unless it starts on today\'s India day', () => {
  assert.equal(startsToday('2026-11-21T20:00:00+05:30', at('2026-11-21T00:30:00')), true);
  assert.equal(startsToday('2026-11-20T21:00:00+05:30', at('2026-11-21T00:30:00')), false);
});
