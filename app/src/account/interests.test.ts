// Pins how Interests and Interested sync with the API (interests.ts, orbit-pm X13), on fakes in place of the calls.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CategorySlug } from '@orbit/contract';

import { interestsSync } from './interests.ts';
import type { Mine } from './interests.ts';

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const tick = () => new Promise((r) => setTimeout(r, 0));
const fail = { ok: false as const, error: { status: 500, message: 'Down' } };

// A phone with one account in, a queue like the session's, and calls that answer when the test says so.
function phone(start: Omit<Mine, 'who'> = {}) {
  let me: Mine | null = { who: 'u1', ...start };
  let queue: Promise<unknown> = Promise.resolve();
  const sent: string[] = [];
  const alerts: string[] = [];
  const later: (() => void)[] = []; // calls held until flush()
  let hold = false;
  let server: { interests: CategorySlug[] | null; events: string[] } = { interests: ['comedy'], events: [] };
  let down = false;
  const answer = <T>(data: () => T) =>
    new Promise<any>((resolve) => {
      const go = () => resolve(down ? fail : { ok: true, data: data() });
      if (hold) later.push(go);
      else go();
    });
  const sync = interestsSync({
    mine: () => me,
    apply: (patch) => me && (me = { ...me, ...patch }),
    serial: (send) => {
      const run = queue.then(send);
      queue = run.catch(() => {});
      return run;
    },
    get: () => (sent.push('GET interests'), answer(() => ({ interests: server.interests }))),
    getInterested: () => (sent.push('GET interested'), answer(() => ({ events: [...server.events] }))),
    put: (list) => (sent.push(`PUT ${list.join(',')}`), answer(() => ((server.interests = [...list]), { interests: list }))),
    mark: (id, on) =>
      (sent.push(`${on ? 'PUT' : 'DELETE'} ${id}`),
      answer(() => ((server.events = [...server.events.filter((x) => x !== id), ...(on ? [id] : [])]), null))),
    alert: (title) => alerts.push(title),
    changed: () => {},
  });
  return {
    sync,
    sent,
    alerts,
    me: () => me,
    signOut: () => ((me = null), sync.reset()),
    server: (s: Partial<typeof server>) => (server = { ...server, ...s }),
    down: (d: boolean) => (down = d),
    hold: (h: boolean) => (hold = h),
    // Answers the calls sent so far (not ones they lead to), then lets the replies run.
    flush: async () => {
      for (let i = 0; i < 3; i++) await tick();
      later.splice(0).forEach((go) => go());
      for (let i = 0; i < 3; i++) await tick();
    },
  };
}

test('signing in from I’m interested: the tap lands first, the read waits for it, and the ask stays hidden till then', async () => {
  const p = phone();
  p.server({ interests: null, events: [E2] });
  p.hold(true);
  const reading = p.sync.load(); // the sign-in read
  p.sync.setInterested(E1, true); // runPending's tap, before the read lands
  assert.equal(p.sync.status(), 'loading');
  p.sync.setInterests(['jams']); // a write before the read is dropped
  assert.equal(p.me()?.interests, undefined);
  p.hold(false);
  await p.flush();
  await reading;
  assert.equal(p.sync.status(), 'ready');
  assert.deepEqual(p.me()?.interested, [E2, E1]); // the server's, with the tap, not lost to a stale read
  assert.deepEqual(p.sent.filter((s) => s.startsWith('PUT ')), [`PUT ${E1}`]);
});

test('a read that a tap overtook goes again', async () => {
  const p = phone();
  p.server({ events: [] });
  p.hold(true);
  const reading = p.sync.load();
  await tick(); // the first GETs are out
  p.sync.setInterested(E1, true);
  p.hold(false);
  await p.flush();
  await reading;
  assert.equal(p.sent.filter((s) => s === 'GET interested').length, 2);
  assert.deepEqual(p.me()?.interested, [E1]);
});

test('a failed read leaves the status failed (no ask), and a retry reads again', async () => {
  const p = phone();
  p.down(true);
  await p.sync.load();
  assert.equal(p.sync.status(), 'failed');
  p.sync.setInterests(['jams']);
  assert.equal(p.sent.some((s) => s.startsWith('PUT')), false);
  p.down(false);
  await p.sync.load();
  assert.equal(p.sync.status(), 'ready');
  assert.deepEqual(p.me()?.interests, ['comedy']);
});

test('picks kept on the phone go up once if the server has none, and a failure there is quiet', async () => {
  const p = phone({ interests: ['jams'] });
  p.server({ interests: null });
  p.hold(true);
  const reading = p.sync.load();
  await p.flush(); // the GETs answer
  await reading;
  p.down(true);
  await p.flush(); // the carry-up PUT is refused
  assert.ok(p.sent.includes('PUT jams'));
  assert.deepEqual(p.alerts, []);
  assert.deepEqual(p.me()?.interests, ['jams']); // still on the phone; next launch tries again
});

test('whole lists go in turn, and a refused one doesn’t undo a later list', async () => {
  const p = phone();
  await p.sync.load();
  p.hold(true);
  p.sync.setInterests(['jams']);
  p.sync.setInterests(['jams', 'gaming']);
  p.down(true);
  await p.flush(); // the first PUT is refused
  p.down(false);
  await p.flush();
  assert.deepEqual(p.sent.filter((s) => s.startsWith('PUT')), ['PUT jams', 'PUT jams,gaming']);
  assert.deepEqual(p.me()?.interests, ['jams', 'gaming']);
});

test('a refused Interested tap doesn’t undo a later one, and a lone refusal is put back with a note', async () => {
  const p = phone();
  await p.sync.load();
  p.hold(true);
  p.sync.setInterested(E1, true);
  p.sync.setInterested(E1, false);
  p.down(true);
  await p.flush();
  p.down(false);
  await p.flush();
  assert.deepEqual(p.me()?.interested, []);
  p.down(true);
  p.sync.setInterested(E2, true);
  await p.flush();
  assert.deepEqual(p.me()?.interested, []);
  assert.deepEqual(p.alerts, ['Couldn’t change that']);
});

test('a write queued for an account that has left is never sent', async () => {
  const p = phone();
  await p.sync.load();
  p.hold(true);
  p.sync.setInterested(E1, true);
  p.sync.setInterested(E2, true); // waits behind E1 on the queue
  p.signOut();
  await p.flush();
  await p.flush();
  assert.deepEqual(p.sent.filter((s) => s.includes(E2)), []);
  assert.equal(p.sync.status(), 'loading');
});
