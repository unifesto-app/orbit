import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MyTickets, Ticket } from '@orbit/contract';

import { cacheKey, keptUpcoming, packTicket, statusText, ticketLabel, unpackTicket, upcomingOf } from './tickets.ts';

const NOW = Date.parse('2026-11-24T09:00:00+05:30'); // a Tuesday morning in India

test('ticketLabel: on now, today or tonight, tomorrow, the weekday, then the date, India time', () => {
  assert.equal(ticketLabel('2026-11-24T08:00:00+05:30', NOW), 'On now');
  assert.equal(ticketLabel('2026-11-24T10:30:00+05:30', NOW), 'Today, 10:30 AM');
  assert.equal(ticketLabel('2026-11-24T20:00:00+05:30', NOW), 'Tonight, 8:00 PM');
  assert.equal(ticketLabel('2026-11-24T17:00:00+05:30', NOW), 'Tonight, 5:00 PM');
  assert.equal(ticketLabel('2026-11-25T08:30:00+05:30', NOW), 'Tomorrow, 8:30 AM');
  assert.equal(ticketLabel('2026-11-26T16:00:00+05:30', NOW), 'Thu, 4:00 PM');
  assert.equal(ticketLabel('2026-11-30T23:30:00+05:30', NOW), 'Mon, 11:30 PM');
  assert.equal(ticketLabel('2026-12-01T18:00:00+05:30', NOW), 'Tue 1 Dec, 6:00 PM');
  // Just after midnight UTC is still the same India day; just after midnight India is the next.
  assert.equal(ticketLabel('2026-11-24T18:31:00Z', NOW), 'Tomorrow, 12:01 AM');
  assert.equal(ticketLabel('2026-11-24T18:29:00Z', NOW), 'Tonight, 11:59 PM');
});

test('statusText: plain words for a cancelled booking, nothing for a live one', () => {
  assert.equal(statusText('confirmed'), undefined);
  assert.equal(statusText('cancelled'), 'Cancelled');
  assert.equal(statusText('cancelledByHost'), 'Cancelled by the host');
});

const ticket = (id: string, eventId: string, startsAt: string, status: Ticket['status'] = 'confirmed') =>
  ({ id, status, quantity: 1, qr: 'q', code: 'ABCDEFGH', link: 'l', createdAt: startsAt, cancelledAt: null, ticketType: { id: 't', name: 'General', pricePaise: 0 }, event: { id: eventId, startsAt, endsAt: new Date(Date.parse(startsAt) + 2 * 3_600_000).toISOString() } as Ticket['event'], onlineLink: null }) as Ticket;

test('upcomingOf: the live tickets with their card line', () => {
  const m: MyTickets = { upcoming: [ticket('b1', 'e1', '2026-11-24T20:00:00+05:30')], past: [ticket('b2', 'e2', '2026-11-20T20:00:00+05:30', 'cancelled')] };
  assert.deepEqual(upcomingOf(m, NOW), [{ id: 'b1', eventId: 'e1', label: 'Tonight, 8:00 PM' }]);
  assert.deepEqual(upcomingOf(null, NOW), []);
});

test('the phone copy: only the account that kept it reads it back; junk reads as nothing', () => {
  const t = ticket('b1', 'e1', '2026-11-24T20:00:00+05:30');
  assert.equal(cacheKey('b1'), 'orbit.ticket.b1');
  const raw = packTicket('me', t);
  assert.deepEqual(unpackTicket(raw, 'me'), t);
  assert.equal(unpackTicket(raw, 'someone else'), null);
  assert.equal(unpackTicket(null, 'me'), null);
  assert.equal(unpackTicket('{nope', 'me'), null);
  assert.equal(unpackTicket(JSON.stringify({ owner: 'me', t: { id: 'b1' } }), 'me'), null);
});

test('keptUpcoming: this account’s live tickets whose event hasn’t ended, soonest first', () => {
  const later = ticket('b1', 'e1', '2026-11-26T20:00:00+05:30');
  const on = ticket('b2', 'e2', '2026-11-24T08:00:00+05:30'); // started 8 AM, ends 10 AM: still upcoming at 9
  const ended = ticket('b3', 'e3', '2026-11-23T20:00:00+05:30');
  const gone = ticket('b4', 'e4', '2026-11-27T20:00:00+05:30', 'cancelled');
  const raws = [packTicket('me', later), packTicket('me', on), packTicket('me', ended), packTicket('me', gone), packTicket('other', later), null, 'junk'];
  assert.deepEqual(keptUpcoming(raws, 'me', NOW).map((t) => t.id), ['b2', 'b1']);
});
