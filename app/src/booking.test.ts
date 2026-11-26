import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answered, bookingDays, firstTeam, freeAt, holdLeft, liveTiers, teamFits, teamNameOk, maxGuests, maxTickets, mmss, slotLine, slotPrice, startTimes, ticketMax } from './booking.ts';
import { venues } from './kinds.ts';

const NOW = Date.parse('2026-11-20T09:00:00+05:30'); // a Friday morning in India
const at = (iso: string) => Date.parse(`${iso}+05:30`);
const respawn = venues['respawn-zone']!;
const kickoff = venues['kickoff-arena']!;
const smash = venues['smash-court']!;
const [pc, ps5] = respawn.stations;

test('you can book today and the next 13 days', () => {
  const days = bookingDays(NOW);
  assert.equal(days.length, 14);
  assert.deepEqual(days.slice(0, 3).map((d) => d.label), ['Today', 'Tomorrow', 'Sun 22 Nov']);
  assert.equal(days[0]!.start, at('2026-11-20T00:00:00'));
});

test('gaming starts every 30 minutes, pitches and courts on the hour, none in the past, all before closing', () => {
  const today = bookingDays(NOW)[0]!.start;
  const gaming = startTimes(respawn, today, NOW);
  assert.equal(gaming[0], at('2026-11-20T11:00:00'));
  assert.equal(gaming[1], at('2026-11-20T11:30:00'));
  assert.equal(gaming.at(-1), at('2026-11-20T23:30:00')); // a calendar day: after midnight is tomorrow's
  const tomorrow = startTimes(respawn, bookingDays(NOW)[1]!.start, NOW);
  assert.deepEqual(tomorrow.slice(0, 4), [at('2026-11-21T00:00:00'), at('2026-11-21T00:30:00'), at('2026-11-21T01:00:00'), at('2026-11-21T11:00:00')]); // Friday's late hours, then Saturday's
  const turf = startTimes(kickoff, today, NOW);
  assert.equal(turf[0], at('2026-11-20T09:00:00'));
  assert.equal(turf.length, 15); // 9 AM to 11 PM
  assert.equal(startTimes(kickoff, today, NOW, 2).at(-1), at('2026-11-20T22:00:00')); // two hours must fit before midnight
});

test("after midnight, Today still offers the night's last hours; the 14th day ends at its midnight", () => {
  const late = at('2026-11-21T00:20:00'); // 12:20 AM on Saturday
  const today = bookingDays(late)[0]!.start;
  assert.equal(today, at('2026-11-21T00:00:00'));
  assert.deepEqual(startTimes(respawn, today, late).slice(0, 3), [at('2026-11-21T00:30:00'), at('2026-11-21T01:00:00'), at('2026-11-21T11:00:00')]);
  const last = bookingDays(NOW)[13]!.start;
  assert.ok(startTimes(respawn, last, NOW).every((t) => t < last + 86_400_000));
});

test('each hour has its own rate: off-peak only in its window, and weekdays only where it says so', () => {
  assert.equal(slotPrice(pc!, at('2026-11-20T14:00:00'), 2, 3), 12000 * 2 * 3); // Friday, both hours off-peak
  assert.equal(slotPrice(pc!, at('2026-11-20T15:00:00'), 2, 3), (12000 + 16200) * 3); // the second hour is past 4 PM
  assert.equal(slotPrice(pc!, at('2026-11-21T14:00:00'), 1, 1), 16200); // Saturday: no off-peak
  assert.equal(slotPrice(smash.stations[0]!, at('2026-11-21T11:00:00'), 1), 35000); // every day 10 to 4
  assert.equal(slotPrice(ps5!, at('2026-11-21T18:00:00'), 2, 1, true), 35000 * 2); // two on one PS5
  assert.equal(slotPrice(pc!, at('2026-11-20T15:30:00'), 1, 1), 12000 / 2 + 16200 / 2); // half before 4 PM, half after
});

test("the ticket's line: a count of stations for gaming, the pitch alone for a turf", () => {
  assert.equal(slotLine(respawn, pc!, at('2026-11-21T18:30:00'), 2, 3), '3 × PC, Sat 21 Nov, 6:30 to 8:30 PM');
  assert.equal(slotLine(kickoff, kickoff.stations[0]!, at('2026-11-21T19:00:00'), 1), '5-a-side football, Sat 21 Nov, 7:00 to 8:00 PM');
  // Across noon or midnight the start keeps its AM or PM.
  assert.equal(slotLine(kickoff, kickoff.stations[0]!, at('2026-11-21T11:00:00'), 2), '5-a-side football, Sat 21 Nov, 11:00 AM to 1:00 PM');
  assert.equal(slotLine(respawn, pc!, at('2026-11-21T23:00:00'), 2, 1), '1 × PC, Sat 21 Nov, 11:00 PM to 1:00 AM');
});

