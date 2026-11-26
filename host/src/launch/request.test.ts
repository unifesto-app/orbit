import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  atIst,
  bodyOf,
  canSkip,
  dayOpen,
  emptyDraft,
  errorText,
  fromRequest,
  monthDays,
  monthLabel,
  readDraft,
  sentLabel,
  shiftMonth,
  slots,
  stepOk,
  welcomeState,
  whenLabel,
} from './request.ts';

const NOW = Date.parse('2026-11-26T11:40:00+05:30'); // a Thursday, 11:40 AM in India
const host = { ...emptyDraft('Hyderabad'), name: 'Punchline Comedy', kind: 'comedy-group' };
const full = { ...host, title: 'Open Mic Friday', category: 'comedy', startsAt: '2026-12-12T19:30:00+05:30', paid: true, size: '80' };

test('welcome follows the latest request', () => {
  assert.equal(welcomeState(null), 'start');
  assert.equal(welcomeState({ status: 'withdrawn' }), 'start');
  assert.equal(welcomeState({ status: 'open' }), 'waiting');
  assert.equal(welcomeState({ status: 'changes' }), 'changes');
  assert.equal(welcomeState({ status: 'declined' }), 'declined');
  assert.equal(welcomeState({ status: 'approved' }), 'approved');
  assert.equal(sentLabel('2026-11-26T06:10:00Z', NOW), 'Sent today, 11:40 AM');
  assert.equal(sentLabel('2026-11-23T17:30:00Z', NOW), 'Sent Mon 23 Nov, 11 PM');
});

test('each step goes on once the contract accepts it', () => {
  assert.equal(stepOk(emptyDraft('Hyderabad'), 1, NOW), false);
  assert.equal(stepOk({ ...host, city: 'Atlantis' }, 1, NOW), false); // not on the list
  assert.equal(stepOk({ ...host, name: '   ' }, 1, NOW), false);
  assert.equal(stepOk(host, 1, NOW), true);
  assert.equal(stepOk(host, 2, NOW), false);
  assert.equal(stepOk(full, 2, NOW), true);
  assert.equal(stepOk({ ...full, size: '' }, 2, NOW), true); // optional
  assert.equal(stepOk({ ...full, size: '8.5' }, 2, NOW), false);
  assert.equal(stepOk({ ...full, size: '0' }, 2, NOW), false);
  assert.equal(stepOk({ ...full, startsAt: '2026-11-26T11:30:00+05:30' }, 2, NOW), false); // already past
  assert.equal(stepOk(full, 3, NOW), true);
  assert.equal(stepOk({ ...host, skip: true }, 3, NOW), false); // a comedy group needs its event
});

test('only a Venue or Performer can skip the event', () => {
  assert.equal(canSkip(host), false);
  assert.equal(canSkip({ ...host, kind: 'venue' }), true);
  assert.equal(canSkip({ ...host, kind: 'performer' }), true);
  const venue = { ...host, kind: 'venue', skip: true };
  assert.equal(stepOk(venue, 3, NOW), true);
  assert.equal(bodyOf(venue).event, null);
});

test('the body sent, and a sent request back in the steps', () => {
  const body = bodyOf({ ...full, about: '  ', venue: ' Hitech City ' });
  assert.deepEqual(body, {
    host: { name: 'Punchline Comedy', kind: 'comedy-group', city: 'Hyderabad', about: null },
    event: { title: 'Open Mic Friday', category: 'comedy', startsAt: '2026-12-12T19:30:00+05:30', venue: 'Hitech City', paid: true, expectedSize: 80 },
  });
  const back = fromRequest(body as Parameters<typeof fromRequest>[0], true);
  assert.equal(back.edit, true);
  assert.equal(back.size, '80');
  assert.deepEqual(bodyOf(back), body);
  assert.equal(readDraft(JSON.stringify(full))?.title, 'Open Mic Friday');
  assert.equal(readDraft('{bad'), null);
  assert.equal(readDraft('{"x":1}'), null);
});

test('API refusals in plain words', () => {
  assert.match(errorText({ error: 'requestOpen', message: '' }), /One at a time/);
  assert.match(errorText({ error: 'tooMany', message: '' }), /five requests a day/);
  assert.match(errorText({ error: 'past', message: '' }), /still ahead/);
  assert.equal(errorText({ error: 'offline', message: 'Can’t reach Orbit.' }), 'Can’t reach Orbit.');
});

test('the When sheet: a Monday-first month, past days and times left out, India time', () => {
  const dec = monthDays('2026-12');
  assert.equal(dec[0], null); // 1 Dec 2026 is a Tuesday
  assert.equal(dec[1], '2026-12-01');
  assert.equal(dec.length, 1 + 31);
  assert.equal(monthLabel('2026-12'), 'December 2026');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(dayOpen('2026-11-25', NOW), false);
  assert.equal(dayOpen('2026-11-26', NOW), true);
  assert.equal(slots('2026-11-26', NOW)[0], 12 * 60); // 11:40 now, so noon first
  assert.equal(slots('2026-11-27', NOW).length, 36); // 6 AM to 11:30 PM
  assert.equal(dayOpen('2026-11-26', Date.parse('2026-11-26T23:45:00+05:30')), false); // nothing left tonight
  assert.equal(atIst('2026-12-12', 19 * 60 + 30), '2026-12-12T19:30:00+05:30');
  assert.equal(whenLabel('2026-12-12T14:00:00Z'), 'Sat 12 Dec · 7:30 PM');
});
