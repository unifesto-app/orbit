// The rules behind the booking screens (owner, 19 Nov 2026: "Booking screens"), pure so booking.test.ts runs them on
// Node. Event tickets (Booking doc) and slots at places to play (Play doc):
// - Quantity is 1 on an 18+ or 21+ event (Booking 14); otherwise up to 10. A fest's Add people goes up to 10 in all,
//   names only, and is off on 18+ and 21+ (Booking 13, 14).
// - You can book today and the next 13 days. A pitch or court is booked whole, starting on the hour; a gaming station
//   starts every 30 minutes, solo or co-op, as many as are free (Play 7, 19). A day lists every start on that calendar
//   day, so a café open till 2 AM shows its after-midnight starts under the next day (and Today, after midnight). Each
//   half hour is priced at its own rate, the off-peak window's where it falls (Play 8).
// - A slot is held for 10 minutes while you pay (Play 17); when the hold runs out you can ask to hear if it frees up,
//   once (Play 18).
// Times are India time (UTC+5:30, no summer time), as the rest of the app writes them. Kept free of other app modules
// so Node can run it on its own.
import type { TierCard } from '@orbit/contract';

import type { Station, Venue } from './kinds';

const IST = 330 * 60_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How long a slot is held while you pay. */
export const HOLD_MS = 10 * MIN;
/** The longest booking one person makes, in hours (a picker's limit, not a rule from the docs). */
export const MAX_HOURS = 4;

