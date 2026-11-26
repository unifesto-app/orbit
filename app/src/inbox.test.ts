import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dayLabel, hrefFor, inAppPath, inboxDays, pushStatusOf, timeLabel } from './inbox.ts';

const NOW = Date.parse('2026-11-20T09:00:00+05:30');
const ticketOf = (e: string) => (e === 'open-mic-night' ? 'BK-7Q2M9X' : undefined);

test('each message opens its own screen', () => {
  assert.equal(hrefFor({ to: 'ticket', event: 'open-mic-night' }, ticketOf), '/ticket/BK-7Q2M9X');
  // No ticket left: the event, whose page says so if it's gone too.
  assert.equal(hrefFor({ to: 'ticket', event: 'sunday-jam' }, ticketOf), '/event/sunday-jam');
  // A refund opens the ticket while there is one, else Refunds.
  assert.equal(hrefFor({ to: 'refund', event: 'open-mic-night' }, ticketOf), '/ticket/BK-7Q2M9X');
  assert.equal(hrefFor({ to: 'refund', event: 'campus-esports-cup' }, ticketOf), '/account/refunds');
  assert.equal(hrefFor({ to: 'room', event: 'design-critique-18-nov' }, ticketOf), '/room/design-critique-18-nov');
  assert.equal(hrefFor({ to: 'slot', venue: 'kickoff-arena' }, ticketOf), '/slot/kickoff-arena');
  assert.equal(hrefFor({ to: 'security' }, ticketOf), '/account/security');
  assert.equal(hrefFor({ to: 'event', event: 'sunday-jam' }, ticketOf), '/event/sunday-jam');
  assert.equal(hrefFor({ to: 'book', event: 'campus-esports-cup' }, ticketOf), '/book/campus-esports-cup');
  assert.equal(hrefFor({ to: 'host', host: 'punchline' }, ticketOf), '/host/punchline');
  assert.equal(hrefFor({ to: 'refunds' }, ticketOf), '/account/refunds');
  assert.equal(hrefFor({ to: 'help' }, ticketOf), '/account/help');
  assert.equal(hrefFor({ to: 'request' }, ticketOf), '/account/host');
  assert.equal(hrefFor(null, ticketOf), null);
});

test('days and times read in India time', () => {
  assert.equal(dayLabel('2026-11-20T00:10:00+05:30', NOW), 'Today');
  // 23:30 UTC on the 19th is already the 20th in India.
  assert.equal(dayLabel('2026-11-19T23:30:00Z', NOW), 'Today');
  assert.equal(dayLabel('2026-11-19T23:50:00+05:30', NOW), 'Yesterday');
  assert.equal(dayLabel('2026-11-18T18:00:00+05:30', NOW), 'Wed 18 Nov');
  assert.equal(dayLabel('2025-11-26T10:00:00+05:30', NOW), 'Wed 26 Nov 2025');
  assert.equal(timeLabel('2026-11-20T08:40:00+05:30'), '8:40 AM');
  assert.equal(timeLabel('2026-11-19T12:05:00+05:30'), '12:05 PM');
});

test('newest first, a heading per day', () => {
  const at = (iso: string) => ({ at: iso });
  const days = inboxDays(
    [at('2026-11-18T18:00:00+05:30'), at('2026-11-20T08:40:00+05:30'), at('2026-05-20T09:00:00+05:30'), at('2026-11-20T07:00:00+05:30'), at('2026-05-24T10:00:00+05:30')],
    NOW,
  );
  assert.deepEqual(
    days.map((d) => [d.day, d.items.map((x) => x.at.slice(5, 16))]),
    [
      ['Today', ['11-20T08:40', '11-20T07:00']],
      ['Wed 18 Nov', ['11-18T18:00']],
      ['Sun 24 May', ['05-24T10:00']],
      ['Wed 20 May', ['05-20T09:00']],
    ],
  );
});

test('a push opens only a path inside the app', () => {
  assert.equal(inAppPath('/ticket/BK-7Q2M9X'), true);
  assert.equal(inAppPath('/account/refunds'), true);
  assert.equal(inAppPath('//evil.example/x'), false); // the router would open it as https
  assert.equal(inAppPath('https://evil.example'), false);
  assert.equal(inAppPath('/a?b=1'), false);
  assert.equal(inAppPath('ticket/BK'), false);
  assert.equal(inAppPath(42), false);
});

test("the phone's answer about push", () => {
  const p = (granted: boolean, status: string, canAskAgain: boolean, provisional = false) => ({ granted, status, canAskAgain, provisional });
  assert.equal(pushStatusOf(p(true, 'granted', true), 'ios'), 'on');
  assert.equal(pushStatusOf(p(false, 'undetermined', true, true), 'ios'), 'on'); // provisional
  assert.equal(pushStatusOf(p(false, 'undetermined', true), 'ios'), 'ask');
  assert.equal(pushStatusOf(p(false, 'denied', false), 'ios'), 'blocked');
  // Android 13+: never asked reads as denied but askable.
  assert.equal(pushStatusOf(p(false, 'denied', true), 'android'), 'ask');
  assert.equal(pushStatusOf(p(false, 'denied', false), 'android'), 'blocked');
});
