// Run with `pnpm --filter @orbit/app test`. Pins what Home shows for each kind of viewer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planHome } from './layout.ts';

const NOW = Date.parse('2026-11-15T10:00:00+05:30');
const NEAR = 'Indiranagar';
const FAR = 'Whitefield';
const place = { area: NEAR, city: 'Bengaluru', nearAreas: [NEAR, 'Koramangala'] };

const ev = (id: string, hostId: string, area: string, day: number, ann: number, wide?: boolean) => ({
  id,
  hostId,
  area,
  startsAt: `2026-11-${String(day).padStart(2, '0')}T18:00:00+05:30`,
  announced: `2026-11-${String(ann).padStart(2, '0')}T09:00:00+05:30`,
  ...(wide ? { wide: true } : {}),
});
const host = (id: string, area: string, joinedDay: number, banner?: boolean) => ({
  id,
  area,
  joined: `2026-10-${String(joinedDay).padStart(2, '0')}T09:00:00+05:30`,
  ...(banner ? { banner: true } : {}),
});
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const slideIds = (s: any[]) => s.map((x) => (x.kind === 'event' ? x.event.id : x.host.id));
const signedOut = { signedIn: false, follows: [], place };

test('signed in, following, with a ticket', () => {
  const events = [
    ev('t', 'h5', NEAR, 16, 1),
    ev('f1', 'h1', NEAR, 16, 1, true),
    ev('f1b', 'h1', NEAR, 17, 10, true),
    ev('f2', 'h2', NEAR, 17, 5, true),
    ev('f3', 'h3', NEAR, 18, 12, true),
    ev('f4', 'h4', NEAR, 20, 8, true),
    ev('out', 'h5', NEAR, 19, 14, true),
    ev('n1', 'h5', NEAR, 16, 2),
    ev('n2', 'h5', NEAR, 18, 2),
    ev('n3', 'h5', 'Koramangala', 19, 2),
    ev('n4', 'h5', NEAR, 21, 2),
  ];
  const hosts = [host('h1', NEAR, 1), host('h5', NEAR, 2), host('h6', NEAR, 3), host('h7', NEAR, 4), host('h8', NEAR, 5)];
  const viewer = { signedIn: true, follows: ['h1', 'h2', 'h3', 'h4'], place, tickets: [{ eventId: 't', label: 'x' }] };
  const p = planHome(viewer, events, hosts, NOW);
  assert.deepEqual(ids(p.tickets), ['t']);
  assert.deepEqual(ids(p.orbit), ['f1', 'f2', 'f3']);
  assert.equal(p.list.title, 'Near you this week');
  for (const id of ['t', 'f1', 'f2', 'f3']) assert.ok(!ids(p.list.events).includes(id));
  assert.ok(p.list.events.length >= 4);
  assert.equal(p.hostsFirst, false);
  // three unfollowed near hosts first, then the followed one (h1), four at most
  assert.deepEqual(ids(p.hosts), ['h5', 'h6', 'h7', 'h1']);
  assert.deepEqual(slideIds(p.slides), ['f3', 'f1b', 'f4', 'f2', 'f1']);
});

test('hosts near you: 3 unfollowed, then followed near hosts, 4 total, far never', () => {
  const hosts = [
    ...[1, 2, 3, 4, 5].map((n) => host(`u${n}`, NEAR, n)),
    host('f1', NEAR, 6),
    host('f2', 'Koramangala', 7),
    host('f3', FAR, 8),
  ];
  const viewer = { signedIn: true, follows: ['f1', 'f2', 'f3'], place };
  assert.deepEqual(ids(planHome(viewer, [], hosts, NOW).hosts), ['u1', 'u2', 'u3', 'f1']);
  assert.deepEqual(ids(planHome({ ...signedOut, follows: ['f1', 'f2', 'f3'] }, [], hosts, NOW).hosts), ['u1', 'u2', 'u3']);
});

test('signed out ignores follows; slides near only, newest first, hosts included', () => {
  const events = [ev('a', 'h1', NEAR, 16, 3, true), ev('b', 'h1', NEAR, 17, 9, true), ev('far', 'h1', FAR, 17, 14, true)];
  const hosts = [host('hn', NEAR, 20, true), host('hf', FAR, 28, true), host('ho', NEAR, 10, true)];
  const p = planHome({ ...signedOut, follows: ['h1'] }, events, hosts, NOW);
  assert.deepEqual(p.tickets, []);
  assert.deepEqual(p.orbit, []);
  assert.equal(p.hostsFirst, true);
  // events announced Nov 9 / Nov 3 vs hosts joined Oct 20 / Oct 10: events are newer
  assert.deepEqual(slideIds(p.slides), ['b', 'a', 'hn', 'ho']);
});

test('signed in but follows no one behaves like signed out', () => {
  const events = [ev('a', 'h1', NEAR, 16, 3, true)];
  const p = planHome({ signedIn: true, follows: [], place }, events, [], NOW);
  assert.equal(p.hostsFirst, true);
  assert.deepEqual(p.orbit, []);
});

