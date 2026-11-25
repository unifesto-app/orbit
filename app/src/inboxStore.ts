// The inbox's messages and what's unread, for the inbox screen (src/app/inbox.tsx), Home's bell and a ticket's
// announcement. The messages are the Notifications doc's, on the app's mock week (now is Fri 20 Nov, 9 AM), as the
// prototype the owner picked from showed them. Read state is the session's until the API's inbox carries it.
// ponytail: static messages, like src/mock.ts; GET of the inbox (refreshed on open and every minute) replaces them.
import { useMemo } from 'react';

import { ticketFor } from './account/data';
import { hrefFor, type InboxItem, isKept } from './inbox';
import { now } from './mock';
import { useRead } from './session';

const items: InboxItem[] = [
  { id: 'n12', at: '2026-11-20T08:40:00+05:30', from: 'Punchline Collective', kind: 'Announcement', type: 'announcement', text: 'Doors open at 7:30 tonight. Spots on the list close at 7:45.', picture: { event: 'open-mic-night' }, opens: { to: 'ticket', event: 'open-mic-night' } },
  { id: 'n11', at: '2026-11-19T20:10:00+05:30', from: 'Design Critique Night', kind: 'inRoom', type: 'inRoom', text: 'Ananya Desai wants to connect.', picture: { event: 'design-critique-18-nov' }, opens: { to: 'room', event: 'design-critique-18-nov' } },
  { id: 'n10', at: '2026-11-19T19:00:00+05:30', from: 'Punchline Collective', kind: 'Tomorrow', type: 'reminder', text: 'Open Mic Night, tomorrow at 8:00 PM at The Green Room.', picture: { event: 'open-mic-night' }, opens: { to: 'ticket', event: 'open-mic-night' }, read: true },
  { id: 'n9', at: '2026-11-19T10:00:00+05:30', from: 'CircuitFeed', kind: 'New event', type: 'follow', text: 'Build Anything Hackathon, Sat 21 Nov in Gachibowli.', picture: { event: 'build-anything-hackathon' }, opens: { to: 'event', event: 'build-anything-hackathon' } },
  { id: 'n8', at: '2026-11-19T09:00:00+05:30', from: 'Pixel Club, CBIT', kind: 'Thanks for coming', type: 'thanks', text: 'Thanks for coming to Design Critique Night. See who was there.', picture: { event: 'design-critique-18-nov' }, opens: { to: 'room', event: 'design-critique-18-nov' }, read: true },
  { id: 'n7', at: '2026-11-18T18:00:00+05:30', from: 'Jam Circle Hyderabad', kind: 'Near you', type: 'near', text: 'Sunday Jam at KBR Park, Sun 5:00 PM. Free.', picture: { event: 'sunday-jam' }, opens: { to: 'event', event: 'sunday-jam' }, read: true },
  { id: 'n6', at: '2026-11-17T12:15:00+05:30', from: 'Clay Days', kind: 'You’re going', type: 'ticket', text: 'Pottery for Beginners, Thu 26 Nov at 4:00 PM. Your ticket is ready.', picture: { event: 'pottery-for-beginners' }, opens: { to: 'ticket', event: 'pottery-for-beginners' }, read: true },
  { id: 'n5', at: '2026-11-16T11:00:00+05:30', from: 'Respawn Club', kind: 'Refund sent', type: 'refund', text: '₹99 is on its way back for Campus Esports Cup. It reaches you in 5 to 7 working days.', picture: { event: 'campus-esports-cup' }, opens: { to: 'refund', event: 'campus-esports-cup' }, read: true },
  { id: 'n4', at: '2026-11-16T09:20:00+05:30', from: 'Orbit', kind: 'Sign-in', type: 'account', text: 'A passkey was added on iPhone. Not you? Check Sign-in and security.', picture: null, opens: { to: 'security' }, read: true },
  { id: 'n3', at: '2026-11-15T08:05:00+05:30', from: 'Hyderabad Founders Club', kind: 'You’re going', type: 'ticket', text: 'Founders Breakfast, Tue 24 Nov at 8:30 AM. Your ticket is ready.', picture: { event: 'founders-breakfast' }, opens: { to: 'ticket', event: 'founders-breakfast' }, read: true },
  // Its event is gone, so it opens the event page's "isn't on Orbit" note.
  { id: 'n2', at: '2026-11-14T18:30:00+05:30', from: 'Reel Society', kind: 'New event', type: 'follow', text: 'Late Show: Chungking Express, Sat 21 Nov in Kukatpally.', picture: { host: 'reel-society' }, opens: { to: 'event', event: 'late-show-21-nov' }, read: true },
  { id: 'n1', at: '2026-11-14T09:00:00+05:30', from: 'Punchline Collective', kind: 'Thanks for coming', type: 'thanks', text: 'Thanks for coming to Open Mic Night. Loved it?', picture: { event: 'open-mic-night-13-nov' }, opens: { to: 'event', event: 'open-mic-night-13-nov' }, read: true },
];

export type Message = InboxItem & { unread: boolean; href: string | null };

// Every message still kept (180 days), with whether it's unread and where it opens. An older one never keeps the bell's
// dot on.
export function useInbox(): Message[] {
  const read = useRead();
  return useMemo(
    () =>
      items
        .filter((x) => isKept(x.at, now))
        .map((x) => ({ ...x, unread: !x.read && !read.includes(x.id), href: hrefFor(x.opens, (e) => ticketFor(e)?.id) })),
    [read],
  );
}
export const useUnread = () => useInbox().some((x) => x.unread);
export const useUnreadCount = () => useInbox().filter((x) => x.unread).length; // the app icon's number

// The host's newest announcement for an event, shown on top of its ticket (Notifications doc: a host announcement opens
// "the ticket, with the announcement on top").
// ponytail: kept until the ticket goes; the API's announcements carry their own end.
export const announcementFor = (eventId: string) =>
  items
    .filter((x) => x.kind === 'Announcement' && x.opens?.to === 'ticket' && x.opens.event === eventId)
    .reduce<InboxItem | undefined>((newest, x) => (!newest || Date.parse(x.at) > Date.parse(newest.at) ? x : newest), undefined);
