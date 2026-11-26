import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HOUR, type StationType } from './day.ts';
import { type Authed, contactOk, daysLeft, fieldWhy, fromStation, hoursOk, inTheWay, inviteBody, kindBody, kindFrom, type KindForm, pinFrom, plural, priceLine, notSetUp, putFor, readVenue, refusal, span, type StationRowish, teamFrom, toStation, venueApi, weekSpan } from './venue.ts';

const pc: StationType = { id: 'pc', name: 'Gaming PC', count: 12, unit: ['PC', 'PCs'], step: 30, whole: false, price: 16200, offPeak: { from: 11, to: 16, weekdays: true, price: 12000 }, coop: 35000, games: 'Valorant, CS2' };

test('a kind reads with its price, off-peak, co-op and games', () => {
  assert.equal(priceLine(pc), '₹162/hr · ₹120/hr 11 AM to 4 PM on weekdays · ₹350/hr for two · Valorant, CS2');
  assert.equal(priceLine({ ...pc, offPeak: undefined, coop: undefined, games: undefined, price: 50000 }), '₹500/hr');
});

test('hours read as Venue writes them, past midnight too', () => {
  assert.deepEqual([span([11, 26]), span([6, 24]), span([5, 23]), span(null)], ['11 AM to 2 AM', '6 AM to midnight', '5 AM to 11 PM', 'Closed']);
});

test('an invite has 14 days, counted down by whole days', () => {
  const sent = Date.UTC(2026, 10, 19, 12);
  assert.deepEqual([daysLeft(sent, sent), daysLeft(sent, sent + 3 * 24 * HOUR + HOUR), daysLeft(sent, sent + 20 * 24 * HOUR)], [14, 11, 0]);
});

test('an invite goes to a phone number or an email', () => {
  assert.deepEqual(['+91 90000 22010', '9000022010', 'ravi@example.com', '12345', 'ravi@', 'call me'].map(contactOk), [true, true, true, false, false, false]);
});

test('bookings in the way: the first three named, then how many more', () => {
  assert.equal(inTheWay(['a', 'b'], (x) => x), 'a; b');
  assert.equal(inTheWay(['a', 'b', 'c', 'd', 'e'], (x) => x), 'a; b; c, and 2 more');
});

test('more than one: pitches, boxes, PCs, bays', () => {
  assert.deepEqual(['pitch', 'box', 'PC', 'bay', 'court', 'bus'].map(plural), ['pitches', 'boxes', 'PCs', 'bays', 'courts', 'buses']);
});

test('a day opens before it closes, at most a day long, and may open at midnight', () => {
  assert.deepEqual([[0, 5], [0, 24], [11, 26], [6, 30]].map((o) => hoursOk(o as [number, number])), [true, true, true, true]);
  assert.deepEqual([[6, 5], [6, 6], [11, 36], [34, 58], [0, 25]].map((o) => hoursOk(o as [number, number])), [false, false, false, false, false]);
});

test("a kind from Venue's sheet: prices in rupees, off-peak cheaper and inside the opening, a new one's plural", () => {
  const form: KindForm = { name: 'Racing sim', unit: 'rig', count: 3, price: '300', coop: '', op: 'none', opFrom: 11, opTo: 16, opPrice: '', games: 'F1 24' };
  const made = kindFrom(form, undefined, [11, 26], true, 'k1');
  assert.ok('kind' in made && made.kind.unit[1] === 'rigs' && made.kind.step === 30 && !made.kind.whole && made.kind.price === 30000 && made.kind.games === 'F1 24');
  const pitch = kindFrom({ ...form, name: 'Futsal', unit: 'pitch', games: 'x' }, undefined, [6, 24], false, 'k2');
  assert.ok('kind' in pitch && pitch.kind.unit[1] === 'pitches' && pitch.kind.whole && pitch.kind.step === 60 && pitch.kind.games === undefined);
  const why = (f: Partial<KindForm>, open: [number, number] = [11, 26]) => {
    const r = kindFrom({ ...form, ...f }, undefined, open, true, 'k');
    return 'why' in r ? r.why : 'ok';
  };
  assert.equal(why({ unit: '' }), 'Say what one is called, like PC or pitch.');
  assert.equal(why({ price: '1000,50' }), 'Its price an hour, in rupees.');
  assert.equal(why({ op: 'weekdays', opPrice: '300' }), 'Off-peak is cheaper than the price an hour.');
  assert.equal(why({ op: 'weekdays', opPrice: '200', opFrom: 9, opTo: 16 }), 'Off-peak hours sit inside your opening, before midnight.'); // before opening
  assert.equal(why({ op: 'every', opPrice: '200', opFrom: 22, opTo: 26 }), 'Off-peak hours sit inside your opening, before midnight.'); // past midnight
  assert.equal(why({ op: 'every', opPrice: '200', opFrom: 22, opTo: 24 }), 'ok');
});

