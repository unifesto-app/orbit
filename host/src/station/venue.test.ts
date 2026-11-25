import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HOUR, type StationType } from './day.ts';
import { type Authed, contactOk, daysLeft, fieldWhy, fromStation, hoursOk, inTheWay, kindFrom, type KindForm, pinFrom, plural, priceLine, refusal, span, teamFrom, toStation, venueApi, weekSpan } from './venue.ts';

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
});

test("a refusal says the API's line, or that Orbit can't be reached", () => {
  assert.equal(refusal({ status: 0, error: { message: 'offline' } }), 'Can’t reach Orbit. Try again.');
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
      invites: [{ id: 'i1', contact: '+919000022010', accepted: true, acceptedBy: 'Nisha' }],
    },
    'u1',
  );
  assert.deepEqual(t.team, [
    { id: 'b', name: 'Asha', role: 'Admin', you: true, owner: true },
    { id: 'a', name: 'Ravi K.', role: 'Desk', you: undefined, owner: undefined },
  ]);
  assert.deepEqual(t.invites, [{ id: 'i1', contact: '+919000022010', accepted: true, acceptedBy: 'Nisha' }]);
});
