// Run with `pnpm --filter @orbit/app test`. Pins what the sign-in sheet reads from what's typed (User flow doc).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ageOn, maskName, readContact, readDob, readPhone, showPhone, typeDob } from './signin.ts';

test('reads an Indian mobile however it is typed, and nothing else', () => {
  for (const t of ['9876543210', '98765 43210', '+91 98765-43210', '919876543210', '09876543210', '(+91) 98765 43210'])
    assert.equal(readPhone(t), '+919876543210', t);
  assert.equal(readPhone('5876543210'), null); // mobiles start 6 to 9
  assert.equal(readPhone('987654321'), null);
  assert.equal(readPhone('+1 415 555 0100'), 'abroad');
  assert.equal(readPhone('+44 7700 900123'), 'abroad');
});

test('one field takes a phone or an email', () => {
  assert.deepEqual(readContact(' Keerthi@Example.com '), { kind: 'email', email: 'keerthi@example.com' });
  assert.deepEqual(readContact('98765 43210'), { kind: 'phone', e164: '+919876543210' });
  assert.equal(readContact('keerthi@example'), null);
  assert.equal(readContact('+1 415 555 0100'), 'abroad');
  assert.equal(readContact(''), null);
});

test('shows and masks', () => {
  assert.equal(showPhone('+919876543210'), '+91 98765 43210');
  assert.equal(maskName('raghav  kumar'), 'R••• K•••');
});

test('types and reads a date of birth', () => {
  assert.equal(typeDob('1203'), '12/03');
  assert.equal(typeDob('12/03/2004x9'), '12/03/2004');
  const now = Date.parse('2026-11-16T12:00:00+05:30');
  assert.equal(readDob('12/03/2004', now), '2004-03-12');
  assert.equal(readDob('31/02/2004', now), null); // no such day
  assert.equal(readDob('01/01/2027', now), null); // not born yet
  assert.equal(readDob('12/03/04', now), null);
});

test('age turns on the birthday, in India', () => {
  // 00:30 IST on 16 Nov is still 15 Nov in UTC.
  const now = Date.parse('2026-11-16T00:30:00+05:30');
  assert.equal(ageOn('2008-11-16', now), 18);
  assert.equal(ageOn('2008-11-17', now), 17);
  assert.equal(ageOn('2004-03-12', now), 22);
});
