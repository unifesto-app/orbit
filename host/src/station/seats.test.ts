import assert from 'node:assert/strict';
import { test } from 'node:test';

import { seats } from './seats.ts';

const team = (hostId: string, name: string, kind: 'venue' | 'comedy-group', r: { owner?: boolean; admin?: boolean; desk?: boolean }) => ({
  hostId, name, kind, owner: false, admin: false, desk: false, events: {}, ...r,
});

test('venues only, owner or Admin is admin, a counter seat is desk, by name', () => {
  const me = {
    teams: [
      team('z', 'Zone Turf', 'venue', { desk: true }),
      team('c', 'Punchline', 'comedy-group', { owner: true, admin: true }),
      team('p', 'Pixel Lounge', 'venue', { owner: true }),
      team('a', 'Arena', 'venue', { admin: true }),
      team('n', 'Nothing', 'venue', {}),
    ],
  };
  assert.deepEqual(seats(me), [
    { hostId: 'a', name: 'Arena', role: 'admin' },
    { hostId: 'p', name: 'Pixel Lounge', role: 'admin' },
    { hostId: 'z', name: 'Zone Turf', role: 'desk' },
  ]);
  assert.deepEqual(seats({ teams: [] }), []);
});
