import assert from 'node:assert/strict';
import { test } from 'node:test';

import { adminHosts, chosen } from './hosts.ts';

const team = (hostId: string, name: string, admin: boolean) => ({ hostId, name, kind: 'other', owner: false, admin, desk: false, events: {} });

test('only Admin seats are hosts Event Partner opens, each with its monogram', () => {
  const hosts = adminHosts({ teams: [team('a', 'Punchline Collective', true), team('b', 'Jam Night', false)] });
  assert.deepEqual(
    hosts.map((h) => [h.id, h.name, h.initials]),
    [['a', 'Punchline Collective', 'PC']],
  );
  assert.ok(hosts[0]!.bg && hosts[0]!.fg);
});

test('the picked host, the only one, or none (welcome, or the picker with several)', () => {
  const [a, b] = adminHosts({ teams: [team('a', 'A', true), team('b', 'B', true)] });
  assert.equal(chosen([a!, b!], 'b'), b);
  assert.equal(chosen([a!, b!], null), null); // several and no pick: ask, never silently the first
  assert.equal(chosen([a!, b!], 'gone'), null); // a pick no longer theirs
  assert.equal(chosen([a!], null), a);
  assert.equal(chosen([a!], 'gone'), a);
  assert.equal(chosen([], 'a'), null);
});
