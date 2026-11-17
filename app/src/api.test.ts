// Run with `pnpm --filter @orbit/app test`. Pins the API client: results, token renewal, sign-out.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeApi, OFFLINE } from './api.ts';

type Req = { method: string; path: string; headers: Record<string, string>; body: any };
type Answer = Response | Error | Promise<Response>;

const json = (status: number, body?: unknown) =>
  status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokens = (n: number, expiresIn = 900) => json(200, { access: `a${n}`, refresh: `r${n}`, expiresIn });
const settle = () => new Promise((r) => setTimeout(r, 5));

// `script` answers each request; every request is recorded in `reqs`.
function setup(script: (req: Req, n: number) => Answer, stored: string | null = null) {
  const reqs: Req[] = [];
  let t = 0;
  let refreshToken = stored;
  const sets: (string | null)[] = [];
  const whys: any[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const req: Req = {
      method: init.method!,
      path: url.replace('https://x', ''),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body instanceof FormData ? init.body : init.body ? JSON.parse(init.body as string) : undefined,
    };
    reqs.push(req);
    const a = script(req, reqs.length);
    if (a instanceof Error) throw a;
    return a;
  }) as unknown as typeof fetch;
  const api = makeApi({
    base: 'https://x',
    fetch: f,
    refreshToken: { get: () => refreshToken, set: (v) => { sets.push(v); refreshToken = v; } },
    onEnded: (why) => whys.push(why),
    now: () => t,
  });
  return { api, reqs, sets, whys, ended: () => whys.length, stored: () => refreshToken, tick: (s: number) => (t += s * 1000) };
}
const refreshes = (reqs: Req[]) => reqs.filter((r) => r.path === '/auth/refresh');

test('call: 200, 204, API errors, HTML 502, thrown fetch', async () => {
  const answers: Answer[] = [
    json(200, { hi: 1 }),
    json(204),
    json(409, { error: 'taken', message: 'Taken.' }),
    new Response('<html>bad gateway</html>', { status: 502 }),
    new Error('network'),
  ];
  const { api } = setup(() => answers.shift()!);
  assert.deepEqual(await api.call('GET', '/a'), { ok: true, data: { hi: 1 } });
  assert.deepEqual(await api.call('GET', '/a'), { ok: true, data: null });
  assert.deepEqual(await api.call('GET', '/a'), { ok: false, status: 409, error: { error: 'taken', message: 'Taken.' } });
  const bad = await api.call('GET', '/a');
  assert.ok(!bad.ok && bad.status === 502 && bad.error.error === 'server');
  assert.deepEqual(await api.call('GET', '/a'), { ok: false, status: 0, error: OFFLINE });
});

test('call: content-type only with a body, authorization only with a token', async () => {
  const { api, reqs } = setup(() => json(204));
  await api.call('POST', '/a', { x: 1 });
  await api.call('GET', '/b', undefined, 'tok');
  assert.deepEqual(reqs[0]!.headers, { 'content-type': 'application/json' });
  assert.deepEqual(reqs[1]!.headers, { authorization: 'Bearer tok' });
});

test('call: a FormData upload goes as it is, with no content-type of ours', async () => {
  const { api, reqs } = setup(() => json(200, {}));
  const form = new FormData();
  form.append('photo', 'bytes');
  await api.call('PUT', '/me/photo', form, 'tok');
  assert.equal(reqs[0]!.body, form);
  assert.deepEqual(reqs[0]!.headers, { authorization: 'Bearer tok' });
});

test('authed with no access token refreshes, saves the new refresh token, then sends the request', async () => {
  let savedBeforeRequest: string | null = null;
  const h = setup((req) => {
    if (req.path === '/auth/refresh') return tokens(2);
    savedBeforeRequest = h.stored();
    return json(200, { ok: 1 });
  }, 'r1');
  const r = await h.api.authed('GET', '/me');
  assert.ok(r.ok);
  assert.deepEqual(h.reqs.map((q) => `${q.method} ${q.path}`), ['POST /auth/refresh', 'GET /me']);
  assert.deepEqual(h.reqs[0]!.body, { refresh: 'r1' });
  assert.equal(savedBeforeRequest, 'r2');
  assert.equal(h.reqs[1]!.headers.authorization, 'Bearer a2');
});

