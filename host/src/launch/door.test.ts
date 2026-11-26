import assert from 'node:assert/strict';
import { test } from 'node:test';

import { admitTotal, afterFail, bump, fresh, fromScan, inLine, left, refused, scanFailed, stateLine, tooLong } from './door.ts';

const g = (quantity: number, admitted: number, name: string | null = 'Meera Pillai') => ({ id: 'b1', name, quantity, admitted, checkedInAt: admitted ? '2026-11-26T13:42:00Z' : null });

test('a ticket for one is in on the scan, Undo back to nobody', () => {
  assert.deepEqual(fromScan({ result: 'in', guest: g(1, 1) }), { kind: 'in', guest: g(1, 1), before: 0 });
  assert.equal(inLine(g(1, 1)), 'Meera is in');
});

test('a group asks how many, up to the seats still out', () => {
  assert.equal(fromScan({ result: 'ask', guest: g(4, 1) }).kind, 'ask');
  assert.equal(left(g(4, 1)), 3);
  assert.equal(left(g(4, 4)), 0);
  assert.equal(inLine(g(4, 3)), 'Meera + 2 · 3 of 4 in');
});

test('another door changed it: asked again, or Already in once everyone is', () => {
  assert.deepEqual(fresh(g(4, 2), true), { kind: 'ask', guest: g(4, 2), again: true });
  assert.deepEqual(fresh(g(4, 4), true), { kind: 'already', guest: g(4, 4), by: null });
});

test('refusals keep the API message; only Too early is amber, only unknown offers Find', () => {
  const r = fromScan({ result: 'unknown', message: 'No ticket matches this.' });
  assert.deepEqual(r, { kind: 'no', word: 'Not an Orbit ticket', message: 'No ticket matches this.', amber: false, find: true });
  assert.equal((refused('early', 'x') as { amber: boolean }).amber, true);
  assert.equal((refused('hostClosed', 'x') as { word: string }).word, 'Not let in');
});

test('counts move with each admit and undo, never below zero', () => {
  assert.deepEqual(bump({ booked: 31, in: 3 }, 0, 2), { booked: 31, in: 5 });
  assert.deepEqual(bump({ booked: 31, in: 1 }, 3, 0), { booked: 31, in: 0 });
});

test('Find rows say where a ticket stands', () => {
  assert.equal(stateLine(g(2, 0)), 'Not in yet');
  assert.equal(stateLine(g(2, 1)), '1 of 2 in');
  assert.equal(stateLine(g(2, 2, null)), 'In');
});

test('admitTotal never goes past the ticket', () => {
  assert.equal(admitTotal(g(4, 1), 2), 3);
  assert.equal(admitTotal(g(4, 3), 5), 4);
});

test('a QR over 64 characters is no Orbit ticket, never sent; a 400 reads the same', () => {
  assert.equal(tooLong('x'.repeat(65))?.kind, 'no');
  assert.equal((tooLong('x'.repeat(65)) as { word: string }).word, 'Not an Orbit ticket');
  assert.equal(tooLong('RZ7Q-2M9X'), null);
  assert.equal((scanFailed({ error: 'invalid', message: 'x' }) as { word: string }).word, 'Not an Orbit ticket');
  assert.equal((scanFailed({ error: 'offline', message: 'Can’t reach Orbit.' }) as { retry?: boolean }).retry, true);
});

test('a failed admit or undo: changed asks again, a refusal shows, anything else keeps the card for a retry', () => {
  assert.deepEqual(afterFail({ error: 'changed', message: 'x', guest: g(4, 2) }, 'admit'), { show: fresh(g(4, 2), true) });
  assert.deepEqual(afterFail({ error: 'ended', message: 'Closed.' }, 'undo'), { show: refused('ended', 'Closed.') });
  assert.deepEqual(afterFail({ error: 'offline', message: 'x' }, 'admit'), { retry: 'Couldn’t let them in. Try again.' });
  assert.deepEqual(afterFail({ error: 'hostClosed', message: 'x' }, 'undo'), { retry: 'Couldn’t undo. Try again.' });
  assert.deepEqual(afterFail({ error: 'server', message: 'x' }, 'admit'), { retry: 'Couldn’t let them in. Try again.' });
});
