import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PublicSlots, SlotHold } from '@orbit/contract';

import { bookable, publicStarts } from '../../api/src/slots/rules.ts';
import { confirmed, holdMsLeft, holdSheet, NO_HOLD, payForHold, PAYS, slotDays, slotMessage, slotsApi, startsFor, venueBar } from './slots.ts';

const H = '0b9d6a3e-1c2f-4f7a-9d1e-2a3b4c5d6e7f';

test('slotsApi: the X7 routes, public read unsigned, the rest signed in', async () => {
  const got: string[] = [];
  const rec = (signed: boolean) => async (method: string, path: string, body?: unknown) => {
    got.push(`${signed ? 'authed' : 'call'} ${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
    return { ok: true as const, data: null as never };
  };
  const s = slotsApi({ call: rec(false), authed: rec(true) } as never);
  const b = { stationId: 's1', start: '2026-11-26T18:00:00.000Z', hours: 1, count: 2 };
  await s.publicSlots(H);
  await s.publicSlots(H, '2026-11-27');
  await s.hold(H, b);
  await s.confirm(H, 'c1');
  await s.letGo(H, 'c1');
  await s.askAlert(H, b);
  await s.dropAlert(H, 'a1');
  assert.deepEqual(got, [
    `call GET /public/venues/${H}/slots`,
    `call GET /public/venues/${H}/slots?day=2026-11-27`,
    `authed POST /venues/${H}/holds ${JSON.stringify(b)}`,
    `authed POST /venues/${H}/holds/c1/confirm`,
    `authed DELETE /venues/${H}/holds/c1`,
    `authed POST /venues/${H}/alerts ${JSON.stringify(b)}`,
    `authed DELETE /venues/${H}/alerts/a1`,
  ]);
});

const hold: SlotHold = { id: 'c1', stationId: 's1', start: 'a', end: 'b', count: 1, holdEndsAt: null, status: 'paid', qr: 'q', code: 'ABCD2345' };
test('confirmed: booked, the 402 total to pay, or plain words', () => {
  assert.deepEqual(confirmed({ ok: true, data: hold }), { booked: hold });
  assert.deepEqual(confirmed({ ok: false, status: 402, error: { error: 'paymentNeeded', message: 'x', totalPaise: 120000 } as never }), { pay: 120000 });
  assert.deepEqual(confirmed({ ok: false, status: 409, error: { error: 'letGo', message: 'x' } }), { no: 'You let that hold go. Hold it again.' });
  assert.deepEqual(confirmed({ ok: false, status: 409, error: { error: 'full', message: 'x' } }), { no: slotMessage({ error: 'full', message: '' }) });
  // Unknown codes keep the API's own words (tooMany's two meanings, offline, signed out).
  assert.equal(slotMessage({ error: 'tooMany', message: 'Too many holds here in the last hour. Try again later.' }), 'Too many holds here in the last hour. Try again later.');
});

test('payForHold: the seam for X2, not ready', async () => {
  assert.equal(PAYS, false);
  const r = await payForHold(H, 'c1');
  assert.ok(!r.ok && r.error.error === 'paymentsOff');
  assert.ok('no' in confirmed(r));
});

test('slotDays: 14 India days from the API first, Today and Tomorrow by the phone’s India date; across a month', () => {
  const noon = Date.parse('2026-11-29T12:00:00+05:30');
  const d = slotDays('2026-11-29', noon);
  assert.equal(d.length, 14);
  assert.deepEqual(d.slice(0, 3), [
    { day: '2026-11-29', label: 'Today' },
    { day: '2026-11-30', label: 'Tomorrow' },
    { day: '2026-12-01', label: 'Tue 1 Dec' },
  ]);
  assert.equal(d[13]!.day, '2026-12-12');
  // 1 AM on the 30th, a café still on the 29th's opening: the first day is yesterday, by its date.
  const late = slotDays('2026-11-29', Date.parse('2026-11-30T01:00:00+05:30'));
  assert.deepEqual(late.slice(0, 3).map((x) => x.label), ['Sun 29 Nov', 'Today', 'Tomorrow']);
  // 11 PM UTC is already the next day in India.
  assert.equal(slotDays('2026-11-30', Date.parse('2026-11-29T23:00:00Z'))[0]!.label, 'Today');
});

const at = (t: string) => `2026-11-26T${t}:00+05:30`;
const iso = (t: string) => new Date(Date.parse(at(t))).toISOString();
test('startsFor: every step the booking covers must be listed, the fewest free across them', () => {
  const gaming = { step: 30, free: [{ at: iso('20:00'), free: 3 }, { at: iso('20:30'), free: 1 }, { at: iso('21:00'), free: 4 }, { at: iso('21:30'), free: 2 }] };
  assert.deepEqual(startsFor(gaming, 1), [
    { at: Date.parse(at('20:00')), free: 1 },
    { at: Date.parse(at('20:30')), free: 1 },
    { at: Date.parse(at('21:00')), free: 2 },
  ]);
  assert.deepEqual(startsFor(gaming, 2), [{ at: Date.parse(at('20:00')), free: 1 }]);
  const pitch = { step: 60, free: [{ at: iso('20:00'), free: 0 }, { at: iso('21:00'), free: 1 }] };
  assert.deepEqual(startsFor(pitch, 1).map((x) => x.free), [0, 1]); // a full start is still listed
  assert.deepEqual(startsFor(pitch, 3), []);
});

test('the public read’s list and startsFor agree with what hold() takes: the last start is the last bookable one', () => {
  const week = Array(7).fill([11, 26]) as [number, number][]; // 11 AM to 2 AM
  const now = Date.parse(at('18:20'));
  const opens = Date.parse(at('11:00'));
  const closes = opens + 15 * 3_600_000;
  for (const step of [30, 60])
    for (const hours of [1, 2]) {
      const free = publicStarts(opens, closes, step, now).map((t) => ({ at: new Date(t).toISOString(), free: 1 }));
      const starts = startsFor({ step, free }, hours).map((x) => x.at);
      const ok = free.map((f) => Date.parse(f.at)).filter((t) => bookable(week, step, t, hours, now));
      assert.deepEqual(starts, ok, `step ${step}, ${hours}h`);
      assert.equal(starts.at(-1), closes - hours * 3_600_000, `step ${step}, ${hours}h ends at closing`);
    }
});

const tick: SlotHold = { ...hold, status: 'held', qr: null, code: null };
test('holdSheet: hold, confirm, booked; lapsed by the clock from receipt; a pick lets go; busy ignores picks', () => {
  const t0 = Date.parse(at('20:00'));
  let s = holdSheet(NO_HOLD, { t: 'busy' });
  assert.equal(holdSheet(s, { t: 'pick' }), s); // busy: a pick is ignored
  s = holdSheet(s, { t: 'held', hold: tick, at: t0 });
  assert.equal(s.busy, true);
  s = holdSheet(s, { t: 'done' });
  assert.equal(holdMsLeft(s, t0 + 30_000), 570_000); // from receipt, whatever the server's clock says
  assert.equal(holdMsLeft(s, t0 + 600_000), 0); // lapsed
  const booked = holdSheet(holdSheet(s, { t: 'busy' }), { t: 'booked', hold });
  assert.equal(booked.booked, hold);
  assert.equal(holdMsLeft(booked, t0), 0); // booked: no countdown
  assert.deepEqual(holdSheet({ ...s, said: 'x', asked: true }, { t: 'pick' }), NO_HOLD); // a pick drops it all
  assert.equal(holdSheet({ ...s, said: 'x' }, { t: 'busy' }).said, null); // a new call clears the last word
  assert.equal(holdSheet(s, { t: 'asked' }).asked, true);
});

test('venueBar: cheapest hour (off-peak too) and the next start with room', () => {
  const st = (pricePaise: number, free: { at: string; free: number }[], off?: number) =>
    ({ step: 30, pricePaise, offPeak: off ? { from: 10, to: 16, weekdays: false, pricePaise: off } : null, free }) as unknown as PublicSlots['stations'][number];
  const p = {
    day: '2026-11-26',
    opening: null,
    stations: [
      st(50000, [{ at: iso('20:00'), free: 0 }, { at: iso('20:30'), free: 0 }, { at: iso('21:00'), free: 2 }, { at: iso('21:30'), free: 2 }], 35000),
      st(40000, [{ at: iso('20:30'), free: 1 }]), // the last half hour before closing: no hour starts there
    ],
  };
  assert.deepEqual(venueBar(p), { fromPaise: 35000, next: Date.parse(at('21:00')) });
  assert.deepEqual(venueBar({ ...p, stations: [st(0, [])] }), { fromPaise: 0, next: null });
  assert.equal(venueBar({ ...p, stations: [] }), null);
});