test('free stations stay between none and all; 18+ and 21+ book one ticket and add nobody', () => {
  for (let h = 0; h < 48; h++) {
    const n = freeAt(pc!, at('2026-11-20T00:00:00') + h * 1_800_000, 2);
    assert.ok(n >= 0 && n <= pc!.count);
  }
  assert.equal(maxTickets('18+'), 1);
  assert.equal(maxTickets(), 10);
  assert.equal(maxGuests('21+'), 0);
  assert.equal(maxGuests(), 9);
});

test('the hold counts down from ten minutes and stops at nothing', () => {
  assert.equal(mmss(holdLeft(0, 30_000)), '9:30');
  assert.equal(holdLeft(0, 11 * 60_000), 0);
  assert.equal(mmss(0), '0:00');
});

test('a ticket type can take no more than the booking limit and the seats left; a team ticket takes its team', () => {
  const tiers = [{ soldOut: true }, {}, { seats: 4 }]; // early bird gone, solo, team of 4
  assert.equal(ticketMax(tiers, [0, 0, 0], 0, {}), 0); // sold out
  assert.equal(ticketMax(tiers, [0, 0, 0], 1, {}), 10); // no seat count: the booking's 10
  assert.equal(ticketMax(tiers, [0, 0, 0], 1, { left: 8 }), 8);
  assert.equal(ticketMax(tiers, [0, 3, 0], 1, { left: 8 }), 8); // 3 picked, 5 more fit
  assert.equal(ticketMax(tiers, [0, 0, 0], 2, { left: 8 }), 2); // two teams of 4
  assert.equal(ticketMax(tiers, [0, 5, 0], 2, { left: 8 }), 0); // 3 seats left: no team fits
  assert.equal(ticketMax(tiers, [0, 0, 1], 1, { left: 8 }), 4); // a team took 4
  assert.equal(ticketMax(tiers, [0, 0, 0], 1, { age: '18+', left: 8 }), 1); // 18+: one each
});

test('a booking goes on once every required question is answered, blank text not counting', () => {
  const asks = [
    { id: 'building', required: true },
    { id: 'stage', required: true },
    { id: 'note', required: false },
  ];
  assert.equal(answered(asks, {}), false);
  assert.equal(answered(asks, { building: '  ', stage: 'Building' }), false);
  assert.equal(answered(asks, { building: 'A payroll app', stage: 'Building' }), true);
  assert.equal(answered([], {}), true);
});

test('a team name is 1 to 40 letters once trimmed', () => {
  assert.equal(teamNameOk('  '), false);
  assert.equal(teamNameOk(' Null Pointers '), true);
  assert.equal(teamNameOk('x'.repeat(40)), true);
  assert.equal(teamNameOk('x'.repeat(41)), false);
});

test('a hackathon starts on the biggest team that fits, and on none when nothing does', () => {
  const tiers = [{ soldOut: true }, { seats: 2 }, { seats: 4 }]; // one gone, a team of 2, a team of 4
  assert.equal(firstTeam(tiers, { left: 8 }), 2);
  assert.equal(firstTeam(tiers, { left: 3 }), 1); // four seats don't fit in three, two do
  assert.equal(teamFits(tiers, 2, { left: 3 }), false);
  assert.equal(firstTeam(tiers, { left: 0 }), -1);
  assert.equal(firstTeam([{ soldOut: true }], {}), -1);
});

test('liveTiers: why a type is off, the first that holds, and the most one booking takes', () => {
  const now = Date.parse('2026-11-24T09:00:00+05:30');
  const base = { id: 't', name: 'General', pricePaise: 0, quantity: 50, left: 50, salesStartAt: null, salesEndAt: null, note: null, perPersonLimit: 4 };
  const off = (t: Partial<typeof base> | Record<string, unknown>) => liveTiers([{ ...base, ...t } as typeof base], now)[0]!.off;
  const later = '2026-11-28T10:00:00+05:30';
  const before = '2026-11-20T10:00:00+05:30';
  assert.equal(off({}), undefined);
  assert.equal(off({ pricePaise: 29900 }), undefined); // paid books too (X3)
  assert.equal(off({ salesStartAt: later, left: 0 }), 'Opens Sat 28 Nov'); // not open yet beats sold out
  assert.equal(off({ salesEndAt: before, left: 0 }), 'Closed');
  assert.equal(off({ left: 0 }), 'Sold out');
  const max = (t: Record<string, unknown>) => liveTiers([{ ...base, ...t } as typeof base], now)[0]!.max;
  assert.equal(max({}), 4); // the per-person limit
  assert.equal(max({ left: 2 }), 2); // the seats left
  assert.equal(max({ left: null, quantity: null, perPersonLimit: 10 }), 10); // no limit: 10, a booking's most
  assert.equal(max({ left: -1 }), 0);
});
