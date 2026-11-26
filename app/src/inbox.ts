// The notifications inbox (Notifications doc, "The inbox and where each message opens"; the owner picked the Rows take
// with a bell in Home's header from https://claude.ai/artifact/4H6dp7ssrQbNXCJ4kSBj2b, 19 Nov 2026). Pure, so it runs on
// Node in inbox.test.ts: where each message opens and its day and time. The screen is src/app/inbox.tsx; the items and
// read state come from the API (src/notices.ts, src/inboxStore.ts), which keeps 180 days.
import { indiaDay, indiaWhen } from './status.ts';

// What a message is about, and so the screen it opens. A refund outcome opens the ticket while there is one; a fully
// refunded booking has none, so it opens Refunds (the prototype's default, 19 Nov 2026). Host ("Your hosts") messages
// open Console, which left the app on 19 Nov, so the app's inbox doesn't carry them yet. `null`: nothing of its own to
// open (your data export is ready, a notice from Orbit staff); the row shows the whole message instead.
export type Opens =
  | { to: 'ticket' | 'refund' | 'event' | 'book' | 'room'; event: string }
  | { to: 'slot'; venue: string }
  | { to: 'host'; host: string }
  | { to: 'refunds' | 'security' | 'help' | 'request' }
  | null;

export type InboxItem = {
  id: string;
  at: string; // when it was sent, ISO
  from: string; // who it's from: a host, a meetup, "Orbit"; read out, not shown (the row shows its type's icon)
  kind: string; // what it is: "Announcement", "Tomorrow", "Near you", "Refund sent"
  type: 'announcement' | 'reminder' | 'follow' | 'near' | 'ticket' | 'refund' | 'inRoom' | 'thanks' | 'account'; // its icon
  text: string;
  picture: { event: string } | { host: string } | null; // the event's 3:4 poster, the host's logo, or Orbit's orb
  opens: Opens;
  read?: boolean; // opened already, on any phone
};

const DAY = 86_400_000;
const IST = 330 * 60_000;
const indiaDate = (t: number) => Math.floor((t + IST) / DAY);

// Where a message opens. `ticketOf` is the viewer's booking id for an event, while it's still a ticket. A ticket message
// with no ticket left (passed on, refunded) opens the event, whose page says so if the event is gone too: never a blank
// screen.
export function hrefFor(opens: Opens, ticketOf: (eventId: string) => string | undefined): string | null {
  if (!opens) return null;
  switch (opens.to) {
    case 'ticket':
    case 'refund': {
      const id = ticketOf(opens.event);
      return id ? `/ticket/${id}` : opens.to === 'refund' ? '/account/refunds' : `/event/${opens.event}`;
    }
    case 'event':
      return `/event/${opens.event}`;
    case 'book':
      return `/book/${opens.event}`;
    case 'room':
      return `/room/${opens.event}`;
    case 'slot':
      return `/slot/${opens.venue}`;
    case 'host':
      return `/host/${opens.host}`;
    case 'refunds':
      return '/account/refunds';
    case 'security':
      return '/account/security';
    case 'help':
      return '/account/help';
    case 'request':
      return '/account/host';
  }
}

// "Today", "Yesterday", "Wed 18 Nov", or "Wed 26 Nov 2025" from another year; India time.
export function dayLabel(at: string, now: number): string {
  const t = Date.parse(at);
  const ago = indiaDate(now) - indiaDate(t);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  const year = new Date(t + IST).getUTCFullYear();
  return year === new Date(now + IST).getUTCFullYear() ? indiaDay(at) : `${indiaDay(at)} ${year}`;
}

// "8:40 AM", India time.
export const timeLabel = (at: string) => indiaWhen(at).split(' · ')[1];

// Newest first, under a heading per day.
export function inboxDays<T extends Pick<InboxItem, 'at'>>(items: readonly T[], now: number): { day: string; items: T[] }[] {
  const days: { day: string; items: T[] }[] = [];
  for (const item of [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const day = dayLabel(item.at, now);
    const last = days.at(-1);
    if (last?.day === day) last.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days;
}

// Only a path inside the app is opened, never a web address and never `//host`, which the router would open as https:
// the last check on a message's or a push's screen (src/notices.ts, src/push.tsx), as their ids come off the wire.
export const inAppPath = (href: unknown): href is string => typeof href === 'string' && /^\/(?!\/)[\w\-/]*$/.test(href);

// The phone's answer about push, from expo-notifications' permission read (src/push.tsx). on: allowed (iOS's quiet
// "provisional" too). ask: the phone's prompt can still come up. blocked: only the phone's settings can turn it on.
// none: this build has no push. Android 13+ reports a phone never asked as denied but askable, so there "can ask again"
// means ask; iOS says undetermined plainly.
export type PushStatus = 'on' | 'ask' | 'blocked' | 'none';
export function pushStatusOf(p: { granted: boolean; status: string; canAskAgain: boolean; provisional?: boolean }, os: string): PushStatus {
  if (p.granted || p.provisional) return 'on';
  if (os === 'android') return p.canAskAgain ? 'ask' : 'blocked';
  return p.status === 'undetermined' ? 'ask' : 'blocked';
}
