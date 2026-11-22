// How Launch's Inbox lays out its messages (Inbox take 1, approved 22 Nov 2026, the Orbit app's Rows take): a heading per
// India day, newest first, and each message's time. The Orbit app's own rules are app/src/inbox.ts; these follow them.
import { istDay } from './day.ts';
import { dayLabel, istDate } from './money.ts';

const IST = 19_800_000; // +05:30, all year
const DAY = 86_400_000;
const KEEP_DAYS = 180; // the inbox shows the last 180 days (Notifications flow), counted to the moment, as the app's

export type Picture = { event: string } | { host: { initials: string; bg: string; fg: string; name: string } } | null; // null: from Orbit

// One message: who it's from and what it is ("Open Mic Night · Refund request"), the words, when, and its picture.
// `at` carries its offset (or Z); one without would read in the phone's own zone.
export type Message = { id: string; at: string; from: string; kind: string; text: string; picture: Picture; read?: boolean };

// The messages the Inbox shows: from the last 180 days, with a time that reads. The list, the count on the Inbox circle
// and Mark all read all start from these, so a count never points at a row that isn't there.
export const kept = <M extends Message>(messages: readonly M[], now: number) =>
  messages.filter((m) => {
    const at = Date.parse(m.at);
    return !Number.isNaN(at) && at > now - KEEP_DAYS * DAY;
  });

// How many of the shown messages are unread.
export const unreadCount = (messages: readonly Message[], read: ReadonlySet<string>, now: number) => kept(messages, now).filter((m) => !read.has(m.id)).length;

// "6:12 PM" in India time.
export function timeLabel(at: string) {
  const t = new Date(Date.parse(at) + IST);
  const h = t.getUTCHours();
  const m = String(t.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// "Today", "Yesterday", or "Sat 14 Nov", for the India day of `at`. A time a little ahead of the phone's still reads Today.
export function dayHeading(at: string, now: number) {
  const ago = istDay(now) - istDay(Date.parse(at));
  return ago <= 0 ? 'Today' : ago === 1 ? 'Yesterday' : dayLabel(istDate(Date.parse(at)));
}

// The shown messages, newest first, under a heading per India day.
export function inboxDays<M extends Message>(messages: readonly M[], now: number) {
  const days: { day: string; items: M[] }[] = [];
  for (const m of kept(messages, now).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    const day = dayHeading(m.at, now);
    const last = days[days.length - 1];
    if (last?.day === day) last.items.push(m);
    else days.push({ day, items: [m] });
  }
  return days;
}

// The Inbox circle's count: nothing when there's nothing new, and never wider than two characters.
export const badge = (n: number) => (n <= 0 ? null : n > 9 ? '9+' : String(n));
