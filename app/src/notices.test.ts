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
  const event = { event: { id: 'e1', title: 'Open Mic', poster: 'https://x/p.jpg' } };
  assert.deepEqual(toMessage(row({ picture: event }), none).picture, event);
  assert.deepEqual(toMessage(row({ picture: { host: { id: 'h1', name: 'Club', logo: null } } }), none).picture, { host: { id: 'h1', name: 'Club', logo: null } });
  // From an older or newer API: anything else is the orb.
  for (const bad of [{ event: 'e1' }, { event: { id: 'e1', title: 'x', poster: null } }, { host: { id: 'h1' } }, 'x', 3])
    assert.equal(toMessage(row({ picture: bad as never }), none).picture, null, JSON.stringify(bad));
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

test('mergeFirst: rows sharing a millisecond with the page end are never dropped', () => {
  const at = '2026-11-20T00:00:00.000Z';
  // The API ordered z before a (microseconds apart); by id alone a would look newer and be lost.
  const had = [row({ id: 'm', at: '2026-11-21T00:00:00.000Z' }), row({ id: 'z', at }), row({ id: 'a', at })];
  const page: InboxPage = { items: [had[0], had[1]], unread: 0, next: 'cursor-z' };
  assert.deepEqual(mergeFirst(had, 'cursor-a', page).items.map((x) => x.id), ['m', 'z', 'a']);
  // The page's last row is new to the copy: the tie still stays.
  const fresh: InboxPage = { items: [row({ id: 'n', at: '2026-11-22T00:00:00.000Z' }), row({ id: 'y', at })], unread: 0, next: 'cursor-y' };
  assert.deepEqual(mergeFirst(had, 'cursor-a', fresh).items.map((x) => x.id), ['n', 'y', 'z', 'a']);
});

test("announcementOf: the host's newest announcement for that event", () => {
  const ann = (id: string, at: string, event: unknown) => row({ id, at, kind: 'hostAnnouncement', type: 'announcement', opens: { to: 'ticket', event } });
  const rows = [ann('1', '2026-11-20T08:00:00Z', 'e1'), ann('2', '2026-11-21T08:00:00Z', 'e1'), ann('3', '2026-11-22T08:00:00Z', 'e2'), row({ id: '4', at: '2026-11-23T08:00:00Z', opens: { to: 'ticket', event: 'e1' } })];
  assert.equal(announcementOf(rows, 'e1')?.id, '2');
  assert.equal(announcementOf(rows, 'e9'), undefined);
});

test('needsSend: once per sign-in and token', () => {
  assert.equal(needsSend(null, undefined, 'tok'), false); // signed out
  assert.equal(needsSend(null, 'u1#1', null), false); // no token yet
  assert.equal(needsSend(null, 'u1#1', 'tok'), true);
  assert.equal(needsSend({ signIn: 'u1#1', token: 'tok' }, 'u1#1', 'tok'), false);
  assert.equal(needsSend({ signIn: 'u1#1', token: 'tok' }, 'u1#1', 'tok2'), true); // rolled
  assert.equal(needsSend({ signIn: 'u1#1', token: 'tok' }, 'u2#2', 'tok'), true); // another account
  assert.equal(needsSend({ signIn: 'u1#1', token: 'tok' }, 'u1#2', 'tok'), true); // the same account signed in again
});

test('patchFor: just the switch flipped', () => {
  assert.deepEqual(patchFor('push', false), { push: false });
  assert.deepEqual(patchFor('quiet', true), { quiet: true });
  assert.deepEqual(patchFor('push.near', true), { switches: { 'push.near': true } });
  const s = { push: true, quiet: true, switches: { 'push.near': false } } as unknown as NotificationSettings;
  assert.equal(valueOf(withValue(s, 'push.near', true), 'push.near'), true);
  assert.equal(valueOf(withValue(s, 'quiet', false), 'quiet'), false);
});
