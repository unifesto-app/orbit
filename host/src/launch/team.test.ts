import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inviteLine, mustWait, spokenContact, statusMoves, statusNote, teamLine } from './team.ts';
import type { Sales } from './money.ts';

const at = (iso: string) => Date.parse(`${iso}+05:30`);

test('a waiting invite says how old it is and how long it has left of its 14 days', () => {
  const sent = '2026-11-18T18:40:00+05:30';
  assert.equal(inviteLine(sent, at('2026-11-20T18:40:00')), 'Invited 2 days ago · 12 days left');
  assert.equal(inviteLine(sent, at('2026-11-18T19:00:00')), 'Invited today · 14 days left');
  assert.equal(inviteLine(sent, at('2026-11-19T19:00:00')), 'Invited yesterday · 13 days left');
  assert.equal(inviteLine(sent, at('2026-12-01T19:00:00')), 'Invited 13 days ago · 1 day left');
  assert.equal(inviteLine(sent, at('2026-12-02T18:40:00')), 'Expired');
});

test('an event’s team in a line', () => {
  assert.equal(teamLine({ lead: 'Arjun Rao', crew: 1 }, 1), 'Arjun Rao leads · 1 Crew · 1 invited');
  assert.equal(teamLine({ crew: 2 }, 0), '2 Crew');
  assert.equal(teamLine(undefined, 0), 'No team yet');
  assert.equal(teamLine(undefined, 2), '2 invited');
});

test('invites count India calendar days, and a bad or early time never misleads', () => {
  assert.equal(inviteLine('2026-11-16T18:00:00+05:30', at('2026-11-17T17:00:00')), 'Invited yesterday · 14 days left');
  assert.equal(inviteLine('2026-11-16T23:50:00+05:30', at('2026-11-17T09:00:00')), 'Invited yesterday · 14 days left');
  assert.equal(inviteLine('2026-11-16T09:00:00+05:30', at('2026-11-18T08:00:00')), 'Invited 2 days ago · 13 days left');
  assert.equal(inviteLine('2026-11-20T18:45:00+05:30', at('2026-11-20T18:40:00')), 'Invited today · 14 days left'); // sent 5 minutes "ahead"
  assert.equal(inviteLine('', at('2026-11-20T18:40:00')), 'Invited');
});

test('a masked number is read as its last digits', () => {
  assert.equal(spokenContact('+91 ••••• ••417'), 'number ending 417');
  assert.equal(spokenContact('sana@example.com'), 'sana@example.com');
});

const sale = (over: Partial<Sales>): Sales => ({
  eventId: 'e', endsAt: '2026-11-13T23:00:00+05:30', booked: 0, seats: 40, checkedIn: 0, salesPaise: 0, commissionPaise: 0,
  feesPaise: 0, feeBy: 'buyers', refundedPaise: 0, paidOutPaise: 0, openRefundsPaise: 0, refundsWaiting: 0, ...over,
});

test('pausing waits for events with bookings to end and refunds to close', () => {
  const now = at('2026-11-20T18:40:00');
  assert.equal(mustWait([sale({ booked: 31, endsAt: '2026-11-20T23:00:00+05:30' })], now), true);
  assert.equal(mustWait([sale({ refundsWaiting: 1 })], now), true);
  assert.equal(mustWait([sale({ booked: 38 }), sale({ booked: 0, endsAt: '2026-11-27T23:00:00+05:30' })], now), false);
});

test('status moves: who gets which, and Not yet while they must wait', () => {
  const labels = (r: { label: string; value?: string; open: boolean }[]) => r.map((m) => `${m.label}${m.value ? `: ${m.value}` : ''}${m.open ? ' >' : ''}`);
  assert.deepEqual(labels(statusMoves('live', true, false)), ['Pause host >', 'Archive host >']);
  assert.deepEqual(labels(statusMoves('live', true, true)), ['Pause host: Not yet', 'Archive host: Not yet']);
  assert.deepEqual(labels(statusMoves('paused', true, true)), ['Resume host >', 'Archive host: Not yet']);
  assert.deepEqual(labels(statusMoves('archived', true, false)), ['Restore host >']);
  assert.deepEqual(statusMoves('suspended', true, false), []);
  assert.deepEqual(statusMoves('live', false, false), []);
  // Each move posts to its own route: POST /hosts/:id/<action>.
  const actions = (s: Parameters<typeof statusMoves>[0]) => statusMoves(s, true, false).map((m) => m.action);
  assert.deepEqual(actions('live'), ['pause', 'archive']);
  assert.deepEqual(actions('paused'), ['resume', 'archive']);
  assert.deepEqual(actions('archived'), ['restore']);
  assert.match(statusNote('live', false, false)!, /Only the owner/);
  assert.match(statusNote('live', true, true)!, /waits till/);
  assert.equal(statusNote('archived', true, false), undefined);
  assert.match(statusNote('suspended', true, false)!, /suspended/);
});
