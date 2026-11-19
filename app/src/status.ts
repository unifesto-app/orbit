// An event's one status: the line with a dot at the top of its page, and the tag on its row when it's news (owner,
// 19 Nov 2026: "need various status", from "Just announced, Booking open soon, Booking open now, fast filling, almost
// filled, sold out", rephrased and added to). Plain words that say what happens next (brand kit, Voice). The first
// that holds wins:
//   Cancelled · Ended · On now · Booking opens <when> · Booking closed · Waitlist open · Sold out · Almost full ·
//   Filling fast · Just announced · Booking open
// A free event says Registration where a paid one says Booking. Pure, so status.test.ts runs it on Node.
export type StatusEvent = {
  startsAt: string;
  announced: string;
  pricePaise: number; // 0 = free
  capacity?: number; // seats in all; none means no cap worth showing
  left?: number; // seats still to book
  salesOpen?: string; // when booking opens, if later than the announcement
  salesClose?: string; // when booking closes, if before the start
  waitlist?: boolean; // the host takes a waitlist once it's sold out (Booking doc)
  cancelled?: boolean;
  tiers?: readonly { soldOut?: boolean }[]; // ticket types: every one sold out is sold out too
};

export type StatusKind =
  | 'cancelled'
  | 'ended'
  | 'onNow'
  | 'opensSoon'
  | 'waitlist'
  | 'soldOut'
  | 'closed'
  | 'almostFull'
  | 'fillingFast'
  | 'justAnnounced'
  | 'open';

// open: a Sage dot, booking is on. soon: a Sage ring, not yet. closed: a grey dot, nothing to book.
// `short` is the label on a row's tag, where the page's line is too long ("Opens Sat 21 Nov").
export type Status = { kind: StatusKind; label: string; short: string; tone: 'open' | 'soon' | 'closed' };

// ponytail: events carry no end time yet, so one is "on" for LASTS after it starts; the end time replaces it.
const LASTS = 3 * 3_600_000;
// Almost full with a tenth of the room left, or 10 or fewer once three quarters are booked (so 10 of 20 isn't); filling
// fast once 60% are booked.
const FEW = 10;
const FAST = 0.6;
// Just announced for three days: on a row, a new date from a host you follow is the news, ahead of its repeat tag.
const JUST = 3 * 86_400_000;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A time in India (UTC+5:30, no summer time) as the app writes them: "Sat 21 Nov · 6:00 PM". */
export function indiaWhen(at: string): string {
  const d = new Date(Date.parse(at) + 330 * 60_000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${indiaDay(at)} · ${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}
/** The day alone: "Sat 21 Nov". */
export function indiaDay(at: string): string {
  const d = new Date(Date.parse(at) + 330 * 60_000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function eventStatus(e: StatusEvent, now: number): Status {
  const start = Date.parse(e.startsAt);
  const book = e.pricePaise ? 'Booking' : 'Registration';
  const s = (kind: StatusKind, label: string, tone: Status['tone'], short = label): Status => ({ kind, label, short, tone });
  if (e.cancelled) return s('cancelled', 'Cancelled', 'closed');
  if (now >= start + LASTS) return s('ended', 'Ended', 'closed');
  if (now >= start) return s('onNow', 'On now', 'open');
  if (e.salesOpen && now < Date.parse(e.salesOpen)) return s('opensSoon', `${book} opens ${indiaWhen(e.salesOpen)}`, 'soon', `Opens ${indiaDay(e.salesOpen)}`);
  // Closed beats a waitlist: once sales close there's nothing to join.
  if (e.salesClose && now >= Date.parse(e.salesClose)) return s('closed', `${book} closed`, 'closed');
  // Oversold (left below 0) is sold out too.
  const soldOut = (e.left !== undefined && e.left <= 0) || (!!e.tiers?.length && e.tiers.every((t) => t.soldOut));
  if (soldOut) return e.waitlist ? s('waitlist', 'Waitlist open', 'open') : s('soldOut', 'Sold out', 'closed');
  if (e.left !== undefined && e.capacity) {
    const booked = (e.capacity - e.left) / e.capacity;
    if (e.left <= e.capacity / 10 || (e.left <= FEW && booked >= 0.75)) return s('almostFull', 'Almost full', 'open');
    if (booked >= FAST) return s('fillingFast', 'Filling fast', 'open');
  }
  if (now - Date.parse(e.announced) < JUST) return s('justAnnounced', 'Just announced', 'open');
  return s('open', `${book} open`, 'open');
}

/** Whether a status is news worth a tag on a row: not the everyday Booking open, and not Ended. */
export const isNews = (st: Status) => st.kind !== 'open' && st.kind !== 'ended';

/**
 * A row's tag: the one it's given wins (a role, a refund); then the status when it's news; then the repeat ("Every
 * Friday"). A row that isn't for booking (your own ticket, a past event) shows only Cancelled, never seats or sales.
 */
export function rowTag(st: Status, repeats: string | undefined, forBooking: boolean, given?: string): string | undefined {
  if (given) return given;
  if (isNews(st) && (forBooking || st.kind === 'cancelled')) return st.short;
  return repeats;
}

/** Whether you can book now, and what the booking button says: Book ticket or Register, Join waitlist, or why not. */
export function bookAction(st: Status, free: boolean): { label: string; can: boolean } {
  switch (st.kind) {
    case 'opensSoon':
      return { label: 'Not open yet', can: false };
    case 'soldOut':
      return { label: 'Sold out', can: false };
    case 'closed':
    case 'cancelled':
    case 'ended':
      return { label: 'Closed', can: false };
    case 'waitlist':
      return { label: 'Join waitlist', can: true };
    default:
      return { label: free ? 'Register' : 'Book ticket', can: true };
  }
}

/** The seats line under a price: only while booking is open and few are left (decision 3's line, kept to 10 or fewer). */
export function seatsLine(e: StatusEvent, st: Status): string | undefined {
  if (!(['open', 'justAnnounced', 'fillingFast', 'almostFull'] as StatusKind[]).includes(st.kind)) return undefined;
  if (e.left === undefined || e.left <= 0 || e.left > FEW) return undefined;
  return `${e.left} ${e.left === 1 ? 'seat' : 'seats'} left`;
}
