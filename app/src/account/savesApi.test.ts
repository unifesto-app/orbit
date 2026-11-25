// Pins how the saves answer becomes the session's saves, Undo's body, the calls, and the events kept in memory.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EventCard, MySaves } from '@orbit/contract';

import { confirmed, drawn, fresh, fromServer, queued, refused, savesApi, shown, undoBody, withRead } from './savesApi.ts';
import { save, type Saves } from './saves.ts';
import { cardOf, forgetCards, isKnown, remember } from './seen.ts';

const card = (id: string): EventCard =>
  ({
    id, slug: id, title: id, category: 'comedy', startsAt: '2026-11-27T14:30:00.000Z', endsAt: '2026-11-27T17:30:00.000Z', timezone: 'Asia/Kolkata',
    publishedAt: null, status: 'published', visibility: 'public', place: null, online: true, poster: null, wide: null, wideEdge: null, tone: null,
    pricePaise: 0, tiers: [], host: { id: 'h', slug: 'h', name: 'Host', kind: 'comedy-group', city: null, verified: false, logo: null }, distanceKm: null,
  }) as EventCard;

test('the answer becomes saves with times in milliseconds', () => {
  const r: MySaves = {
    saved: [{ eventId: 'a', at: '2026-11-20T04:30:00.000Z' }],
    lists: [{ id: 'l_x', name: 'Weekend', events: ['a'], touched: '2026-11-21T04:30:00.000Z' }],
    events: [],
  };
  assert.deepEqual(fromServer(r), {
    saved: [{ id: 'a', at: Date.parse('2026-11-20T04:30:00.000Z') }],
    lists: [{ id: 'l_x', name: 'Weekend', events: ['a'], touched: Date.parse('2026-11-21T04:30:00.000Z') }],
  });
});

test('Undo goes out as ISO times and plain lists', () => {
  const u = { saves: [{ id: 'a', at: 1_700_000_000_000 }], lists: { l_x: ['a'] as readonly string[] } };
  assert.deepEqual(undoBody(u), { saves: [{ eventId: 'a', at: '2023-11-14T22:13:20.000Z' }], lists: { l_x: ['a'] } });
});

test('each call is the API route the server serves', async () => {
  const calls: unknown[][] = [];
  const api = { authed: async (...a: unknown[]) => (calls.push(a), { ok: true as const, data: null as never }) };
  const s = savesApi(api as never);
  await s.save('e1');
  await s.remove(['e1']);
  await s.putList('l_a', 'A');
  await s.putList('l_b', 'B', { first: 'e1' });
  await s.putList('l_c', 'C', {});
  await s.deleteList('l_a');
  await s.tick('l_a', 'e1', true);
  await s.tick('l_a', 'e1', false);
  assert.deepEqual(calls, [
    ['PUT', '/me/saves/e1'],
    ['POST', '/me/saves/remove', { eventIds: ['e1'] }],
    ['PUT', '/me/lists/l_a', { name: 'A' }],
    ['PUT', '/me/lists/l_b', { name: 'B', create: true, eventId: 'e1' }],
    ['PUT', '/me/lists/l_c', { name: 'C', create: true }],
    ['DELETE', '/me/lists/l_a'],
    ['PUT', '/me/lists/l_a/events/e1'],
    ['DELETE', '/me/lists/l_a/events/e1'],
  ]);
});

test('seen events: known once remembered, drawn only when known', () => {
  forgetCards();
  assert.equal(isKnown('a'), false);
  remember([card('a'), card('b')]);
  assert.equal(isKnown('a'), true);
  assert.equal(cardOf('b')?.title, 'b');
  assert.deepEqual(drawn(['b', 'missing', 'a']).map((e) => e.id), ['b', 'a']);
});

const empty: Saves = { saved: [], lists: [] };
const star = (id: string) => (s: Saves) => save(s, id, 1, () => true);
const starred = (m: ReturnType<typeof fresh>) => shown(m).saved.map((x) => x.id);

test('replay: two taps offline, both refused, leave neither starred', () => {
  let m = queued(queued(fresh(empty), 1, star('a')), 2, star('b'));
  assert.deepEqual(starred(m), ['a', 'b']);
  m = refused(m, 1);
  assert.deepEqual(starred(m), ['b']); // B is still waiting, drawn without A
  m = refused(m, 2);
  assert.deepEqual(starred(m), []);
});

test('replay: A refused and B confirmed leaves only B', () => {
  let m = queued(queued(fresh(empty), 1, star('a')), 2, star('b'));
  m = refused(m, 1);
  m = confirmed(m, 2);
  assert.deepEqual(m.base.saved.map((x) => x.id), ['b']);
  assert.deepEqual(m.pending, []);
  assert.deepEqual(starred(m), ['b']);
});

test('replay: a read arriving with a change pending keeps that change drawn', () => {
  let m = queued(fresh(empty), 1, star('a'));
  m = withRead(m, { saved: [{ id: 'x', at: 5 }], lists: [] });
  assert.deepEqual(starred(m), ['x', 'a']);
  m = confirmed(m, 1);
  assert.deepEqual(starred(m), ['x', 'a']);
});