test('two simultaneous authed calls share one refresh', async () => {
  const h = setup((req) => (req.path === '/auth/refresh' ? tokens(2) : json(200, {})), 'r1');
  const [a, b] = await Promise.all([h.api.authed('GET', '/a'), h.api.authed('GET', '/b')]);
  assert.ok(a.ok && b.ok);
  assert.equal(refreshes(h.reqs).length, 1);
});

test('start: uses its access token until 30 s before expiry, then refreshes', async () => {
  const h = setup((req) => (req.path === '/auth/refresh' ? tokens(2) : json(200, {})));
  h.api.start({ access: 'a1', refresh: 'r1', expiresIn: 100 });
  await h.api.authed('GET', '/a');
  assert.equal(h.reqs[0]!.headers.authorization, 'Bearer a1');
  assert.equal(refreshes(h.reqs).length, 0);
  h.tick(69);
  await h.api.authed('GET', '/a');
  assert.equal(refreshes(h.reqs).length, 0);
  h.tick(1); // 70 s = expiresIn - 30
  await h.api.authed('GET', '/a');
  assert.equal(refreshes(h.reqs).length, 1);
  assert.equal(h.reqs.at(-1)!.headers.authorization, 'Bearer a2');
});

test('401: one renewal, one retry; a second 401 is returned', async () => {
  const h = setup((req) => (req.path === '/auth/refresh' ? tokens(3) : json(401, { error: 'unauthorized', message: 'No.' })));
  h.api.start({ access: 'a1', refresh: 'r1', expiresIn: 900 });
  const r = await h.api.authed('GET', '/a');
  assert.ok(!r.ok && r.status === 401 && r.error.error === 'unauthorized');
  assert.deepEqual(h.reqs.map((q) => q.path), ['/a', '/auth/refresh', '/a']);
});

test('refresh refused by the API ends the session', async () => {
  for (const [status, error] of [[401, 'signedOut'], [403, 'suspended']] as const) {
    const h = setup(() => json(status, { error, message: 'Over.' }), 'r1');
    const r = await h.api.authed('GET', '/a');
    assert.ok(!r.ok && r.error.error === error);
    assert.equal(h.ended(), 1);
    assert.equal(h.stored(), null);
  }
});

test('refresh offline or 500 keeps the session', async () => {
  const cases: [() => Answer, string][] = [
    [() => new Error('net'), 'offline'],
    [() => json(500, { error: 'server', message: 'Oops.' }), 'server'],
  ];
  for (const [answer, code] of cases) {
    const h = setup(answer, 'r1');
    const r = await h.api.authed('GET', '/a');
    assert.ok(!r.ok && r.error.error === code);
    assert.equal(h.ended(), 0);
    assert.equal(h.stored(), 'r1');
  }
});

test('signOut during a refresh: its tokens are not written back, the call resolves signed out', async () => {
  let release!: () => void;
  const gate = new Promise<Response>((res) => (release = () => res(tokens(2))));
  let first = true;
  const h = setup((req) => {
    if (req.path !== '/auth/refresh') return json(204);
    if (first) {
      first = false;
      return gate;
    }
    return tokens(9); // signOut's own refresh with the old token
  }, 'r1');
  const pending = h.api.authed('GET', '/a');
  await settle();
  h.api.signOut();
  release();
  const r = await pending;
  assert.ok(!r.ok && r.error.error === 'signedOut');
  await settle();
  assert.equal(h.stored(), null);
  assert.ok(!h.reqs.some((q) => q.path === '/a'));
});

test('signOut tells the API with the live access token', async () => {
  const h = setup(() => json(204));
  h.api.start({ access: 'a1', refresh: 'r1', expiresIn: 900 });
  h.api.signOut();
  assert.equal(h.stored(), null); // synchronous
  await settle();
  assert.deepEqual(h.reqs.map((q) => `${q.method} ${q.path}`), ['POST /auth/signout']);
  assert.equal(h.reqs[0]!.headers.authorization, 'Bearer a1');
});

