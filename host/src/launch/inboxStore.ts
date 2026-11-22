// Launch's Inbox messages and which are read, shared by the Inbox and the count on its circle beside the tabs. The
// messages are the Notifications flow's to hosts (Hosts and crew): refund requests, crew and "with" answers, the summary
// after an event, payouts paid and the bank account's check, for Punchline Collective on Fri 20 Nov. As the Orbit app's
// inbox (app/src/inboxStore.ts), only what the Inbox shows (the last 180 days) is listed or counted.
// ponytail: mock messages and read state in memory, so a fresh launch shows them new again; the API's inbox, refreshed
// on open and every minute, replaces both.
import { useSyncExternalStore } from 'react';

import { now } from './data';
import { type Message, kept, unreadCount } from './inbox';

const messages: Message[] = [
  { id: 'l6', at: '2026-11-20T18:12:00+05:30', from: 'Open Mic Night', kind: 'Refund request', text: 'Ritika asked for ₹299 back. It’s under 24 hours to the show, so Orbit decides.', picture: { event: 'open-mic-night' } },
  { id: 'l5', at: '2026-11-20T16:30:00+05:30', from: 'Open Mic Night', kind: 'Crew', text: 'Vikram Shetty accepted Crew for tonight and can scan from now.', picture: { event: 'open-mic-night' } },
  {
    id: 'l4',
    at: '2026-11-20T11:05:00+05:30',
    from: 'Arjun Rao',
    kind: 'With you',
    text: 'Arjun Rao said yes to New Year’s Eve Open Mic. It shows on their page once you publish.',
    picture: { host: { name: 'Arjun Rao', initials: 'AR', bg: '#F25C2A', fg: '#FFFFFF' } },
  },
  { id: 'l3', at: '2026-11-14T10:00:00+05:30', from: 'Open Mic Night', kind: 'How it went', text: '35 of 38 came on Fri 13 Nov, with ₹11,362 in ticket sales. Its payout opens Mon 16 Nov.', picture: { event: 'open-mic-night-13-nov' }, read: true },
  { id: 'l2', at: '2026-11-10T15:20:00+05:30', from: 'Orbit', kind: 'Payout paid', text: '₹10,764 for Open Mic Night, Fri 6 Nov, is in your bank. UTR ending 4471.', picture: null, read: true },
  { id: 'l1', at: '2026-11-09T11:45:00+05:30', from: 'Orbit', kind: 'Bank account', text: 'HDFC Bank •••• 4821 is verified. Your payouts go here.', picture: null, read: true },
];

let read: ReadonlySet<string> = new Set(messages.filter((m) => m.read).map((m) => m.id));
const listeners = new Set<() => void>();
const subscribe = (on: () => void) => {
  listeners.add(on);
  return () => listeners.delete(on);
};
const readNow = () => read;

/** Marks messages read; the Inbox's dots and the circle's count follow. */
export function markRead(ids: readonly string[]) {
  if (ids.every((id) => read.has(id))) return;
  read = new Set([...read, ...ids]);
  for (const on of listeners) on();
}

/** The messages the Inbox shows, each with whether it's read. */
export function useInbox() {
  const seen = useSyncExternalStore(subscribe, readNow);
  return kept(messages, now).map((m) => ({ ...m, read: seen.has(m.id) }));
}

/** How many of those are new, for the count on the Inbox circle. */
export function useUnread() {
  const seen = useSyncExternalStore(subscribe, readNow);
  return unreadCount(messages, seen, now);
}
