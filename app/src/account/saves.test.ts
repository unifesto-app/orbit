// Pins the Saved events and lists rules (Saved events and lists doc).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FULL, GONE, MAX_LISTS, MAX_SAVED, TOO_MANY, byTouched, create, drop, nameLength, nameProblem, normalise, rename, restore, save, split, tick, unsave } from './saves.ts';
import type { List, Saves } from './saves.ts';

const all = () => true;
const list = (id: string, name: string, events: string[] = [], touched = 0): List => ({ id, name, events, touched });
const full = (): Saves => ({ saved: Array.from({ length: MAX_SAVED }, (_, i) => ({ id: `e${i}`, at: i })), lists: [] });

test('save adds once, stops at the cap, and ignores hidden events in the count', () => {
  const s: Saves = { saved: [], lists: [] };
  const one = save(s, 'a', 1, all) as Saves;
  assert.deepEqual(one.saved, [{ id: 'a', at: 1 }]);
  assert.equal(save(one, 'a', 2, all), one);
  assert.equal(save(full(), 'new', 5, all), FULL);
  assert.notEqual(save(full(), 'new', 5, (id) => id !== 'e0' && id !== 'e1'), FULL);
  assert.notEqual(save(full(), 'new', 5, () => false), FULL);
});

test('unsave removes from saved and every list; restore puts back the same saves and memberships', () => {
  const s: Saves = { saved: [{ id: 'a', at: 1 }, { id: 'b', at: 2 }], lists: [list('l1', 'One', ['a', 'b']), list('l2', 'Two', ['a'])] };
  const { next, undo } = unsave(s, ['a']);
  assert.deepEqual(next.saved, [{ id: 'b', at: 2 }]);
  assert.deepEqual(next.lists.map((l) => l.events), [['b'], []]);
  const back = restore(next, undo);
  assert.deepEqual(back.saved, s.saved);
  assert.deepEqual(back.lists.map((l) => [...l.events].sort()), [['a', 'b'], ['a']]); // membership, not order within a list
  assert.equal(back.saved[0], s.saved[0]);
});

test('restore keeps what changed since: a new save, a deleted list, and date order', () => {
  const s: Saves = { saved: [{ id: 'a', at: 5 }, { id: 'b', at: 10 }], lists: [list('l1', 'One', ['a']), list('l2', 'Two', ['a'])] };
  const { next, undo } = unsave(s, ['a']);
  const since = drop(save(next, 'c', 7, all) as Saves, 'l2');
  const back = restore(since, undo);
  assert.deepEqual(back.saved.map((x) => x.id), ['a', 'c', 'b']);
  assert.deepEqual(back.lists.map((l) => [l.id, l.events]), [['l1', ['a']]]);
});

test('unsave several at once and restore them all', () => {
  const s: Saves = { saved: [{ id: 'a', at: 1 }, { id: 'b', at: 2 }, { id: 'c', at: 3 }], lists: [list('l', 'L', ['a', 'b', 'c'])] };
  const { next, undo } = unsave(s, ['a', 'c']);
  assert.deepEqual(next, { saved: [{ id: 'b', at: 2 }], lists: [list('l', 'L', ['b'])] });
  assert.deepEqual(restore(next, undo).saved, s.saved);
  assert.deepEqual(restore(next, undo).lists[0].events.sort(), ['a', 'b', 'c']);
});

test('nameProblem: empty, trimmed, length by letters, duplicates', () => {
  const lists = [list('l1', 'Music')];
  assert.ok(nameProblem(lists, ''));
  assert.ok(nameProblem(lists, '   '));
  assert.equal(nameProblem(lists, `  ${'a'.repeat(40)}  `), null);
  assert.ok(nameProblem(lists, 'a'.repeat(41)));
  assert.equal(nameProblem(lists, '👍🏽'.repeat(40)), null);
  assert.ok(nameProblem(lists, '👍🏽'.repeat(41)));
  assert.equal(nameProblem(lists, 'कि'.repeat(40)), null);
  assert.ok(nameProblem(lists, 'कि'.repeat(41)));
  assert.ok(nameProblem(lists, 'MUSIC'));
  assert.equal(nameProblem(lists, 'MUSIC', 'l1'), null);
});

