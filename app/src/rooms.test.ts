import assert from 'node:assert/strict';
import { test } from 'node:test';

import { actionOf, cardOf, chipOf, keyboardOf, pickChip, roomSays, roomsApi, rowChip } from './rooms.ts';

test('roomsApi: the room routes, all signed in', async () => {
  const got: string[] = [];
  const authed = async (method: string, path: string, body?: unknown) => {
    got.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
    return { ok: true as const, data: null as never };
  };
  const r = roomsApi({ authed } as never);
  await r.get('e');
  await r.putCard('e', { line: 'Hi', reach: [{ label: 'Phone', value: '1' }] });
  await r.leave('e');
  await r.ask('e', 'm');
  await r.accept('e', 'a');
  await r.decline('e', 'a');
  await r.block('e', 'm');
  assert.deepEqual(got, [
    'GET /me/rooms/e',
    'PUT /me/rooms/e/card {"line":"Hi","reach":[{"label":"Phone","value":"1"}]}',
    'DELETE /me/rooms/e',
    'POST /me/rooms/e/asks {"memberId":"m"}',
    'POST /me/rooms/e/asks/a/accept',
    'POST /me/rooms/e/asks/a/decline',
    'POST /me/rooms/e/members/m/block',
  ]);
});

test('cardOf: trimmed, empty rows dropped, the contract’s limits as words', () => {
  assert.deepEqual(cardOf('  Designer  ', [{ label: ' Phone ', value: ' 98 ' }, { label: '', value: ' ' }]), {
    card: { line: 'Designer', reach: [{ label: 'Phone', value: '98' }] },
  });
  assert.deepEqual(cardOf('  ', [{ label: 'Phone', value: '1' }]), { error: 'Add a line about you.' });
  assert.deepEqual(cardOf('x'.repeat(121), [{ label: 'Phone', value: '1' }]), { error: 'Keep your line to 120 characters.' });
  assert.ok('card' in cardOf('x'.repeat(120), [{ label: 'Phone', value: '1' }]));
  assert.deepEqual(cardOf('Hi', [{ label: 'Phone', value: '' }, { label: '', value: '' }]), {
    error: 'Give each way to reach you a label and what to reach you on.',
  });
  assert.deepEqual(cardOf('Hi', [{ label: '', value: '' }]), { error: 'Add a way to reach you.' });
  const four = Array.from({ length: 4 }, (_, i) => ({ label: 'Phone', value: `${i}` }));
  assert.deepEqual(cardOf('Hi', four), { error: 'Add 3 ways to reach you at most.' });
  assert.deepEqual(cardOf('Hi', [{ label: 'x'.repeat(25), value: '1' }]), { error: 'Keep each label to 24 characters.' });
  assert.deepEqual(cardOf('Hi', [{ label: 'Email', value: 'x'.repeat(121) }]), { error: 'Keep each way to reach you to 120 characters.' });
});

test('chipOf and keyboardOf: Phone and Email pick their keyboards; any other label is Other', () => {
  assert.equal(chipOf('Phone'), 'Phone');
  assert.equal(chipOf('Email'), 'Email');
  assert.equal(chipOf('Instagram'), 'Other');
  assert.equal(chipOf(''), 'Other');
  assert.equal(keyboardOf('Phone'), 'phone-pad');
  assert.equal(keyboardOf('Email'), 'email-address');
  assert.equal(keyboardOf('Instagram'), 'default');
});

test('actionOf: what a member row offers for each ask', () => {
  assert.equal(actionOf('none'), 'ask');
  assert.equal(actionOf('declined'), 'ask'); // asking turns it round
  assert.equal(actionOf('asked'), 'asked');
  assert.equal(actionOf('incoming'), 'answer');
  assert.equal(actionOf('connected'), 'reach');
});

test('roomSays: a line for every state but in; a closed room says whether connections stay', () => {
  for (const s of ['out', 'door', 'removed', 'barred'] as const) assert.ok(roomSays(s));
  assert.equal(roomSays('in'), null);
  assert.notEqual(roomSays('closed', 0), roomSays('closed', 2));
});

test('pickChip: Other keeps a label typed under it; a label typed as "Phone" stays under Other', () => {
  const insta = { label: 'Instagram', value: '@riya' };
  assert.deepEqual(pickChip(insta, 'Other'), { ...insta, chip: 'Other' });
  assert.deepEqual(pickChip({ label: 'Phone', value: '1' }, 'Other'), { label: '', value: '1', chip: 'Other' });
  assert.equal(pickChip(insta, 'Email').label, 'Email');
  assert.equal(rowChip({ label: 'Phone', value: '', chip: 'Other' }), 'Other');
  assert.equal(rowChip({ label: 'Phone', value: '' }), 'Phone');
});
