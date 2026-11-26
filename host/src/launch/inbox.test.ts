import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Message, badge, dayHeading, inboxDays, kept, readLocally, timeLabel, unreadCount } from './inbox.ts';

const now = Date.parse('2026-11-20T18:40:00+05:30');
const m = (id: string, at: string): Message => ({ id, at: `${at}+05:30`, from: 'Orbit', kind: 'Test', text: '', picture: null });

test('times read in India time', () => {
  assert.equal(timeLabel('2026-11-20T18:12:00+05:30'), '6:12 PM');
  assert.equal(timeLabel('2026-11-20T00:05:00+05:30'), '12:05 AM');
  assert.equal(timeLabel('2026-11-20T06:42:00Z'), '12:12 PM');
});

test('days read Today, Yesterday, then the date, by India calendar day', () => {
  assert.equal(dayHeading('2026-11-20T00:01:00+05:30', now), 'Today');
  assert.equal(dayHeading('2026-11-19T23:59:00+05:30', now), 'Yesterday');
  assert.equal(dayHeading('2026-11-14T10:00:00+05:30', now), 'Sat 14 Nov');
});

test('the inbox runs newest first under a heading per day, and keeps 180 days', () => {
  const days = inboxDays([m('old', '2026-05-23T10:00:00'), m('b', '2026-11-20T11:05:00'), m('c', '2026-11-14T10:00:00'), m('a', '2026-11-20T18:12:00')], now);
  assert.deepEqual(
    days.map((d) => [d.day, d.items.map((x) => x.id)]),
    [
      ['Today', ['a', 'b']],
      ['Sat 14 Nov', ['c']],
    ],
  );
});

test('the count never shows nothing or more than two characters', () => {
  assert.equal(badge(0), null);
  assert.equal(badge(-1), null);
  assert.equal(badge(3), '3');
  assert.equal(badge(9), '9');
  assert.equal(badge(10), '9+');
});

test('180 days are kept to the moment, and a time that doesn’t read is dropped', () => {
  const ids = (ms: Message[]) => kept(ms, now).map((x) => x.id);
  assert.deepEqual(ids([m('179d', '2026-05-25T18:41:00'), m('180d', '2026-05-24T18:40:00'), { ...m('bad', '2026-11-20T10:00:00'), at: 'nope' }]), ['179d']);
});

test('a message dated a little ahead still reads Today, and Yesterday groups', () => {
  assert.equal(dayHeading('2026-11-21T00:10:00+05:30', now), 'Today');
  const days = inboxDays([m('y1', '2026-11-19T09:00:00'), m('y2', '2026-11-19T21:00:00'), m('t', '2026-11-20T12:00:00')], now);
  assert.deepEqual(days.map((d) => [d.day, d.items.map((x) => x.id)]), [['Today', ['t']], ['Yesterday', ['y2', 'y1']]]);
  assert.equal(timeLabel('2026-11-20T12:00:00+05:30'), '12:00 PM');
});

test('the unread count counts only what the Inbox shows', () => {
  const all = [m('a', '2026-11-20T10:00:00'), m('b', '2026-11-19T10:00:00'), m('old', '2026-01-01T10:00:00')];
  assert.equal(unreadCount(all, new Set(), now), 2);
  assert.equal(unreadCount(all, new Set(['a']), now), 1);
});

test('marking read on the phone: the ids given, or all; the count drops by what was new', () => {
  const items = [{ ...m('a', '2026-11-20T10:00:00'), read: false }, { ...m('b', '2026-11-20T11:00:00'), read: true }, { ...m('c', '2026-11-20T12:00:00'), read: false }];
  const some = readLocally(items, 40, ['a', 'b']); // the count is the whole inbox's, past page one
  assert.deepEqual(
    some.items.map((x) => x.read),
    [true, true, false],
  );
  assert.equal(some.newly, 1);
  assert.equal(some.unread, 39);
  assert.equal(readLocally(items, 0, ['a']).unread, 0); // never below zero
  const all = readLocally(items, 40);
  assert.ok(all.items.every((x) => x.read));
  assert.equal(all.unread, 0);
});