test('create stops at MAX_LISTS and stores the trimmed name', () => {
  const lists = Array.from({ length: MAX_LISTS }, (_, i) => list(`l${i}`, `n${i}`));
  assert.equal(create({ saved: [], lists }, 'x', 'new', 1), TOO_MANY);
  const made = create({ saved: [], lists: [] }, '  Gigs  ', 'g', 9) as Saves;
  assert.deepEqual(made.lists, [list('g', 'Gigs', [], 9)]);
});

test('tick saves an unsaved event, bumps touched, keeps it saved when ticked off', () => {
  const s: Saves = { saved: [], lists: [list('l', 'L', [], 1)] };
  const on = tick(s, 'l', 'a', true, 50, all) as Saves;
  assert.deepEqual(on.saved, [{ id: 'a', at: 50 }]);
  assert.deepEqual(on.lists[0], list('l', 'L', ['a'], 50));
  const off = tick(on, 'l', 'a', false, 60, all) as Saves;
  assert.deepEqual(off.saved, on.saved);
  assert.deepEqual(off.lists[0].events, []);
  assert.equal(tick(s, 'nope', 'a', true, 1, all), GONE);
  const f = { ...full(), lists: [list('l', 'L')] };
  assert.equal(tick(f, 'l', 'new', true, 1, all), FULL);
});

test('drop never unsaves; byTouched is newest first', () => {
  const s: Saves = { saved: [{ id: 'a', at: 1 }], lists: [list('l', 'L', ['a'], 1)] };
  assert.deepEqual(drop(s, 'l'), { saved: s.saved, lists: [] });
  assert.deepEqual(byTouched([list('a', 'A', [], 1), list('b', 'B', [], 3), list('c', 'C', [], 2)]).map((l) => l.id), ['b', 'c', 'a']);
});

test('normalise reads old string saves and a bad lists value', () => {
  assert.deepEqual(normalise({ saved: ['a', 'b'] }, 7), { saved: [{ id: 'a', at: 7 }, { id: 'b', at: 7 }], lists: [] });
  assert.deepEqual(normalise({ saved: [{ id: 'a', at: 1 }], lists: 'x' }, 7), { saved: [{ id: 'a', at: 1 }], lists: [] });
});

test('split: upcoming soonest first, past latest first, unknown ids hidden', () => {
  const ev = (id: string, d: string) => ({ id, startsAt: `2026-11-${d}T10:00:00Z` });
  const events = [ev('p1', '01'), ev('u2', '25'), ev('p2', '10'), ev('u1', '20'), ev('other', '22')];
  const r = split(['p1', 'u2', 'p2', 'u1', 'hidden'], events, Date.parse('2026-11-16T00:00:00Z'));
  assert.deepEqual(r.upcoming.map((e) => e.id), ['u1', 'u2']);
  assert.deepEqual(r.past.map((e) => e.id), ['p2', 'p1']);
});

test('rename: gone list, duplicate name, own name in another case, trimming', () => {
  const s: Saves = { saved: [], lists: [list('l1', 'Music'), list('l2', 'Food')] };
  assert.equal(rename(s, 'nope', 'X'), GONE);
  assert.equal(typeof rename(s, 'l2', 'music'), 'string');
  const up = rename(s, 'l1', 'MUSIC') as Saves;
  assert.equal(up.lists[0].name, 'MUSIC');
  const trimmed = rename(s, 'l1', '  Gigs  ') as Saves;
  assert.equal(trimmed.lists[0].name, 'Gigs');
});

test('nameLength without Intl.Segmenter counts letters, and the default segmenter counts an emoji once', () => {
  assert.equal(nameLength('abc', null), 3);
  assert.equal(nameLength('कि', null), 1);
  assert.equal(nameLength('कि'.repeat(40), null), 40);
  assert.equal(nameLength('👍🏽', null), 1);
  assert.equal(nameLength('❤️', null), 1);
  assert.equal(nameLength('👍🏽'), 1);
});

test('tick on an event already in the list returns the same state', () => {
  const s: Saves = { saved: [{ id: 'a', at: 1 }], lists: [list('l', 'L', ['a'])] };
  assert.equal(tick(s, 'l', 'a', true, 9, all), s);
});