test('start never clears the token first, and a renewal from before does not write back', async () => {
  let release!: () => void;
  const gate = new Promise<Response>((res) => (release = () => res(tokens(2))));
  const h = setup((req) => (req.path === '/auth/refresh' ? gate : json(204)), 'r1');
  const pending = h.api.authed('GET', '/a');
  await settle();
  h.api.start({ access: 'b1', refresh: 'rb', expiresIn: 900 });
  release();
  await pending;
  assert.deepEqual(h.sets, ['rb']);
  assert.equal(h.stored(), 'rb');
});

test('a refresh with no answer is retried once with the same token', async () => {
  let n = 0;
  const h = setup((req) => {
    if (req.path !== '/auth/refresh') return json(200, {});
    return n++ === 0 ? new Error('net') : tokens(2);
  }, 'r1');
  const r = await h.api.authed('GET', '/a');
  assert.ok(r.ok);
  assert.deepEqual(refreshes(h.reqs).map((q) => q.body), [{ refresh: 'r1' }, { refresh: 'r1' }]);
  assert.equal(h.ended(), 0);
});

test('two refresh failures: offline, session kept', async () => {
  const h = setup(() => new Error('net'), 'r1');
  const r = await h.api.authed('GET', '/a');
  assert.ok(!r.ok && r.status === 0 && r.error.error === 'offline');
  assert.equal(refreshes(h.reqs).length, 2);
  assert.equal(h.ended(), 0);
  assert.equal(h.stored(), 'r1');
});

test('403 suspended on the request ends the session with that error', async () => {
  const err = { error: 'suspended', message: 'Suspended.' };
  const h = setup(() => json(403, err));
  h.api.start({ access: 'a1', refresh: 'r1', expiresIn: 900 });
  const r = await h.api.authed('GET', '/a');
  assert.ok(!r.ok && r.status === 403);
  assert.deepEqual(h.whys, [err]);
  assert.equal(h.stored(), null);
});

test('onEnded gets the error when a refresh says signedOut or suspended', async () => {
  for (const [status, error] of [[401, 'signedOut'], [403, 'suspended']] as const) {
    const err = { error, message: 'Over.' };
    const h = setup(() => json(status, err), 'r1');
    await h.api.authed('GET', '/a');
    assert.deepEqual(h.whys, [err]);
  }
});

test('a 401 retry is not sent with the next account’s token after sign-out and start', async () => {
  let release!: () => void;
  const gate = new Promise<Response>((res) => (release = () => res(json(401, { error: 'unauthorized', message: 'No.' }))));
  const h = setup((req) => (req.path === '/a' ? gate : tokens(3)));
  h.api.start({ access: 'a1', refresh: 'r1', expiresIn: 900 });
  const pending = h.api.authed('GET', '/a');
  await settle();
  h.api.signOut();
  h.api.start({ access: 'b1', refresh: 'rb', expiresIn: 900 });
  release();
  const r = await pending;
  assert.ok(!r.ok && r.error.error === 'signedOut');
  assert.ok(!h.reqs.some((q) => q.headers.authorization === 'Bearer b1'));
  assert.equal(h.reqs.filter((q) => q.path === '/a').length, 1);
});

test('a 200 with an unparseable body is a server error', async () => {
  const { api } = setup(() => new Response('<html>', { status: 200 }));
  const r = await api.call('GET', '/a');
  assert.ok(!r.ok && r.error.error === 'server');
});

test('authed with no refresh token ends the session as signedOut', async () => {
  const h = setup(() => json(204));
  const r = await h.api.authed('GET', '/a');
  assert.ok(!r.ok);
  assert.equal(h.reqs.length, 0);
  assert.equal(h.whys[0]?.error, 'signedOut');
});

test('signOut with an expired access token refreshes with the token it had, then signs out', async () => {
  const h = setup((req) => (req.path === '/auth/refresh' ? tokens(2) : json(204)));
  h.api.start({ access: 'a1', refresh: 'r1', expiresIn: 100 });
  h.tick(100);
  h.api.signOut();
  assert.equal(h.stored(), null); // synchronous
  await settle();
  assert.deepEqual(h.reqs.map((q) => q.path), ['/auth/refresh', '/auth/signout']);
  assert.deepEqual(h.reqs[0]!.body, { refresh: 'r1' });
  assert.equal(h.reqs[1]!.headers.authorization, 'Bearer a2');
  assert.equal(h.stored(), null);
});
