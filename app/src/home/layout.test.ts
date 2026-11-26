// Run with `pnpm --filter @orbit/app test`. Pins what Home shows for each kind of viewer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planHome } from './layout.ts';

const NOW = Date.parse('2026-11-15T10:00:00+05:30');
const NEAR = 'Gachibowli';
const FAR = 'Uppal';
const place = { area: NEAR, city: 'Hyderabad', nearAreas: [NEAR, 'Kondapur'] };

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
const slideIds = (s: any[]) => s.map((x) => (x.kind === 'event' ? x.event.id : x.kind === 'host' ? x.host.id : `custom:${x.custom.label}`));
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

test('places to play: near you in their own section, out of Hosts near you; everywhere with no location', () => {
  const hosts = [host('h1', NEAR, 1), { ...host('turf', NEAR, 2), tile: 'sports' }, { ...host('farTurf', FAR, 3), tile: 'sports' }];
  const p = planHome(signedOut, [ev('e', 'h1', NEAR, 16, 1)], hosts, NOW);
  assert.deepEqual(ids(p.places), ['turf']);
  assert.deepEqual(ids(p.hosts), ['h1']);
  assert.deepEqual(ids(planHome({ ...signedOut, place: null }, [], hosts, NOW).places), ['turf', 'farTurf']);
});

test('a promoted event with a 4:3 poster leads the slides once, near you, following or not; six in all', () => {
  const events = [...[1, 2, 3, 4, 5, 6].map((n) => ev(`n${n}`, 'h1', NEAR, 16 + n, n, true)), ev('ad', 'h2', NEAR, 18, 1, true), ev('farAd', 'h2', FAR, 17, 1, true)];
  const promoted = (e: { id: string }) => e.id === 'ad' || e.id === 'farAd';
  const p = planHome(signedOut, events, [], NOW, promoted);
  assert.equal(slideIds(p.slides)[0], 'ad'); // the far one is skipped while something is near
  assert.equal(p.slides.length, 6);
  assert.equal(slideIds(p.slides).filter((id) => id === 'ad').length, 1);
  const following = planHome({ signedIn: true, follows: ['h1'], place }, events, [], NOW, promoted);
  assert.equal(slideIds(following.slides)[0], 'ad');
  assert.equal(slideIds(planHome(signedOut, events, [], NOW).slides)[0], 'n6'); // no boost: newest first, as before
  assert.equal(p.ad, undefined); // one boost near: it leads the carousel, no banner
});

test('featured slides follow the promoted lead in staff order; past, 4:3-less and repeated ones are skipped; six in all', () => {
  const events = [...[1, 2, 3, 4, 5, 6].map((n) => ev(`n${n}`, 'h1', NEAR, 16 + n, n, true)), ev('ad', 'h2', NEAR, 18, 1, true), ev('farPick', 'h3', FAR, 19, 1, true), ev('flat', 'h3', NEAR, 19, 1), ev('past', 'h3', NEAR, 10, 1, true)];
  const hosts = [host('banner', FAR, 1, true), host('plain', NEAR, 2)];
  const promoted = (e: { id: string }) => e.id === 'ad';
  const image = { kind: 'image' as const, image: 'https://api.test/media/content/x/y.webp', edge: '#000000', label: 'Card offer' };
  const featured = [
    { kind: 'pick' as const, href: '/event/farPick' }, // far from you: staff picks show anyway
    image,
    { kind: 'pick' as const, href: '/event/ad' }, // already the lead: not twice
    { kind: 'pick' as const, href: '/event/flat' }, // no 4:3 poster
    { kind: 'pick' as const, href: '/event/past' }, // over
    { kind: 'pick' as const, href: '/event/missing' },
    { kind: 'pick' as const, href: '/host/banner' },
    { kind: 'pick' as const, href: '/host/plain' }, // no banner
  ];
  const p = planHome(signedOut, events, hosts, NOW, promoted, featured);
  assert.deepEqual(slideIds(p.slides), ['ad', 'farPick', 'custom:Card offer', 'banner', 'n6', 'n5']);
  // No featured: as before.
  assert.deepEqual(slideIds(planHome(signedOut, events, hosts, NOW, promoted).slides).slice(0, 2), ['ad', 'n6']);
});

test('a second promoted event is the banner in the middle, kept out of the carousel; booked ones are neither', () => {
  const events = [ev('n1', 'h1', NEAR, 17, 9, true), ev('ad1', 'h2', NEAR, 18, 1, true), ev('ad2', 'h2', NEAR, 19, 2, true), ev('ad3', 'h2', NEAR, 20, 3, true)];
  const promoted = (e: { id: string }) => e.id.startsWith('ad');
  const p = planHome(signedOut, events, [], NOW, promoted);
  assert.equal(slideIds(p.slides)[0], 'ad1');
  assert.equal(p.ad?.id, 'ad2');
  assert.ok(!slideIds(p.slides).includes('ad2'));
  const booked = planHome({ signedIn: true, follows: [], place, tickets: [{ eventId: 'ad1', label: 'x' }] }, events, [], NOW, promoted);
  assert.equal(slideIds(booked.slides)[0], 'ad2');
  assert.equal(booked.ad?.id, 'ad3');
});