const india = (at: number) => new Date(at + IST);
/** Midnight in India on the day that holds `at`. */
export const indiaMidnight = (at: number) => at - ((at + IST) % DAY);
/** "Sat 21 Nov". */
export const dayLabel = (at: number) => {
  const d = india(at);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
/** "6:30 PM". */
export const timeLabel = (at: number) => {
  const d = india(at);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The days you can book: today and the next 13. */
export function bookingDays(now: number): { start: number; label: string }[] {
  const today = indiaMidnight(now);
  return Array.from({ length: 14 }, (_, i) => {
    const start = today + i * DAY;
    return { start, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayLabel(start) };
  });
}

/** Whether a booking at this venue starts every 30 minutes (gaming) or on the hour (pitches, courts). */
export const stepOf = (v: Venue) => (v.kind === 'gaming' ? 30 * MIN : HOUR);

/**
 * The start times on a calendar day (`day` is its India midnight): every step of the night before's opening that runs
 * past midnight, then the day's own, each with `hours` left before that opening closes, none in the past, and none on
 * the next day (those are the next day's).
 */
export function startTimes(v: Venue, day: number, now: number, hours = 1): number[] {
  const step = stepOf(v);
  const out: number[] = [];
  for (const opening of [day - DAY, day]) {
    for (let at = opening + v.open[0] * HOUR; at + hours * HOUR <= opening + v.open[1] * HOUR; at += step) {
      if (at >= day && at < day + DAY && at >= now) out.push(at);
    }
  }
  return out;
}

/**
 * How many of a station are free for every hour from `start` for `hours`.
 * ponytail: a steady made-up pattern (some hours fuller than others) until the API knows the real bookings.
 */
export function freeAt(s: Station, start: number, hours: number): number {
  let free = s.count;
  for (let h = 0; h < hours; h++) {
    const hour = Math.floor((start + h * HOUR + IST) / HOUR);
    let x = hour * 31 + s.name.length * 7;
    x = (x ^ (x >>> 3)) % (s.count + 2); // 0 .. count + 1
    free = Math.min(free, Math.max(s.count - x, 0));
  }
  return free;
}

// What a booking costs (each half hour at its own rate, co-op shared): in the contract, so the API charges the same.
export { slotPrice } from '@orbit/contract';

/**
 * The ticket's line (Play): "3 × PC, Sat 21 Nov, 6:30 to 8:30 PM"; a whole pitch or court has no count. The start
 * keeps its AM or PM when the end's differs: "11:00 AM to 1:00 PM".
 */
export function slotLine(v: Pick<Venue, 'kind'>, s: Pick<Station, 'name'> & { unit: readonly string[] }, start: number, hours: number, count = 1): string {
  const what = v.kind === 'gaming' ? `${count} × ${s.unit[0]}` : s.name;
  const from = timeLabel(start);
  const to = timeLabel(start + hours * HOUR);
  return `${what}, ${dayLabel(start)}, ${from.slice(-2) === to.slice(-2) ? from.slice(0, -3) : from} to ${to}`;
}

/** How many tickets one booking can hold. */
export const maxTickets = (age?: '18+' | '21+') => (age ? 1 : 10);
/** How many names a fest's Add people takes besides yours: none on 18+ and 21+, else up to 10 in all. */
export const maxGuests = (age?: '18+' | '21+') => (age ? 0 : 9);

/**
 * The most of ticket type `i` this booking can take, given what's picked (`qty`, per type): within the booking's limit
 * (maxTickets) and the seats left (`left`, when the event counts them), a team ticket taking its team's `seats`.
 */
export function ticketMax(
  tiers: readonly { seats?: number; soldOut?: boolean }[],
  qty: readonly number[],
  i: number,
  limits: { age?: '18+' | '21+'; left?: number },
): number {
  const tier = tiers[i];
  if (!tier || tier.soldOut) return 0;
  const size = (j: number) => tiers[j]?.seats ?? 1;
  const count = qty.reduce((n, q) => n + q, 0);
  const seats = qty.reduce((n, q, j) => n + q * size(j), 0);
  const byCount = maxTickets(limits.age) - count;
  const bySeats = limits.left === undefined ? Infinity : Math.floor((limits.left - seats) / size(i));
  return (qty[i] ?? 0) + Math.max(Math.min(byCount, bySeats), 0);
}

/**
 * A hackathon's team tickets (one booking is one team): whether ticket `i` fits at all, not sold out and its team's
 * seats within the seats left, and which to start on: the biggest team that fits (the first of equals), -1 if none does.
 */
export const teamFits = (tiers: readonly { seats?: number; soldOut?: boolean }[], i: number, limits: { age?: '18+' | '21+'; left?: number }) =>
  ticketMax(tiers, tiers.map(() => 0), i, limits) > 0;
export function firstTeam(tiers: readonly { seats?: number; soldOut?: boolean }[], limits: { age?: '18+' | '21+'; left?: number }): number {
  let best = -1;
  tiers.forEach((t, i) => {
    if (teamFits(tiers, i, limits) && (best < 0 || (t.seats ?? 1) > (tiers[best]!.seats ?? 1))) best = i;
  });
  return best;
}

/** Whether every required question has an answer: a choice, Yes or No, or text that isn't blank (kinds.ts `questions`). */
export const answered = (asks: readonly { id: string; required: boolean }[], answers: Readonly<Record<string, string>>) =>
  asks.every((q) => !q.required || !!answers[q.id]?.trim());

/** A hackathon team's name: 1 to 40 letters once trimmed (Running hackathons; that no other team has it, the API checks). */
export const TEAM_NAME = 40;
export const teamNameOk = (name: string) => {
  const n = name.trim();
  return n.length > 0 && n.length <= TEAM_NAME;
};

/** What's left of a hold, in ms (0 once it's run out). */
export const holdLeft = (heldAt: number, now: number) => Math.max(HOLD_MS - (now - heldAt), 0);
/** "9:05". */
export const mmss = (ms: number) => `${Math.floor(ms / MIN)}:${String(Math.floor((ms % MIN) / 1000)).padStart(2, '0')}`;

/**
 * A real event's ticket types as the booking sheet lists them (one type per booking, Booking doc). `off` says why one
 * can't be picked now, shown instead of a stepper, the first that holds: Coming soon (paid: paying in the app is the
 * next slice), Opens <day> (sales not started), Closed (sales over), Sold out. `max` is the most one booking takes:
 * the type's per-person limit, and the seats left when it counts them.
 */
export function liveTiers(tiers: readonly TierCard[], now: number) {
  return tiers.map((t) => ({
    id: t.id,
    name: t.name,
    pricePaise: t.pricePaise,
    max: Math.max(Math.min(t.perPersonLimit, t.left ?? 10), 0),
    off:
      t.pricePaise > 0
        ? 'Coming soon'
        : t.salesStartAt && Date.parse(t.salesStartAt) > now
          ? `Opens ${dayLabel(Date.parse(t.salesStartAt))}`
          : t.salesEndAt && Date.parse(t.salesEndAt) <= now
            ? 'Closed'
            : t.left !== null && t.left <= 0
              ? 'Sold out'
              : undefined,
  }));
}
