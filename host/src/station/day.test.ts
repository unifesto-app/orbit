import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Claim, HOUR, MIN, admit, admitTo, byCode, dayLabel, door, freeOne, hourWord, hours, openingDay, outside, scan, seenRecently, steps, stranded, taken, timeLabel, walkIn, walkInStart } from './day.ts';
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
  assert.equal(door({ ...c, released: at(18, 30) }, at(19)), 'released');
  assert.equal(door(c, at(20, 30)), 'missed');
});

test('blocks and walk-ins take stations; released bookings give them back', () => {
  const claims: Claim[] = [
    { id: 'a', type: 'pc', kind: 'booking', count: 10, start: at(19), end: at(21) },
    { id: 'b', type: 'pc', kind: 'block', count: 1, start: at(18), end: at(22), why: 'Repair' },
    { id: 'c', type: 'pc', kind: 'booking', count: 3, start: at(18), end: at(19), released: at(18, 30) },
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

test('the scanner: one is in on the scan, several are asked how many, then Already in', () => {
  const [, , courts] = venues;
  const three: Claim = { id: 'b', type: 'pc', kind: 'booking', count: 3, start: at(18, 30), end: at(20, 30), who: 'Meera P.', code: 'RZ7Q2M9X' };
  const ours = (claim: Claim) => ({ claim, ours: true });
  assert.deepEqual(scan(ours(three), cafe, at(18, 14)), { kind: 'early', starts: at(18, 30) }); // Too early · starts 6:30 PM
  assert.deepEqual(scan(ours(three), cafe, at(18, 15)), { kind: 'ask', left: 3 });
  const two = admit(three, 2, at(18, 20), 'Ravi');
  assert.deepEqual(scan(ours(two), cafe, at(18, 40)), { kind: 'ask', left: 1 });
  const all = admit(two, 1, at(18, 50), 'Sana');
  assert.deepEqual([all.in, all.checkedIn, all.by], [3, at(18, 20), 'Ravi']); // the first time and who stay
  assert.deepEqual(scan(ours(all), cafe, at(19)), { kind: 'already', first: at(18, 20), by: 'Ravi' });
  assert.deepEqual(scan(ours(all), cafe, at(20, 30)), { kind: 'ended' }); // a late arrival still ends at the booked end
  assert.deepEqual(scan(ours({ ...three, released: at(18, 45) }), cafe, at(18, 50)), { kind: 'released', at: at(18, 45) });
  assert.deepEqual(scan(ours({ ...three, refunded: true }), cafe, at(18, 50)), { kind: 'refunded' });
  assert.deepEqual(scan({ claim: three, ours: false }, cafe, at(18, 50)), { kind: 'elsewhere' });
  assert.deepEqual(scan(undefined, cafe, at(18, 50)), { kind: 'unknown' });
  // One PS5, or a pitch or court booked whole: in on the scan, nobody counted.
  assert.deepEqual(scan(ours({ ...three, type: 'ps5', count: 1 }), cafe, at(18, 30)), { kind: 'in', n: 1 });
  assert.deepEqual(scan(ours({ ...three, type: 'football', count: 1 }), turf, at(18, 30)), { kind: 'in', n: 1 });
  assert.deepEqual(scan(ours({ ...three, type: 'badminton', count: 2 }), courts, at(18, 30)), { kind: 'in', n: 2 });
});

test('a scanned QR or a typed code finds its booking, however it is spaced', () => {
  const claims: Claim[] = [
    { id: 'a', type: 'pc', kind: 'booking', count: 1, start: at(18), end: at(19), code: 'RZ7Q2M9X' },
    { id: 'w', type: 'pc', kind: 'walkin', count: 1, start: at(18), end: at(19) },
  ];
  assert.equal(byCode(claims, 'rz7q 2m9x')?.id, 'a');
  assert.equal(byCode(claims, 'orbit:RZ7Q-2M9X')?.id, 'a'); // a QR holding more than the code
  assert.equal(byCode(claims, 'RZ7Q'), undefined); // too short to be a code
  assert.equal(byCode(claims, 'KA000000'), undefined);
});

test('letting in never goes past the booking, and a double tap counts once', () => {
  const three: Claim = { id: 'b', type: 'pc', kind: 'booking', count: 3, start: at(18, 30), end: at(20, 30) };
  assert.equal(admit(three, 5, at(18, 20), 'Ravi').in, 3);
  assert.equal(admit(three, 0, at(18, 20), 'Ravi').in, 0);
  const one = admitTo(three, 1, at(18, 20), 'Ravi');
  assert.equal(admitTo(admitTo(three, 1, at(18, 20), 'you'), 1, at(18, 20), 'you').in, 1); // "Let 1 in" tapped twice
  assert.equal(admitTo(admitTo(one, 0, at(18, 21), 'you'), 1, at(18, 21), 'you').in, 1); // never fewer than are in
});

test('the scanner checks in order: refunded, released, ended, early, already', () => {
  const c: Claim = { id: 'b', type: 'pc', kind: 'booking', count: 2, start: at(18, 30), end: at(19, 30) };
  const ours = (claim: Claim) => ({ claim, ours: true });
  assert.equal(scan(ours({ ...c, refunded: true }), cafe, at(20)).kind, 'refunded'); // refunded and ended
  assert.equal(scan(ours({ ...c, released: at(18, 45) }), cafe, at(20)).kind, 'released'); // released and ended
  assert.equal(scan(ours(admit(c, 2, at(18, 35), 'Ravi')), cafe, at(18, 14)).kind, 'early'); // early wins over in
  const pitches: Claim = { ...c, type: 'football', count: 2, in: 1 }; // a whole booking partly in: the rest, on the scan
  assert.deepEqual(scan(ours(pitches), turf, at(18, 40)), { kind: 'in', n: 1 });
});

test('a code needs a booking: walk-ins and blocks never match', () => {
  const claims: Claim[] = [{ id: 'w', type: 'pc', kind: 'walkin', count: 1, start: at(18), end: at(19), code: 'RZ7Q2M9X' }];
  assert.equal(byCode(claims, 'RZ7Q2M9X'), undefined);
});

test('the same ticket is ignored for 2.5 seconds, each code on its own clock', () => {
  const seen = new Map<string, number>();
  const t = at(18, 20);
  assert.equal(seenRecently(seen, 'A', t), false);
  assert.equal(seenRecently(seen, 'B', t + 100), false);
  assert.equal(seenRecently(seen, 'A', t + 200), true); // two held up together don't take turns
  assert.equal(seenRecently(seen, 'B', t + 300), true);
  assert.equal(seenRecently(seen, 'A', t + 2000), true); // still in view: it stays ignored
  assert.equal(seenRecently(seen, 'A', t + 4600), false); // away 2.6 seconds: seen afresh
});

test('fewer stations or shorter hours are refused while bookings stand in the way, and name them', () => {
  const claims: Claim[] = [
    { id: 'a', type: 'pc', kind: 'booking', count: 8, start: at(19), end: at(21), who: 'Meera P.' },
    { id: 'b', type: 'pc', kind: 'booking', count: 3, start: at(20), end: at(22), who: 'Rohit G.' },
    { id: 'c', type: 'pc', kind: 'booking', count: 4, start: at(23), end: at(24), who: 'Sneha J.' },
    { id: 'w', type: 'pc', kind: 'walkin', count: 4, start: at(20), end: at(21) }, // the desk can free a walk-in
    { id: 'r', type: 'pc', kind: 'booking', count: 9, start: at(20), end: at(21), released: at(19) }, // gone
  ];
  const now = at(18, 20);
  assert.deepEqual(stranded(claims, pc, 12, now).map((c) => c.id), []);
  assert.deepEqual(stranded(claims, pc, 10, now).map((c) => c.id), ['a', 'b']); // 8 + 3 at 8 PM
  assert.deepEqual(stranded(claims, pc, 3, now).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(stranded(claims, pc, 12, at(22, 30)).map((c) => c.id), []); // played already: nothing in the way
  // Hours: closing at 11 PM strands the late booking; closed strands all three; the night past midnight counts too.
  assert.deepEqual(outside(claims, day, [11, 23], now).map((c) => c.id), ['c']);
  assert.deepEqual(outside(claims, day, null, now).map((c) => c.id), ['a', 'b', 'c']);
  const late: Claim[] = [{ id: 'n', type: 'pc', kind: 'booking', count: 1, start: at(25), end: at(26) }];
  assert.deepEqual(outside(late, day, [11, 25], now).map((c) => c.id), ['n']);
});