test('the banner skips a promoted event already in your orbit; lead is the carousel’s paid slide', () => {
  const kind = (e: ReturnType<typeof ev>, category: string) => ({ ...e, category });
  const events = [
    kind(ev('ad1', 'h2', NEAR, 17, 1, true), 'comedy'),
    kind(ev('ad2', 'h1', NEAR, 18, 2, true), 'comedy'), // from a host you follow: in your orbit
    kind(ev('ad3', 'h3', NEAR, 19, 3, true), 'jams'), // a kind you picked: still a banner, as picks only order the list
    kind(ev('ad4', 'h4', NEAR, 20, 4, true), 'comedy'),
  ];
  const promoted = (e: { id: string }) => e.id.startsWith('ad');
  const viewer = { signedIn: true, follows: ['h1'], place, interests: ['jams'] };
  const p = planHome(viewer, events, [], NOW, promoted);
  assert.equal(p.lead?.id, 'ad1');
  assert.equal(p.ad?.id, 'ad3');
  assert.ok(!slideIds(p.slides).includes('ad3'));
  // Somewhere with nothing near there is no near: boosts come from everywhere, as the list does.
  const away = planHome({ ...signedOut, place: { area: 'Bengaluru', city: 'Bengaluru', state: 'Karnataka', nearAreas: [] } }, events, [], NOW, promoted);
  assert.equal(away.notice, 'nothingNear');
  assert.equal(away.lead?.id, 'ad1');
  assert.equal(away.ad?.id, 'ad2');
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

test('interests: the kinds you picked lead the near-you list, each part soonest first; one list, no sections', () => {
  const kind = (e: ReturnType<typeof ev>, category: string) => ({ ...e, category });
  const events = [
    kind(ev('s1', 'h2', NEAR, 16, 3), 'sports'),
    kind(ev('c1', 'h1', NEAR, 17, 3), 'comedy'),
    kind(ev('cFar', 'h1', FAR, 17, 3), 'comedy'),
    kind(ev('m1', 'h2', NEAR, 18, 3), 'jams'),
    kind(ev('c2', 'h1', NEAR, 19, 3), 'comedy'),
  ];
  const viewer = { signedIn: true, follows: [], place, interests: ['jams', 'gaming', 'comedy'] };
  const plan = planHome(viewer, events, [], NOW);
  assert.equal(plan.list.title, 'Near you this week');
  assert.deepEqual(ids(plan.list.events), ['c1', 'm1', 'c2', 's1']);
  assert.equal(plan.askInterests, false);
  // Signed in with none picked yet: asked once, the list soonest first. Signed out: picks are ignored, and no ask.
  const unasked = planHome({ signedIn: true, follows: [], place, interestsRead: true }, events, [], NOW);
  assert.equal(unasked.askInterests, true);
  // Not before the API's picks have been read for this sign-in.
  assert.equal(planHome({ signedIn: true, follows: [], place }, events, [], NOW).askInterests, false);
  assert.deepEqual(ids(unasked.list.events), ['s1', 'c1', 'm1', 'c2']);
  assert.deepEqual(ids(planHome({ ...signedOut, interests: ['comedy'] }, events, [], NOW).list.events), ['s1', 'c1', 'm1', 'c2']);
  assert.equal(planHome(signedOut, events, [], NOW).askInterests, false);
});

test('interests: tickets and the orbit stay out of the list; no place means everywhere, picks still first', () => {
  const kind = (e: ReturnType<typeof ev>, category: string) => ({ ...e, category });
  const events = [
    kind(ev('ca', 'h1', NEAR, 16, 3), 'comedy'),
    kind(ev('s1', 'h3', NEAR, 16, 3), 'sports'),
    kind(ev('cb', 'h1', NEAR, 17, 3), 'comedy'),
    kind(ev('gFar', 'h3', FAR, 17, 3), 'gaming'),
    kind(ev('m1', 'h2', NEAR, 18, 3), 'jams'),
    kind(ev('g1', 'h3', NEAR, 19, 3), 'gaming'),
  ];
  const viewer = { signedIn: true, follows: ['h2'], place, interests: ['comedy', 'gaming'], tickets: [{ eventId: 'ca', label: '1 ticket' }] };
  // ca is a ticket and m1 is h2's next date (your orbit), so neither repeats; three near this week makes it Coming up.
  const plan = planHome(viewer, events, [], NOW);
  assert.equal(plan.list.title, 'Coming up');
  assert.deepEqual(ids(plan.list.events), ['cb', 'g1', 's1']);
  assert.equal(plan.near, true);
  // No location: everything coming up, everywhere, the picked kinds still first.
  const away = planHome({ ...viewer, place: null }, events, [], NOW);
  assert.equal(away.near, false);
  assert.deepEqual(ids(away.list.events), ['cb', 'gFar', 'g1', 's1']);
});

test('open across India: anywhere with nothing near says so, with everything coming up', () => {
  const events = [ev('a', 'h1', NEAR, 16, 3, true), ev('b', 'h1', FAR, 17, 5)];
  const bengaluru = { area: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', nearAreas: ['Koramangala'] };
  const plan = planHome({ signedIn: false, follows: [], place: bengaluru }, events, [], NOW);
  assert.equal(plan.notice, 'nothingNear');
  assert.equal(plan.list.title, 'Coming up');
  assert.deepEqual(ids(plan.list.events), ['a', 'b']);
  assert.equal(plan.near, false);
  // Something on near it is near, whatever the state.
  assert.equal(planHome({ signedIn: false, follows: [], place: bengaluru }, [...events, ev('k', 'h2', 'Koramangala', 18, 4)], [], NOW).notice, null);
});

test('a featured pick of the event that is the banner stays out of the slides, and the banner is still that event', () => {
  const events = [ev('n1', 'h1', NEAR, 17, 9, true), ev('ad1', 'h2', NEAR, 18, 1, true), ev('ad2', 'h2', NEAR, 19, 2, true)];
  const promoted = (e: { id: string }) => e.id.startsWith('ad');
  const p = planHome(signedOut, events, [], NOW, promoted, [{ kind: 'pick', href: '/event/ad2' }]);
  assert.equal(p.ad?.id, 'ad2');
  assert.ok(!slideIds(p.slides).includes('ad2'));
  assert.equal(slideIds(p.slides)[0], 'ad1');
});

test('the API\'s near wins over the area list: hosts near are the ones with a near event', () => {
  const apiPlace = { area: 'Gachibowli', city: 'Hyderabad', nearAreas: [] }; // the API decides, so no area list
  const events = [
    { ...ev('a', 'h1', 'Somewhere', 16, 1), near: true },
    { ...ev('b', 'h2', 'Somewhere', 17, 1), near: false },
  ];
  const hosts = [host('h1', ''), host('h2', '')];
  const p = planHome({ signedIn: false, follows: [], place: apiPlace }, events, hosts, NOW);
  assert.equal(p.notice, null); // one is near
  assert.deepEqual(ids(p.list.events), ['a']);
  assert.deepEqual(ids(p.hosts), ['h1']);
  assert.deepEqual(ids(p.all), ['a', 'b']); // everything coming up, everywhere
  const none = planHome({ signedIn: false, follows: [], place: apiPlace }, [events[1]!], hosts, NOW);
  assert.equal(none.notice, 'nothingNear');
  // an event with no `near` still reads the area list
  const old = planHome(signedOut, [ev('x', 'h1', NEAR, 16, 1)], [], NOW);
  assert.equal(old.notice, null);
});

test('staff picks and promoted events match a real event by its slug', () => {
  const real = { ...ev('uuid-1', 'h1', 'Somewhere', 18, 1, true), slug: 'open-mic', near: true };
  const realHost = { ...host('uuid-h', '', 1, true), slug: 'punchline' };
  const picks = [{ kind: 'pick' as const, href: '/event/open-mic' }, { kind: 'pick' as const, href: '/host/punchline' }];
  const p = planHome({ signedIn: false, follows: [], place: { area: 'A', city: 'B', nearAreas: [] } }, [real], [realHost], NOW, () => false, picks);
  assert.deepEqual(slideIds(p.slides), ['uuid-1', 'uuid-h']);
});

test('upcoming lasts until the end time when there is one', () => {
  const going = { ...ev('going', 'h1', NEAR, 15, 1), startsAt: '2026-11-15T04:00:00+05:30', endsAt: '2026-11-16T04:00:00+05:30' };
  const p = planHome(signedOut, [going, ev('over', 'h1', NEAR, 14, 1)], [], NOW);
  assert.deepEqual(ids(p.all.length ? p.all : p.list.events), ['going']);
});

test('a mock venue host carries its own nearness', () => {
  const venue = { ...host('v', 'Gachibowli', 1), tile: 'sports', near: true };
  const apiPlace = { area: 'Hyderabad', city: 'Telangana', nearAreas: [] };
  const p = planHome({ signedIn: false, follows: [], place: apiPlace }, [{ ...ev('a', 'h1', 'X', 16, 1), near: true }], [venue], NOW);
  assert.deepEqual(ids(p.places), ['v']);
});
