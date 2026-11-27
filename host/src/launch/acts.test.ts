import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type HostCard, MAX_EVENT_ACTS, type TeamAct } from '@orbit/contract';

import { actName, actsBody, actsChanged, addAct, moveAct, pickable, removeAct } from './acts.ts';

const card = (id: string, name = id): HostCard => ({ id, slug: name, name, kind: 'performer', city: null, verified: false, logo: null });
const shown = (id: string): TeamAct => ({ hostId: id, shown: true, name: id, slug: id });
const hidden: TeamAct = { hostId: 'H', shown: false };
const loaded = [shown('a'), hidden, shown('b')];

test('addAct: at the end, never twice (any case), never the own host, never past the cap', () => {
  assert.deepEqual(addAct(loaded, card('c'), 'own').map((a) => a.hostId), ['a', 'H', 'b', 'c']);
  assert.equal(addAct(loaded, card('A'), 'own'), loaded);
  assert.equal(addAct(loaded, card('h'), 'own'), loaded);
  assert.equal(addAct(loaded, card('own'), 'OWN'), loaded);
  const full = Array.from({ length: MAX_EVENT_ACTS }, (_, i) => shown(`x${i}`));
  assert.equal(addAct(full, card('c'), 'own'), full);
});

test('pickable drops who is on and the own host', () => {
  assert.deepEqual(pickable([card('A'), card('own'), card('c'), card('h')], loaded, 'own').map((h) => h.id), ['c']);
});

test('a hidden act moves and goes like any other; the ends stay put', () => {
  assert.deepEqual(moveAct(loaded, 1, -1).map((a) => a.hostId), ['H', 'a', 'b']);
  assert.deepEqual(moveAct(loaded, 1, 1).map((a) => a.hostId), ['a', 'b', 'H']);
  assert.equal(moveAct(loaded, 0, -1), loaded);
  assert.equal(moveAct(loaded, 2, 1), loaded);
  assert.deepEqual(removeAct(loaded, 1).map((a) => a.hostId), ['a', 'b']);
});

test('the body sends the list as loaded and the new one, lowercase; changed only when the order or ids differ', () => {
  const next = moveAct(loaded, 0, 1);
  assert.deepEqual(actsBody(loaded, next), { shown: ['a', 'h', 'b'], hostIds: ['h', 'a', 'b'] });
  assert.ok(actsChanged(loaded, next));
  assert.ok(!actsChanged(loaded, [...loaded]));
  assert.ok(!actsChanged([shown('A')], [shown('a')]));
  assert.equal(actName(hidden), 'Hidden');
  assert.equal(actName(loaded[0]!), 'a');
});
