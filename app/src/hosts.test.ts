// Run with `pnpm --filter @orbit/app test`. Pins how real hosts are told apart, drawn and asked for.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { HostPage } from '@orbit/contract';

import { drawHost, hostsApi, isReal, kindLabel, markOf, ownerMoves } from './hosts.ts';

const ID = '3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b';

test('a host is real when its id is a UUID; mock ids stay mock', () => {
  assert.equal(isReal(ID), true);
  for (const id of ['punchline', 'circuitfeed', '', `${ID}x`, ID.toUpperCase()]) assert.equal(isReal(id), false, id);
});

test('a real host draws as its initials on a colour fixed by its id', () => {
  assert.equal(markOf({ id: ID, name: 'Punchline Collective' }).initials, 'PC');
  assert.equal(markOf({ id: ID, name: '  jam   circle hyderabad ' }).initials, 'JC');
  assert.equal(markOf({ id: ID, name: 'Respawn' }).initials, 'R');
  assert.equal(markOf({ id: ID, name: '(The) Clay Days' }).initials, 'TC');
  assert.equal(markOf({ id: ID, name: '— ★ —' }).initials, '?');
  assert.equal(markOf({ id: ID, name: 'उड़ान फेस्ट' }).initials, 'उफ');
  const a = markOf({ id: ID, name: 'A' }), b = markOf({ id: ID, name: 'Another name' });
  assert.deepEqual([a.bg, a.fg], [b.bg, b.fg]); // the colour follows the id, not the name
});

test("kinds read as the Hosts doc's words", () => {
  assert.equal(kindLabel('comedy-group'), 'Comedy group');
  assert.equal(kindLabel('cafe-meetup'), 'Café meetup');
  assert.equal(kindLabel('something-new'), 'Host');
});

test("Console's host carries what its screens draw, and the owner's moves follow the status", () => {
  const page: HostPage = {
    id: ID, slug: 'punchline-x', name: 'Punchline Collective', kind: 'comedy-group', city: 'Hyderabad', verified: false,
    about: null, website: null, logo: null, banner: null, parent: null, clubs: [],
    status: 'paused', visibility: 'public', suspendReason: null, followers: 3, owner: true,
  };
  const h = drawHost(page);
  assert.equal(h.initials, 'PC');
  assert.equal(h.kind, 'Comedy group');
  assert.equal(h.area, 'Hyderabad');
  assert.equal(h.followers, 3);
  assert.deepEqual(ownerMoves[h.status], ['resume', 'archive']);
  assert.deepEqual(ownerMoves.suspended, []);
});

test('signed out, the public read never touches the session; signed in, it goes as the account', async () => {
  const calls: string[] = [];
  const fake = {
    call: async (m: string, p: string) => (calls.push(`call ${m} ${p}`), { ok: true as const, data: null as never }),
    authed: async (m: string, p: string, b?: unknown) => (calls.push(`authed ${m} ${p}${b ? ` ${JSON.stringify(b)}` : ''}`), { ok: true as const, data: null as never }),
  };
  const h = hostsApi(fake);
  await h.publicHost('punchline-x', false);
  await h.publicHost('a b', true);
  await h.follow(ID, true);
  await h.follow(ID, false);
  await h.find('jam & co');
  await h.verify(ID, 'checked the site', 'Jam Circle');
  await h.move(ID, 'pause');
  assert.deepEqual(calls, [
    'call GET /public/hosts/punchline-x',
    'authed GET /public/hosts/a%20b',
    `authed POST /hosts/${ID}/follow`,
    `authed DELETE /hosts/${ID}/follow`,
    'authed GET /galaxy/hosts?q=jam%20%26%20co',
    `authed POST /galaxy/hosts/${ID}/verify {"reason":"checked the site","name":"Jam Circle"}`,
    `authed POST /hosts/${ID}/pause`,
  ]);
});
