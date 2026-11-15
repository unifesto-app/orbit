import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Me, eventsOn, hasFeature, me, modesFor, nobody, onEventDay, previews, roleOn, seesEventMoney, seesHostMoney } from './modes.ts';

const staff = (over: Partial<Me> = {}): Me => ({ ...me, ...over });

test('each kind of person gets their three cards', () => {
  assert.deepEqual(modesFor(previews.staff), { console: 'open', third: 'galaxy' });
  assert.deepEqual(modesFor(previews.host), { console: 'open', third: 'checkin' });
  assert.deepEqual(modesFor(previews.attendee), { console: 'start', third: 'saved' });
  // Default deny: no account means no Galaxy and no Console.
  assert.deepEqual(modesFor(nobody), { console: 'start', third: 'saved' });
});

test('Galaxy needs confirmed staff access to at least one feature, and no passkey', () => {
  assert.equal(modesFor(me).third, 'galaxy');
  assert.equal(modesFor(staff({ staff: { owner: false, features: ['money'], confirmed: true } })).third, 'galaxy');
  assert.notEqual(modesFor(staff({ staff: { owner: false, features: ['money'], confirmed: false } })).third, 'galaxy');
  assert.notEqual(modesFor(staff({ staff: { owner: false, features: [], confirmed: true } })).third, 'galaxy');
});

test('staff see only the features they hold; the platform owner holds them all', () => {
  const money = staff({ staff: { owner: false, features: ['money'], confirmed: true } });
  assert.equal(hasFeature(money, 'money'), true);
  assert.equal(hasFeature(money, 'people'), false);
  assert.equal(hasFeature(staff({ staff: { owner: true, features: [], confirmed: true } }), 'staff'), true);
  assert.equal(hasFeature(nobody, 'queues'), false);
});

test('money: Admins see the host, Curators their own event, nobody else', () => {
  const [admin, curator, crew] = me.teams;
  assert.equal(seesHostMoney(admin), true);
  assert.equal(seesHostMoney(curator), false);
  assert.equal(seesEventMoney(curator, 'build-anything-hackathon'), true);
  assert.equal(seesEventMoney(curator, 'another-night'), false);
  assert.equal(seesEventMoney(crew, 'sunday-5-a-side'), false);
  assert.equal(roleOn(crew, 'sunday-5-a-side'), 'Crew');
});

test('an event role sees only its own events; an Admin sees the host’s', () => {
  const evs = [
    { id: 'build-anything-hackathon', hostId: 'circuitfeed' },
    { id: 'another-night', hostId: 'circuitfeed' },
    { id: 'open-mic-night', hostId: 'punchline' },
  ];
  assert.deepEqual(eventsOn(me.teams[1], evs).map((e) => e.id), ['build-anything-hackathon']);
  assert.deepEqual(eventsOn(me.teams[0], evs).map((e) => e.id), ['open-mic-night']);
});

test('event day runs from 24 hours before the start to 3 hours after the end', () => {
  const at = (iso: string) => Date.parse(iso);
  const [start, end] = ['2026-11-20T20:00:00+05:30', '2026-11-20T23:00:00+05:30'];
  assert.equal(onEventDay(start, end, at('2026-11-19T19:59:00+05:30')), false);
  assert.equal(onEventDay(start, end, at('2026-11-19T20:00:00+05:30')), true);
  assert.equal(onEventDay(start, end, at('2026-11-21T02:00:00+05:30')), true);
  assert.equal(onEventDay(start, end, at('2026-11-21T02:01:00+05:30')), false);
});
