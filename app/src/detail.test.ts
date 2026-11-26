// Run with `pnpm --filter @orbit/app test`. Pins what the event, host and person screens list.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appearances, barPrice, cast, followersLine, hostEvents, liveCast } from './detail.ts';

const NOW = Date.parse('2026-11-20T09:00:00+05:30');
const ev = (id: string, hostId: string, startsAt: string, people: { personId: string; role: 'Speaker' | 'Judge' }[] = []) => ({
  id,
  hostId,
  startsAt,
  people,
});
const ids = (list: { id: string }[]) => list.map((e) => e.id);

test('cast groups by role in ROLES order, drops empty roles, accepts undefined', () => {
  const groups = cast([
    { personId: 'm1', role: 'Mentor' },
    { personId: 's1', role: 'Speaker' },
    { personId: 's2', role: 'Speaker' },
  ]);
  assert.deepEqual(groups, [
    { title: 'Speakers', ids: ['s1', 's2'] },
    { title: 'Mentors', ids: ['m1'] },
  ]);
  assert.deepEqual(cast(undefined), []);
});

test('hostEvents splits upcoming soonest first and past latest first, comparing times not strings', () => {
  const events = [
    ev('now', 'h', '2026-11-20T09:00:00+05:30'), // exactly now is upcoming
    ev('soon', 'h', '2026-11-20T10:00:00+05:30'),
    ev('zulu', 'h', '2026-11-20T03:45:00Z'), // 09:15 IST, after "now" though the string sorts earlier
    ev('old', 'h', '2026-11-01T10:00:00+05:30'),
    ev('older', 'h', '2026-10-01T10:00:00+05:30'),
    ev('other', 'x', '2026-11-21T10:00:00+05:30'),
  ];
  const { upcoming, past } = hostEvents('h', events, NOW);
  assert.deepEqual(ids(upcoming), ['now', 'zulu', 'soon']);
  assert.deepEqual(ids(past), ['old', 'older']);

  const many = Array.from({ length: 15 }, (_, i) => ev(`p${i}`, 'h', `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00+05:30`));
  const capped = hostEvents('h', many, NOW).past;
  assert.equal(capped.length, 12);
  assert.equal(capped[0].id, 'p14');
});

test('appearances lists each credit with role and past flag, upcoming first then past', () => {
  const events = [
    ev('past1', 'h', '2026-11-01T10:00:00+05:30', [{ personId: 'p', role: 'Judge' }]),
    ev('later', 'h', '2026-11-25T10:00:00+05:30', [{ personId: 'p', role: 'Speaker' }]),
    ev('past2', 'h', '2026-11-10T10:00:00+05:30', [{ personId: 'p', role: 'Speaker' }]),
    ev('soon', 'h', '2026-11-21T10:00:00+05:30', [{ personId: 'p', role: 'Judge' }, { personId: 'q', role: 'Speaker' }]),
  ];
  const got = appearances('p', events, NOW);
  assert.deepEqual(got.map((a) => [a.event.id, a.role, a.past]), [
    ['soon', 'Judge', false],
    ['later', 'Speaker', false],
    ['past2', 'Speaker', true],
    ['past1', 'Judge', true],
  ]);
  assert.deepEqual(appearances('nobody', events, NOW), []);
});

test('followersLine hides small counts and groups the Indian way', () => {
  assert.equal(followersLine(9), null);
  assert.equal(followersLine(10), '10 followers');
  assert.equal(followersLine(1240), '1,240 followers');
  assert.equal(followersLine(100000), '1,00,000 followers');
});

test('barPrice picks the cheapest open tier and says "from" only for several paid ones', () => {
  const t = (name: string, pricePaise: number, soldOut = false) => ({ name, pricePaise, soldOut });
  assert.deepEqual(barPrice({ pricePaise: 10000 }), { paise: 10000, from: false });
  assert.deepEqual(barPrice({ pricePaise: 10000, tiers: [t('Early bird', 100, true), t('Solo', 500)] }), { paise: 500, from: false });
  const paid = [t('Early bird', 29900, true), t('Solo', 49900), t('Team', 179900)];
  assert.deepEqual(barPrice({ pricePaise: 10000, tiers: paid }), { paise: 49900, from: true });
  assert.deepEqual(barPrice({ pricePaise: 10000, tiers: [t('Free', 0), t('Pro', 9900)] }), { paise: 0, from: false });
  assert.deepEqual(barPrice({ pricePaise: 10000, tiers: [t('A', 100, true), t('B', 200, true)] }), { paise: 10000, from: false });
});

test('liveCast groups by typed role in first-seen order, plural only for a group', () => {
  const g = liveCast([
    { id: 'a', role: 'Judge' },
    { id: 'b', role: 'Chief guest' },
    { id: 'c', role: 'judge' },
    { id: 'd', role: 'Mentors' },
    { id: 'e', role: 'Mentors' },
  ]);
  assert.deepEqual(g.map((x) => [x.title, x.people.map((p) => p.id)]), [['Judges', ['a', 'c']], ['Chief guest', ['b']], ['Mentors', ['d', 'e']]]);
  assert.deepEqual(liveCast(undefined), []);
});
