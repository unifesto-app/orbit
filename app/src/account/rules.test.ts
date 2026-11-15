// Run with `pnpm --filter @orbit/app test`. Pins the Account and ticket rules from the User and Booking flow docs.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calendarLink, canRemove, deletesOn, deletionBlockers, isOpen, maskEmail, maskPhone, spacedCode, ticketActions } from './rules.ts';

test('masks the phone and email', () => {
  assert.equal(maskPhone('+919876543210'), '+91 98••• ••210');
  assert.equal(maskEmail('keerthi@example.com'), 'k•••@example.com');
});

test('never removes the phone or the last way in', () => {
  assert.equal(canRemove('phone', ['phone', 'email', 'google']), false);
  assert.equal(canRemove('google', ['phone', 'google']), true);
  assert.equal(canRemove('passkey', ['passkey']), false);
});

test('only Refunded and Declined are closed', () => {
  assert.equal(isOpen('With the host'), true);
  assert.equal(isOpen('Refund failed, retrying'), true);
  assert.equal(isOpen('Refunded'), false);
  assert.equal(isOpen('Declined'), false);
});

test('upcoming tickets and started hosts block deletion, unless a refund is open', () => {
  const blockers = deletionBlockers({
    tickets: [
      { eventId: 'a', title: 'Open Mic Night' },
      { eventId: 'b', title: 'Pottery for Beginners' },
    ],
    openRefunds: ['b'],
    hostsStarted: [{ name: 'Clay Days' }],
  });
  assert.deepEqual(blockers, [
    'Archive Clay Days, the host you started',
    'Cancel your ticket for Open Mic Night, or wait until it’s over',
  ]);
  assert.deepEqual(deletionBlockers({ tickets: [], openRefunds: [], hostsStarted: [] }), []);
});

test('deletion runs 30 days later, in India time', () => {
  // 1 AM on 16 Nov in India is still the 15th in UTC, so a UTC date would read a day early.
  assert.equal(deletesOn(Date.parse('2026-11-16T01:00:00+05:30')), '16 Dec');
});

test('a paid ticket can ask for a refund once, a free one can be cancelled, both only before the event', () => {
  const now = Date.parse('2026-11-20T09:00:00+05:30');
  const tonight = '2026-11-20T20:00:00+05:30';
  assert.deepEqual(ticketActions({ paid: true, startsAt: tonight, refundOpen: false, now }), { refund: true, cancel: false });
  assert.deepEqual(ticketActions({ paid: true, startsAt: tonight, refundOpen: true, now }), { refund: false, cancel: false });
  assert.deepEqual(ticketActions({ paid: false, startsAt: tonight, refundOpen: false, now }), { refund: false, cancel: true });
  assert.deepEqual(ticketActions({ paid: true, startsAt: '2026-11-13T20:00:00+05:30', refundOpen: false, now }), { refund: false, cancel: false });
});

test('the calendar link carries the event in UTC, two hours long', () => {
  const link = calendarLink({ title: 'Open Mic Night', startsAt: '2026-11-20T20:00:00+05:30', place: 'The Green Room, Hyderabad' });
  assert.match(link, /dates=20261120T143000Z\/20261120T163000Z/);
  assert.match(link, /text=Open%20Mic%20Night/);
  assert.equal(spacedCode('OM7Q2M9X'), 'OM7Q 2M9X');
});
