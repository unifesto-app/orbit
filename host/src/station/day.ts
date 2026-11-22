// Orbit Station's day at the counter (Play doc, "At the desk"; host apps plan, Station's Today), pure so day.test.ts
// runs it on Node. Times are epoch ms, labelled in India time (UTC+5:30, no summer time) as the people app writes them.
// - A venue books a station type by count, never a named machine: the desk picks the machine (Play).
// - Bookings, walk-ins and blocks are one list of claims; what's free at a step is the count less every claim on it.
// - Check-in opens 15 minutes before the start and closes at the booked end; a late arrival still ends at the booked end.
// - A booking nobody checked in for can be released 15 minutes after its start: no refund, and the booker is told.
// - A walk-in starts at the current step (30 minutes for gaming, the hour for pitches and courts); a booking beats it.
// ponytail: mock until the slots API (H8.1 to H8.5); the time labels repeat app/src/booking.ts until shared code moves
// to mobile/ (host apps plan, decision 14).

export const MIN = 60_000;
export const HOUR = 60 * MIN;
const IST = 330 * MIN;
const DAY = 24 * HOUR;
const EARLY = 15 * MIN; // check-in opens this long before the start
const NO_SHOW = 15 * MIN; // and a booking can be released this long after it, if nobody came

export type StationType = {
  id: string;
  name: string; // "Gaming PC", "5-a-side football"
  count: number;
  unit: [string, string]; // one and many: ["pitch", "pitches"]
  step: 30 | 60; // minutes between starts
  whole: boolean; // booked whole by one group: one QR, nobody counted at the door
};
export type Venue = {
  id: string;
  name: string;
  initials: string;
  bg: string;
  fg: string;
  area: string;
  open: [number, number]; // first and last hour, 24h India time; past 24 runs into the next morning (26 is 2 AM)
  types: StationType[];
};
export type Claim = {
  id: string;
  type: string;
  kind: 'booking' | 'walkin' | 'block';
  count: number;
  start: number;
  end: number;
  who?: string; // a booking's name
  code?: string; // its ticket code
  why?: string; // a block's reason
  checkedIn?: number;
  released?: boolean;
};

/** Where a booking stands at the counter. */
export type Door = 'soon' | 'open' | 'late' | 'noShow' | 'here' | 'ended' | 'missed' | 'released';

/** Midnight in India on the day that holds `at`. */
export const indiaMidnight = (at: number) => at - ((at + IST) % DAY);
/**
 * The day whose opening `now` is in: at 1 AM a café open till 2 AM is still on yesterday's. Before it opens it's the
 * coming one, and after it closes the one that just ended, until midnight.
 */
export function openingDay(v: Venue, now: number): number {
  const d = indiaMidnight(now);
  return v.open[1] > 24 && now < d + (v.open[1] - 24) * HOUR ? d - DAY : d;
}
/** When that opening starts and ends, and where `now` is against it. */
export function hours(v: Venue, now: number) {
  const day = openingDay(v, now);
  const opens = day + v.open[0] * HOUR;
  const closes = day + v.open[1] * HOUR;
  return { day, opens, closes, state: now < opens ? ('before' as const) : now < closes ? ('open' as const) : ('after' as const) };
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sun 22 Nov". */
export function dayLabel(at: number): string {
  const d = new Date(at + IST);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** An opening hour as the head says it: "11 AM", "2 AM" (26), "midnight", "noon". */
export function hourWord(h: number): string {
  const x = h % 24;
  return x === 0 ? 'midnight' : x === 12 ? 'noon' : `${x % 12} ${x < 12 ? 'AM' : 'PM'}`;
}
/** "6:30 PM". */
export function timeLabel(at: number): string {
  const d = new Date(at + IST);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Every start on the opening that begins on `day` (its India midnight), the night's past midnight included. */
export function steps(v: Venue, t: StationType, day: number): number[] {
  const out: number[] = [];
  for (let at = day + v.open[0] * HOUR; at < day + v.open[1] * HOUR; at += t.step * MIN) out.push(at);
  return out;
}

const covers = (c: Claim, at: number) => !c.released && c.start <= at && at < c.end;

/** How many of a type each kind of claim takes at `at`, and how many are left. */
export function taken(claims: readonly Claim[], t: StationType, at: number) {
  const n = { booking: 0, walkin: 0, block: 0 };
  for (const c of claims) if (c.type === t.id && covers(c, at)) n[c.kind] += c.count;
  return { ...n, free: Math.max(t.count - n.booking - n.walkin - n.block, 0) };
}

export function door(c: Claim, now: number): Door {
  if (c.released) return 'released';
  if (c.checkedIn !== undefined) return now < c.end ? 'here' : 'ended';
  if (now >= c.end) return 'missed';
  if (now < c.start - EARLY) return 'soon';
  if (now < c.start) return 'open';
  return now < c.start + NO_SHOW ? 'late' : 'noShow';
}

/** The step a walk-in starts at: the one `now` is in, floored in India time. */
export const walkInStart = (t: StationType, now: number) => {
  const s = t.step * MIN;
  return Math.floor((now + IST) / s) * s - IST;
};

/**
 * A walk-in of `count` for `hours` from the current step, or why not. Bookings already in beat it, so it's refused
 * with the line the counter shows: "Only 1 free until 7:00 PM" when too few are free now, "2 free only until 7:00 PM"
 * when they are but a booking takes them before the end (the desk can offer the shorter time). None while it's shut.
 */
const hoursOf = hours;
export function walkIn(
  claims: readonly Claim[],
  v: Venue,
  t: StationType,
  now: number,
  hours: number,
  count: number,
): { ok: true; claim: Claim } | { ok: false; line: string } {
  const { opens, closes: close, state } = hoursOf(v, now);
  if (state === 'before') return { ok: false, line: `Opens at ${timeLabel(opens)}` };
  if (state === 'after') return { ok: false, line: 'Closed for the day' };
  const start = walkInStart(t, now);
  const end = Math.min(start + hours * HOUR, close);
  const n = (at: number) => taken(claims, t, at).free;
  // The step it starts in is checked from now, so a station freed early this step is free for it.
  for (let at = start; at < end; at += t.step * MIN) {
    if (n(Math.max(at, now)) >= count) continue;
    if (at > start) return { ok: false, line: `${count} free only until ${timeLabel(at)}` };
    let back = at;
    while (back < close && n(back) < count) back += t.step * MIN;
    const few = n(now) === 0 ? 'None free' : `Only ${n(now)} free`;
    return { ok: false, line: back < close ? `${few} until ${timeLabel(back)}` : `${few} till closing` };
  }
  // From the step's start, unless something there ended only now (freed early): then from now, so the bar never
  // counts two groups on one station.
  const from = n(start) >= count ? start : now;
  return { ok: true, claim: { id: `w${from}-${t.id}-${claims.length}`, type: t.id, kind: 'walkin', count, start: from, end } };
}

/** Free one walk-in early (Play's −): the latest on `at` ends then; one of several splits off and ends. */
export function freeOne(claims: readonly Claim[], type: string, at: number): Claim[] {
  const w = claims.filter((c) => c.kind === 'walkin' && c.type === type && covers(c, at)).sort((a, b) => b.start - a.start)[0];
  if (!w) return [...claims];
  const rest = claims.filter((c) => c !== w);
  return w.count > 1 ? [...rest, { ...w, count: w.count - 1 }, { ...w, id: `${w.id}f${at}`, count: 1, end: at }] : [...rest, { ...w, end: at }];
}