test('each venue request sends its method, path and body', async () => {
  const sent: unknown[][] = [];
  const authed = (async (...a: unknown[]) => (sent.push(a), { ok: true, data: null })) as Authed;
  const v = venueApi('h1', authed);
  await v.get();
  await v.put({ address: 'x' });
  await v.addStation({ name: 'PC', tile: 'gaming' });
  await v.editStation('s1', { archived: true });
  await v.team();
  await v.invite({ to: 'ravi@example.com', role: 'desk' });
  await v.confirm('t1');
  await v.remove('t1');
  assert.deepEqual(sent, [
    ['GET', '/venues/h1'],
    ['PUT', '/venues/h1', { address: 'x' }],
    ['POST', '/venues/h1/stations', { name: 'PC', tile: 'gaming' }],
    ['PATCH', '/venues/h1/stations/s1', { archived: true }],
    ['GET', '/hosts/h1/team'],
    ['POST', '/hosts/h1/team', { to: 'ravi@example.com', role: 'desk' }],
    ['POST', '/hosts/h1/team/t1/confirm'],
    ['DELETE', '/hosts/h1/team/t1'],
  ]);
});

test("a kind goes to the API in paise and comes back the same; the sheet's rupees become paise", () => {
  const body = toStation(pc);
  assert.deepEqual(body, { name: 'Gaming PC', unit: 'PC', count: 12, pricePaise: 16200, coopPaise: 35000, offPeak: { from: 11, to: 16, weekdays: true, pricePaise: 12000 }, games: 'Valorant, CS2' });
  assert.deepEqual(fromStation({ ...body, id: 'pc', whole: false, step: 30, archived: false }), pc);
  const bare = toStation({ ...pc, coop: undefined, offPeak: undefined, games: undefined });
  assert.deepEqual([bare.coopPaise, bare.offPeak, bare.games], [null, null, null]);
  const made = kindFrom({ name: 'PS5', unit: 'PS5', count: 4, price: '250.50', coop: '', op: 'none', opFrom: 11, opTo: 16, opPrice: '', games: '' }, undefined, [11, 26], true, 'k');
  assert.ok('kind' in made && toStation(made.kind).pricePaise === 25050);
});

test("the week's span for off-peak: earliest opening to latest close, all closed a full day", () => {
  assert.deepEqual(weekSpan([null, [11, 26], [10, 23], null, null, null, [12, 24]]), [10, 26]);
  assert.deepEqual(weekSpan(Array(7).fill(null)), [0, 24]);
});

test('a map pin from Google Maps: the copied numbers or a link', () => {
  assert.deepEqual(pinFrom('17.4401, 78.3489'), { lat: 17.4401, lng: 78.3489 });
  assert.deepEqual(pinFrom('https://www.google.com/maps/@17.4401,78.3489,17z'), { lat: 17.4401, lng: 78.3489 });
  assert.equal(pinFrom('Gachibowli'), undefined);
  assert.deepEqual(pinFrom('17, 78'), { lat: 17, lng: 78 }); // whole numbers
  assert.equal(pinFrom('117.44, 78.35'), undefined); // never 17.44 out of 117.44
  assert.deepEqual(pinFrom('https://www.google.com/maps/place/X/@17.40,78.30,17z/data=!3m1!4b1!4m6!3m5!8m2!3d17.4401!4d78.3489'), { lat: 17.4401, lng: 78.3489 }); // the place, not the view
});

test("a refusal says the API's line, or that Orbit can't be reached", () => {
  assert.equal(refusal({ status: 0, error: { message: 'offline' } }), 'Can’t reach Orbit. Try again.');
  assert.equal(refusal({ status: 0, error: { message: 'offline' } }, true), 'It may have gone through. Check before trying again.');
  assert.equal(refusal({ status: 409, error: { message: '1 booking needs the old hours.' } }), '1 booking needs the old hours.');
  assert.equal(fieldWhy({ issues: [{ code: 'custom', path: ['week'], message: "A day's late close runs into the next day's opening." }] }), "A day's late close runs into the next day's opening.");
  assert.equal(fieldWhy({ issues: [{ code: 'too_big', path: ['lat'], message: 'Too big' }] }), 'Check the map pin.');
});

