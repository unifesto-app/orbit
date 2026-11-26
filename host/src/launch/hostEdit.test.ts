import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HTTP_REFUSED, type HostForm, hostChanges } from './hostEdit.ts';

test('edit host sends only what changed, with the website made https', () => {
  const was: HostForm = { name: 'Pixel Lounge', about: 'Games ', website: 'https://pixel.in', city: 'Hyderabad', visibility: 'public' };
  assert.deepEqual(hostChanges(was, { ...was, about: 'Games' }), { changes: {}, why: undefined }); // trimmed, so unchanged
  assert.deepEqual(hostChanges(was, { ...was, name: ' Pixel ', about: '', website: 'pixel.co' }).changes, { name: 'Pixel', about: null, website: 'https://pixel.co' });
  assert.deepEqual(hostChanges(was, { ...was, website: '  ' }).changes, { website: null });
  assert.deepEqual(hostChanges(was, { ...was, website: 'http://pixel.in' }), { changes: {}, why: HTTP_REFUSED });
});
