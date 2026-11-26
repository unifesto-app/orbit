import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type InboxPage, type InboxRow, KINDS, type NoticeKind, type NotificationSettings } from '@orbit/contract';

import { announcementOf, mergeFirst, needsSend, opensOf, patchFor, toMessage, valueOf, withValue } from './notices.ts';

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 'a',
  at: '2026-11-26T10:00:00.000Z',
  from: 'Orbit',
  kind: 'bookingConfirmed',
  type: 'ticket',
  text: 'Your ticket is ready.',
  picture: null,
  opens: null,
  read: false,
  ...over,
});
const none = () => undefined;

test("toMessage: every kind landing in the people app's inbox gets a label and its catalog type", () => {
  const kinds = (Object.keys(KINDS) as NoticeKind[]).filter((k) => KINDS[k].app === 'orbit');
  assert.ok(kinds.length > 40);
  for (const kind of kinds) {
    const m = toMessage(row({ kind, type: KINDS[kind].type }), none);
    assert.ok(m.kind && m.kind !== 'Notification', kind);
    assert.equal(m.type, KINDS[kind].type, kind);
  }
  assert.equal(toMessage(row({ kind: 'eventTomorrow', type: 'reminder' }), none).kind, 'Tomorrow');
  assert.equal(toMessage(row({ kind: 'hostAnnouncement', type: 'announcement' }), none).kind, 'Announcement');
});

test('toMessage: a kind or type this build has never seen still draws', () => {
  const m = toMessage(row({ kind: 'somethingNew' as NoticeKind, type: 'reminder' }), none);
  assert.equal(m.kind, 'Reminder');
  const odd = toMessage(row({ kind: 'somethingNew' as NoticeKind, type: 'weird' as InboxRow['type'] }), none);
  assert.deepEqual([odd.kind, odd.type], ['Notification', 'account']);
});

test('toMessage: where it opens, and a bad opens or picture is nothing', () => {
  const ticketOf = (e: string) => (e === 'e1' ? 'bk1' : undefined);
  assert.equal(toMessage(row({ opens: { to: 'ticket', event: 'e1' } }), ticketOf).href, '/ticket/bk1');
  assert.equal(toMessage(row({ opens: { to: 'ticket', event: 'e2' } }), ticketOf).href, '/event/e2');
  assert.equal(toMessage(row({ opens: { to: 'security' } }), none).href, '/account/security');
  for (const bad of [null, 'security', 42, [], {}, { to: 'nowhere' }, { to: 'event' }, { to: 'event', event: 7 }, { to: 'host', host: '' }, { to: 'event', event: '/x?y' }, { to: 'event', event: '/evil.example' }]) {
    assert.equal(toMessage(row({ opens: bad }), none).href, null, JSON.stringify(bad));
  }
  assert.equal(opensOf({ to: 'slot', venue: 'v1', extra: 1 })?.to, 'slot');
  assert.deepEqual(toMessage(row({ picture: { event: 'e1' } }), none).picture, { event: 'e1' });
  assert.equal(toMessage(row({ picture: { event: 3 } }), none).picture, null);
  assert.equal(toMessage(row({ picture: 'x' }), none).picture, null);
  assert.equal(toMessage(row({ read: true }), none).unread, false);
});

test('mergeFirst: a refresh keeps the older pages already read in', () => {
  const r = (id: string, at: string) => row({ id, at: `2026-11-${at}T00:00:00.000Z` });
  const had = [r('d', '20'), r('c', '19'), r('b', '18'), r('a', '17')];
  // The first page now: a new one on top, ending at c; b and a were loaded from later pages.
  const page: InboxPage = { items: [r('e', '21'), r('d', '20'), r('c', '19')], unread: 1, next: 'cursor-c' };
  assert.deepEqual(mergeFirst(had, 'cursor-a', page), { items: [page.items[0], page.items[1], page.items[2], had[2], had[3]], next: 'cursor-a' });
  // Nothing older loaded: the page and its cursor.
  assert.deepEqual(mergeFirst([], null, page), { items: page.items, next: 'cursor-c' });
  // The last page: it's the whole inbox.
  assert.deepEqual(mergeFirst(had, 'cursor-a', { ...page, next: null }), { items: page.items, next: null });
});

test("announcementOf: the host's newest announcement for that event", () => {
  const ann = (id: string, at: string, event: unknown) => row({ id, at, kind: 'hostAnnouncement', type: 'announcement', opens: { to: 'ticket', event } });
  const rows = [ann('1', '2026-11-20T08:00:00Z', 'e1'), ann('2', '2026-11-21T08:00:00Z', 'e1'), ann('3', '2026-11-22T08:00:00Z', 'e2'), row({ id: '4', at: '2026-11-23T08:00:00Z', opens: { to: 'ticket', event: 'e1' } })];
  assert.equal(announcementOf(rows, 'e1')?.id, '2');
  assert.equal(announcementOf(rows, 'e9'), undefined);
});

test('needsSend: once per account and token', () => {
  assert.equal(needsSend(null, undefined, 'tok'), false); // signed out
  assert.equal(needsSend(null, 'u1', null), false); // no token yet
  assert.equal(needsSend(null, 'u1', 'tok'), true);
  assert.equal(needsSend({ user: 'u1', token: 'tok' }, 'u1', 'tok'), false);
  assert.equal(needsSend({ user: 'u1', token: 'tok' }, 'u1', 'tok2'), true); // rolled
  assert.equal(needsSend({ user: 'u1', token: 'tok' }, 'u2', 'tok'), true); // another account
});

test('patchFor: just the switch flipped', () => {
  assert.deepEqual(patchFor('push', false), { push: false });
  assert.deepEqual(patchFor('quiet', true), { quiet: true });
  assert.deepEqual(patchFor('push.near', true), { switches: { 'push.near': true } });
  const s = { push: true, quiet: true, switches: { 'push.near': false } } as unknown as NotificationSettings;
  assert.equal(valueOf(withValue(s, 'push.near', true), 'push.near'), true);
  assert.equal(valueOf(withValue(s, 'quiet', false), 'quiet'), false);
});
