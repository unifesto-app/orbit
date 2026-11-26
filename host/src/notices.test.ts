import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inboxPath, pushHref, readBody } from './notices.ts';

test('a push opens the Event Request on Event Partner, else the Inbox', () => {
  assert.equal(pushHref('launch', { to: 'request' }), '/request');
  assert.equal(pushHref('launch', '{"to":"request"}'), '/request'); // Android: JSON text
  assert.equal(pushHref('station', { to: 'request' }), '/inbox');
  assert.equal(pushHref('station', '{"to":"today"}'), '/today'); // slotBooked
  assert.equal(pushHref('launch', { to: 'today' }), '/inbox');
  assert.equal(pushHref('crew', { to: 'request' }), '/inbox');
  assert.equal(pushHref('launch', null), '/inbox');
  assert.equal(pushHref('launch', { to: 'ticket', event: 'e1' }), '/inbox');
  assert.equal(pushHref('launch', 'not json'), '/inbox');
  assert.equal(pushHref('launch', undefined), '/inbox');
});

test('the inbox calls name the app', () => {
  assert.equal(inboxPath('station'), '/me/inbox?app=station');
  assert.equal(inboxPath('launch'), '/me/inbox?app=launch');
  assert.deepEqual(readBody('crew'), { app: 'crew' });
  assert.deepEqual(readBody('crew', ['a']), { app: 'crew', ids: ['a'] });
});
