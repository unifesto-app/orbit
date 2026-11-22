import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clock, initialsOf, secondsLeft, stepAfter, stepBack } from './signinSteps.ts';

test('each answer opens its own screen; "Is this you?" keeps the year the account began', () => {
  assert.deepEqual(stepAfter({ step: 'confirm', ticket: 't', name: 'A••• R•••', since: 2026 }), { at: 'confirm', ticket: 't', name: 'A••• R•••', since: 2026 });
  assert.deepEqual(stepAfter({ step: 'phone', signup: 's' }), { at: 'phone', signup: 's' });
  assert.deepEqual(stepAfter({ step: 'aboutYou', signup: 's', name: null }), { at: 'aboutYou', signup: 's', name: null });
});

test('Back from a new account’s WhatsApp code keeps the sign-up; anywhere else starts again', () => {
  assert.deepEqual(stepBack({ at: 'code', to: '+919876543210', shown: 'x', signup: 's', until: 0 }), { at: 'phone', signup: 's' });
  assert.deepEqual(stepBack({ at: 'code', to: 'a@b.in', shown: 'x', until: 0 }), { at: 'contact' });
  assert.deepEqual(stepBack({ at: 'aboutYou', signup: 's', name: null }), { at: 'contact' });
});

test('Resend counts down in whole seconds, never below nothing', () => {
  assert.equal(secondsLeft(30_000, 6_000), 24);
  assert.equal(secondsLeft(30_000, 29_500), 1);
  assert.equal(secondsLeft(30_000, 31_000), 0);
  assert.equal(clock(24), '0:24');
  assert.equal(clock(65), '1:05');
});

test('initials come from the masked name, and none when there is no name', () => {
  assert.equal(initialsOf('A••• R•••'), 'AR');
  assert.equal(initialsOf('r••• k••• s•••'), 'RK');
  assert.equal(initialsOf('An account'), '');
});
