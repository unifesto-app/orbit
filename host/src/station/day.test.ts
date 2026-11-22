import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Claim, HOUR, MIN, dayLabel, door, freeOne, hourWord, hours, openingDay, steps, taken, timeLabel, walkIn, walkInStart } from './day.ts';
import { mockDay, venues } from './mock.ts';

const [cafe, turf] = venues;
const pc = cafe.types[0];
const pitch = turf.types[0];
const day = Date.UTC(2026, 10, 22) - 330 * MIN; // Sun 22 Nov 2026, midnight in India
const at = (h: number, m = 0) => day + h * HOUR + m * MIN;

test('walk-ins start at the current step, floored in India time', () => {
  assert.equal(timeLabel(walkInStart(pc, at(18, 20))), '6:00 PM');
  assert.equal(timeLabel(walkInStart(pc, at(18, 40))), '6:30 PM');
  assert.equal(timeLabel(walkInStart(pitch, at(18, 40))), '6:00 PM');
});

test('days and hours read as the head says them', () => {
  assert.equal(dayLabel(at(18)), 'Sun 22 Nov');
  assert.deepEqual([26, 24, 12, 11, 23].map(hourWord), ['2 AM', 'midnight', 'noon', '11 AM', '11 PM']);
});

test('a café open till 2 AM is still on yesterday at 1 AM', () => {
  assert.equal(openingDay(cafe, at(25)), day);
  assert.equal(openingDay(cafe, at(11)), day);
  assert.equal(steps(cafe, pc, day).length, 30); // 11 AM to 2 AM in half hours
});

test('check-in opens 15 minutes early; a booking can be released 15 minutes in', () => {
  const c: Claim = { id: 'b', type: 'pc', kind: 'booking', count: 2, start: at(18, 30), end: at(20, 30) };
  assert.equal(door(c, at(18, 14)), 'soon');
  assert.equal(door(c, at(18, 15)), 'open');
  assert.equal(door(c, at(18, 40)), 'late');
  assert.equal(door(c, at(18, 45)), 'noShow');
  assert.equal(door({ ...c, checkedIn: at(18, 50) }, at(19)), 'here');
  assert.equal(door({ ...c, released: true }, at(19)), 'released');
  assert.equal(door(c, at(20, 30)), 'missed');
});

test('blocks and walk-ins take stations; released bookings give them back', () => {
  const claims: Claim[] = [
    { id: 'a', type: 'pc', kind: 'booking', count: 10, start: at(19), end: at(21) },
    { id: 'b', type: 'pc', kind: 'block', count: 1, start: at(18), end: at(22), why: 'Repair' },
    { id: 'c', type: 'pc', kind: 'booking', count: 3, start: at(18), end: at(19), released: true },
  ];
  assert.deepEqual(taken(claims, pc, at(19, 30)), { booking: 10, walkin: 0, block: 1, free: 1 });
  assert.equal(taken(claims, pc, at(18)).free, 11);
});

test('a booking beats a walk-in, and the counter says what is free', () => {
  const claims: Claim[] = [{ id: 'a', type: 'pc', kind: 'booking', count: 10, start: at(19), end: at(21) }];
  const fits = walkIn(claims, cafe, pc, at(18, 20), 1, 2);
  assert.ok(fits.ok && timeLabel(fits.claim.start) === '6:00 PM' && timeLabel(fits.claim.end) === '7:00 PM');
  assert.deepEqual(walkIn(claims, cafe, pc, at(18, 20), 2, 3), { ok: false, line: '3 free only until 7:00 PM' });
  assert.deepEqual(walkIn(claims, cafe, pc, at(19, 10), 1, 3), { ok: false, line: 'Only 2 free until 9:00 PM' });
  assert.deepEqual(walkIn(claims, cafe, pc, at(25, 40), 1, 13), { ok: false, line: 'Only 12 free till closing' });
  const full: Claim[] = [{ id: 'a', type: 'football', kind: 'booking', count: 2, start: at(18), end: at(20) }];
  assert.deepEqual(walkIn(full, turf, pitch, at(18, 20), 1, 1), { ok: false, line: 'None free until 8:00 PM' });
});

test("the mock day never oversells, and has someone late and someone due", () => {
  for (const v of venues) {
    const now = at(18, 20);
    const claims = mockDay(v, now);
    for (const t of v.types) for (const s of steps(v, t, openingDay(v, now))) assert.ok(taken(claims, t, s).free >= 0 && taken(claims, t, s).booking + taken(claims, t, s).walkin + taken(claims, t, s).block <= t.count, `${v.id} ${t.id} ${timeLabel(s)}`);
    const doors = claims.filter((c) => c.kind === 'booking').map((c) => door(c, now));
    assert.ok(doors.includes('noShow'), v.id);
    assert.ok(doors.includes('soon') || doors.includes('open'), v.id);
    assert.deepEqual(mockDay(v, now), claims); // the same day every time
  }
});