test('nothing near', () => {
  const events = [ev('a', 'h1', FAR, 16, 3, true), ev('b', 'h1', FAR, 30, 5)];
  const hosts = [host('hn', NEAR, 1, true)];
  const p = planHome({ ...signedOut, place: { ...place, nearAreas: [] } }, events, hosts, NOW);
  assert.equal(p.notice, 'nothingNear');
  assert.equal(p.list.title, 'Coming up');
  assert.deepEqual(ids(p.list.events), ['a', 'b']);
  assert.deepEqual(p.hosts, []);
  assert.deepEqual(slideIds(p.slides), ['a', 'hn']);
});

test('no location', () => {
  const events = [ev('a', 'h1', NEAR, 16, 3), ev('b', 'h1', FAR, 30, 5)];
  const p = planHome({ ...signedOut, place: null }, events, [host('h9', NEAR, 1)], NOW);
  assert.equal(p.notice, 'noLocation');
  assert.equal(p.list.title, 'Coming up');
  assert.deepEqual(ids(p.list.events), ['a', 'b']);
  assert.deepEqual(p.hosts, []);
});

test('zero slides without wide posters or banners', () => {
  const p = planHome(signedOut, [ev('a', 'h1', NEAR, 16, 3)], [host('h1', NEAR, 1)], NOW);
  assert.deepEqual(p.slides, []);
});

test('1 to 3 near events this week: Coming up lists all upcoming near events', () => {
  const events = [
    ev('w1', 'h1', NEAR, 16, 1),
    ev('w2', 'h1', NEAR, 17, 1),
    ev('l1', 'h1', NEAR, 25, 1),
    ev('l2', 'h1', NEAR, 28, 1),
    ev('far', 'h1', FAR, 17, 1),
  ];
  const p = planHome(signedOut, events, [], NOW);
  assert.equal(p.notice, null);
  assert.equal(p.list.title, 'Coming up');
  assert.deepEqual(ids(p.list.events), ['w1', 'w2', 'l1', 'l2']);
});

test('past events never appear', () => {
  const events = [ev('old', 'h1', NEAR, 10, 14, true), ev('new', 'h1', NEAR, 16, 1, true)];
  const viewer = { signedIn: true, follows: ['h1'], place, tickets: [{ eventId: 'old', label: 'x' }] };
  for (const v of [viewer, signedOut, { ...signedOut, place: null }]) {
    const p = planHome(v, events, [], NOW);
    const all = [...ids(p.tickets), ...ids(p.orbit), ...ids(p.list.events), ...slideIds(p.slides)];
    assert.ok(!all.includes('old'));
  }
});


test('following hosts with no wide events falls back to near slides', () => {
  const events = [ev('f', 'h1', NEAR, 16, 1), ev('x', 'h2', NEAR, 17, 2, true), ev('far', 'h2', FAR, 17, 9, true)];
  const hosts = [host('hb', NEAR, 5, true)];
  const p = planHome({ signedIn: true, follows: ['h1'], place }, events, hosts, NOW);
  assert.deepEqual(slideIds(p.slides), ['x', 'hb']);
});

test('all lists every upcoming event soonest first, and is empty when a notice is set', () => {
  const events = [
    ev('late', 'h1', FAR, 30, 1),
    ev('old', 'h1', NEAR, 10, 1),
    ev('soon', 'h2', NEAR, 16, 1),
    ev('mid', 'h1', FAR, 20, 1),
  ];
  const viewer = { signedIn: true, follows: ['h1'], place, tickets: [{ eventId: 'soon', label: 'x' }] };
  assert.deepEqual(ids(planHome(viewer, events, [], NOW).all), ['soon', 'mid', 'late']);
  assert.deepEqual(planHome({ ...signedOut, place: { ...place, nearAreas: [] } }, events, [], NOW).all, []);
  assert.deepEqual(planHome({ ...signedOut, place: null }, events, [], NOW).all, []);
});

test('slides keep only the 6 newest when more are eligible', () => {
  const events = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ev(`e${n}`, 'h1', NEAR, 16 + n, n, true));
  const p = planHome(signedOut, events, [], NOW);
  assert.deepEqual(slideIds(p.slides), ['e8', 'e7', 'e6', 'e5', 'e4', 'e3']);
  const f = planHome({ signedIn: true, follows: ['h1'], place }, events, [], NOW);
  assert.deepEqual(slideIds(f.slides), ['e8', 'e7', 'e6', 'e5', 'e4', 'e3']);
});

test('following with wide events: slides mix those events with near unfollowed host banners, newest first', () => {
  const events = [ev('f1', 'h1', NEAR, 16, 10, true), ev('f2', 'h1', NEAR, 17, 6, true)];
  const at = (iso: string) => `${iso}T09:00:00+05:30`;
  const hosts = [
    { ...host('hNew', NEAR, 1, true), joined: at('2026-11-12') }, // newer than both events
    { ...host('hOld', NEAR, 1, true), joined: at('2026-11-08') }, // between the events
    { ...host('hFollowed', NEAR, 1, true), id: 'h1', joined: at('2026-11-14') }, // followed: excluded
    { ...host('hFar', FAR, 1, true), joined: at('2026-11-13') }, // far: excluded
  ];
  const p = planHome({ signedIn: true, follows: ['h1'], place }, events, hosts, NOW);
  assert.deepEqual(slideIds(p.slides), ['hNew', 'f1', 'hOld', 'f2']);
});