test('the team: Admins and Desk only, the owner first, you marked; invites by seat', () => {
  const t = teamFrom(
    {
      members: [
        { id: 'a', userId: 'u2', name: 'Ravi K.', role: 'crew', owner: false },
        { id: 'b', userId: 'u1', name: 'Asha', role: 'admin', owner: true },
        { id: 'c', userId: 'u3', name: null, role: 'curator', owner: false },
      ],
      invites: [
        { id: 'i1', contact: '+919000022010', role: 'admin', sentAt: '2026-11-20T10:00:00.000Z', accepted: true, acceptedBy: 'Nisha', addedBy: 'u1' },
        { id: 'i3', contact: '+919000022011', role: 'crew', sentAt: '2026-11-21T10:00:00.000Z', accepted: false, acceptedBy: null, addedBy: 'u1' },
        { id: 'i2', contact: 'x@example.com', accepted: true, acceptedBy: 'Om', addedBy: 'u2' }, // an older API: no role or sent time
      ],
    },
    'u1',
  );
  assert.deepEqual(t.team, [
    { id: 'b', name: 'Asha', role: 'Admin', you: true, owner: true },
    { id: 'a', name: 'Ravi K.', role: 'Desk', you: undefined, owner: undefined },
  ]);
  assert.deepEqual(t.invites, [
    { id: 'i1', contact: '+919000022010', role: 'Admin', sent: Date.parse('2026-11-20T10:00:00.000Z'), accepted: true, acceptedBy: 'Nisha', addedBy: 'u1', byYou: true, adder: 'Asha' },
    { id: 'i3', contact: '+919000022011', role: 'Desk', sent: Date.parse('2026-11-21T10:00:00.000Z'), accepted: false, acceptedBy: null, addedBy: 'u1', byYou: true, adder: 'Asha' },
    { id: 'i2', contact: 'x@example.com', role: undefined, sent: undefined, accepted: true, acceptedBy: 'Om', addedBy: 'u2', byYou: false, adder: 'Ravi K.' },
  ]);
});

const fresh = {
  address: 'Above Inorbit Mall, Gachibowli', area: 'Gachibowli', lat: 17.44, lng: 78.35, placeId: 'gp1', deskPhone: '+91 90000 11001',
  week: Array.from({ length: 7 }, () => [11, 26] as [number, number]), cutoffMinutes: 90, logsWalkIns: true,
  stations: [] as StationRowish[],
};

test('the PUT is made on the fresh venue: each edit keeps the pin, place, cutoff and walk-ins it didn’t touch', () => {
  const kept = { lat: 17.44, lng: 78.35, placeId: 'gp1', cutoffMinutes: 90, logsWalkIns: true };
  const pick = (b: ReturnType<typeof putFor>) => ({ lat: b.lat, lng: b.lng, placeId: b.placeId, cutoffMinutes: b.cutoffMinutes, logsWalkIns: b.logsWalkIns });
  assert.deepEqual(pick(putFor(fresh, (x) => ({ ...x, deskPhone: '+91 90000 22222' }))), kept);
  assert.deepEqual(pick(putFor(fresh, (x) => ({ ...x, week: x.week.map((w, i) => (i === 0 ? null : w)) }))), kept);
  assert.deepEqual(pick(putFor(fresh, (x) => ({ ...x, address: 'Ground floor', area: 'Kondapur' }))), kept); // the pin unmoved keeps its place
  assert.deepEqual(putFor(fresh, (x) => ({ ...x, cutoff: 240 })).cutoffMinutes, 240);
  assert.deepEqual(pick(putFor(fresh, (x) => ({ ...x, logWalkIns: false }))), { ...kept, logsWalkIns: false });
  const moved = putFor(fresh, (x) => ({ ...x, pin: { lat: 17.45, lng: 78.35, placeId: x.pin?.placeId ?? null } }));
  assert.deepEqual([moved.lat, moved.placeId, moved.cutoffMinutes, moved.logsWalkIns], [17.45, null, 90, true]); // a moved pin drops its place
  assert.equal(putFor(fresh, (x) => ({ ...x, deskPhone: '1' })).address, fresh.address);
});

test('the venue read: a noVenue 404 is not set up yet, a notFound 404 is the seat gone, a payload the contract refuses is an error', () => {
  const check = (x: unknown) => ((x as { hostId?: string }).hostId ? x : undefined);
  assert.deepEqual(readVenue({ ok: false, status: 404, error: { error: 'noVenue', message: '' } }, check), { ok: true, data: null });
  const lost = readVenue({ ok: false, status: 404, error: { error: 'notFound', message: '' } }, check);
  assert.ok(!lost.ok && lost.status === 404 && lost.error.error === 'notFound');
  assert.ok(!notSetUp(lost) && notSetUp({ status: 404, error: { error: 'noVenue' } }));
  assert.deepEqual(readVenue({ ok: true, data: { hostId: 'h1' } }, check), { ok: true, data: { hostId: 'h1' } });
  const bad = readVenue({ ok: true, data: { nope: 1 } }, check);
  assert.ok(!bad.ok && bad.error.error === 'unreadable');
  const down = readVenue({ ok: false, status: 0, error: { error: 'offline', message: '' } }, check);
  assert.ok(!down.ok && down.status === 0);
});

test('an edit leaves out what one is called; a new kind says its tile; Desk invites a desk seat, Admin an admin', () => {
  const edit = kindBody(pc, true, 'gaming');
  assert.ok('edit' in edit && !('unit' in edit.edit) && !('tile' in edit.edit) && edit.edit.pricePaise === 16200);
  const add = kindBody(pc, false, 'sports');
  assert.ok('add' in add && add.add.unit === 'PC' && add.add.tile === 'sports');
  assert.deepEqual(inviteBody(' ravi@example.com ', 'Desk'), { to: 'ravi@example.com', role: 'desk' });
  assert.deepEqual(inviteBody('+91 90000 22010', 'Admin'), { to: '+91 90000 22010', role: 'admin' });
});