test('a walk-in freed early this step leaves its station free for the next one', () => {
  const claims: Claim[] = [{ id: 'w', type: 'football', kind: 'walkin', count: 2, start: at(18), end: at(18, 20) }];
  assert.equal(taken(claims, pitch, at(18, 20)).free, 2);
  assert.ok(walkIn(claims, turf, pitch, at(18, 20), 1, 2).ok);
});

test('a shut venue takes no walk-ins, and its mock day stays inside its hours', () => {
  const [, , courts] = venues;
  assert.deepEqual(walkIn([], cafe, pc, at(8), 1, 1), { ok: false, line: 'Opens at 11:00 AM' }); // morning, before opening
  assert.deepEqual(walkIn([], cafe, pc, at(27), 1, 1), { ok: false, line: 'Opens at 11:00 AM' }); // 3 AM, after the night
  assert.deepEqual(walkIn([], courts, courts.types[0], at(23, 30), 1, 1), { ok: false, line: 'Closed for the day' });
  const late = walkIn([], cafe, pc, at(25), 3, 1); // 1 AM: the night's opening, cut at 2 AM
  assert.ok(late.ok && timeLabel(late.claim.end) === '2:00 AM');
  assert.equal(hours(cafe, at(25)).state, 'open');
  for (const now of [at(8), at(25), at(27), at(23, 30)]) {
    for (const v of venues) {
      const { opens, closes } = hours(v, now);
      for (const c of mockDay(v, now)) assert.ok(c.start >= opens && c.end <= closes, `${v.id} at ${timeLabel(now)}`);
    }
  }
});

test('the opening flips at closing: a café at 2 AM, a turf at midnight, courts after 11 PM', () => {
  const [, , courts] = venues;
  assert.deepEqual([hours(cafe, at(25, 59)).state, openingDay(cafe, at(25, 59)) === day], ['open', true]);
  assert.deepEqual([hours(cafe, at(26)).state, openingDay(cafe, at(26)) === day + 24 * HOUR], ['before', true]);
  assert.equal(hours(turf, at(23, 59)).state, 'open');
  assert.deepEqual([hours(turf, at(24)).state, openingDay(turf, at(24)) === day + 24 * HOUR], ['before', true]);
  assert.equal(hours(courts, at(23)).state, 'after');
  assert.equal(hours(courts, at(28, 59)).state, 'before');
});

test('free one early, then a new walk-in in the same step: never more than there are', () => {
  let claims: Claim[] = [{ id: 'w', type: 'football', kind: 'walkin', count: 2, start: at(18), end: at(19) }];
  claims = freeOne(claims, 'football', at(18, 20)); // − frees one pitch at a time
  assert.equal(taken(claims, pitch, at(18, 20)).walkin, 1);
  claims = freeOne(claims, 'football', at(18, 20));
  assert.equal(taken(claims, pitch, at(18, 20)).walkin, 0);
  const again = walkIn(claims, turf, pitch, at(18, 20), 1, 2);
  assert.ok(again.ok && timeLabel(again.claim.start) === '6:20 PM' && timeLabel(again.claim.end) === '7:00 PM');
  claims = [...claims, again.claim];
  for (const s of [at(18), at(18, 20), at(18, 40)]) assert.ok(taken(claims, pitch, s).walkin <= pitch.count, timeLabel(s));
  // Of several, one splits off and the rest play on; with none on now, nothing changes.
  const three: Claim[] = [{ id: 'w', type: 'pc', kind: 'walkin', count: 3, start: at(18), end: at(19) }];
  assert.equal(taken(freeOne(three, 'pc', at(18, 20)), pc, at(18, 20)).walkin, 2);
  assert.deepEqual(freeOne(three, 'pc', at(19, 30)), three);
});

test('a block goes through the same check as a walk-in', () => {
  const claims: Claim[] = [{ id: 'a', type: 'pc', kind: 'booking', count: 12, start: at(19), end: at(20) }];
  assert.deepEqual(walkIn(claims, cafe, pc, at(18, 20), 2, 1), { ok: false, line: '1 free only until 7:00 PM' });
  assert.deepEqual(walkIn([], cafe, pc, at(25, 40), 1, 1).ok, true); // 1:40 AM: the night's last step
});