test('all is hidden when the list already shows every upcoming event', () => {
  const events = [16, 17, 18, 19, 20].map((d) => ev(`e${d}`, 'h1', NEAR, d, 1));
  const p = planHome(signedOut, events, [], NOW);
  assert.equal(p.list.title, 'Near you this week');
  assert.deepEqual(ids(p.list.events), ['e16', 'e17', 'e18', 'e19', 'e20']);
  assert.deepEqual(p.all, []);
});

test('all shows every upcoming event when ticket and orbit cards shorten the list', () => {
  const events = [
    ev('t', 'h5', NEAR, 16, 1),
    ev('o', 'h1', NEAR, 17, 1),
    ...[18, 19, 20, 21].map((d) => ev(`n${d}`, 'h5', NEAR, d, 1)),
  ];
  const viewer = { signedIn: true, follows: ['h1'], place, tickets: [{ eventId: 't', label: 'x' }] };
  const p = planHome(viewer, events, [], NOW);
  assert.ok(p.list.events.length < events.length);
  assert.deepEqual(ids(p.all), ['t', 'o', 'n18', 'n19', 'n20', 'n21']);
});

test('mixed UTC offsets sort by real time', () => {
  const raw = (id: string, startsAt: string, announced: string) => ({ id, hostId: 'h1', area: NEAR, startsAt, announced, wide: true });
  const events = [
    raw('late', '2026-11-21T06:00:00Z', '2026-11-10T10:00:00+05:30'), // 11:30 IST; announced 04:30Z
    raw('early', '2026-11-21T10:00:00+05:30', '2026-11-10T06:00:00Z'), // 04:30Z; announced 06:00Z
    ev('far', 'h1', FAR, 25, 1),
  ];
  const p = planHome(signedOut, events, [], NOW);
  assert.deepEqual(ids(p.all), ['early', 'late', 'far']);
  // announced: 'early' is newer (06:00Z vs 04:30Z), though its string sorts lower
  assert.deepEqual(slideIds(p.slides), ['early', 'late']);
});

test('tickets: upcoming bookings in start order, out of orbit and list, kept in all; none when signed out', () => {
  const events = [
    ev('past', 'h5', NEAR, 10, 1),
    ev('later', 'h5', NEAR, 19, 1),
    ev('sooner', 'h5', NEAR, 16, 1),
    ev('o', 'h1', NEAR, 17, 1),
    ev('n', 'h5', NEAR, 18, 1),
  ];
  const tickets = ['past', 'later', 'sooner'].map((eventId) => ({ eventId, label: 'x' }));
  const p = planHome({ signedIn: true, follows: ['h1'], place, tickets }, events, [], NOW);
  assert.deepEqual(ids(p.tickets), ['sooner', 'later']);
  for (const id of ['sooner', 'later']) {
    assert.ok(!ids(p.orbit).includes(id));
    assert.ok(!ids(p.list.events).includes(id));
    assert.ok(ids(p.all).includes(id));
  }
  assert.deepEqual(planHome({ ...signedOut, tickets }, events, [], NOW).tickets, []);
});

test('interests: a section per picked kind near you, in the order picked, and its events leave the list', () => {
  const kind = (e: ReturnType<typeof ev>, category: string) => ({ ...e, category });
  const events = [
    kind(ev('c1', 'h1', NEAR, 16, 3), 'comedy'),
    kind(ev('c2', 'h1', NEAR, 17, 3), 'comedy'),
    kind(ev('cFar', 'h1', FAR, 17, 3), 'comedy'),
    kind(ev('m1', 'h2', NEAR, 18, 3), 'music'),
    kind(ev('s1', 'h2', NEAR, 18, 3), 'sports'),
  ];
  const viewer = { signedIn: true, follows: [], place, interests: ['music', 'gaming', 'comedy'] };
  const plan = planHome(viewer, events, [], NOW);
  assert.deepEqual(plan.byInterest.map((k) => [k.category, ids(k.events)]), [['music', ['m1']], ['comedy', ['c1', 'c2']]]);
  assert.deepEqual(ids(plan.list.events), ['s1']); // shown once only
  assert.equal(plan.askInterests, false);
  // Signed in with none picked yet: asked once, no sections. Signed out: neither.
  assert.equal(planHome({ signedIn: true, follows: [], place }, events, [], NOW).askInterests, true);
  assert.equal(planHome({ ...signedOut, interests: ['comedy'] }, events, [], NOW).byInterest.length, 0);
  assert.equal(planHome(signedOut, events, [], NOW).askInterests, false);
});
