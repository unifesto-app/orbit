// Run with `pnpm --filter @orbit/app test`. Pins the Account and ticket rules from the User and Booking flow docs.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calendarLink, canRemove, changeStart, deletesOn, deletionBlockers, isOpen, maskEmail, maskPhone, profileChanges, spacedCode, ticketActions } from './rules.ts';

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

test('Save sends only what changed, and never an empty name', () => {
  const was = { name: 'Keerthi Rao', gender: null };
  assert.equal(profileChanges(was, { name: ' Keerthi Rao ', gender: null }), null);
  assert.deepEqual(profileChanges(was, { name: 'Keerthi R', gender: null }), { name: 'Keerthi R' });
  assert.deepEqual(profileChanges(was, { name: 'Keerthi Rao', gender: 'Woman' }), { gender: 'Woman' });
  assert.deepEqual(profileChanges({ ...was, gender: 'Woman' }, { name: 'Keerthi Rao', gender: null }), { gender: null });
  assert.equal(profileChanges(was, { name: '  ', gender: 'Woman' }), null);
  assert.deepEqual(profileChanges({ name: null, gender: null }, { name: 'Keerthi', gender: null }), { name: 'Keerthi' });
});

test('a number or email change confirms it’s you first, by email while the hold stands', () => {
  const s = { phone: '+919876543210', email: 'k@example.com', fresh: false, heldUntil: null };
  const held = { ...s, heldUntil: '2026-11-24T10:00:00.000Z' };
  assert.deepEqual(changeStart('phone', { ...s, fresh: true }, false), { next: 'new' });
  assert.deepEqual(changeStart('phone', s, false), { next: 'prove', via: 'phone', to: '+919876543210' });
  assert.deepEqual(changeStart('phone', { ...held, fresh: true }, false), { next: 'new' }); // the phone is never held
  assert.deepEqual(changeStart('email', { ...held, fresh: true }, false), { next: 'prove', via: 'email', to: 'k@example.com' });
  // An email added after "Is this you?" can't lift the hold: after its code, wait.
  assert.deepEqual(changeStart('email', { ...held, fresh: true }, true), { next: 'wait', until: '2026-11-24T10:00:00.000Z' });
  assert.deepEqual(changeStart('email', { ...s, phone: null }, false), { next: 'prove', via: 'email', to: 'k@example.com' });
  assert.equal(changeStart('email', { ...s, phone: null, email: null }, false), null);
});
