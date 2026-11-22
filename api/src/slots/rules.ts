import type { Week } from "@orbit/contract";

// The counter's rules (Play doc, "At the desk"), pure so rules.test.ts runs them with no database. Ported from Station's
// host/src/station/day.ts, with one opening `[first, last]` widened to a week. Keep the two in step: the refusal lines
// are the same words on purpose. Times are epoch ms, labelled in India time (UTC+5:30, no summer time).

export const MIN = 60_000;
export const HOUR = 60 * MIN;
const IST = 330 * MIN;
const DAY = 24 * HOUR;
export const EARLY = 15 * MIN; // check-in opens this long before the start
export const NO_SHOW = 15 * MIN; // and a booking can be released this long after it, if nobody came

export type Status = "held" | "paid" | "checked_in" | "ended" | "freed" | "refunded" | "released";
export type Kind = "booking" | "walkin" | "block";
export type Claim = {
  id: string;
  stationId: string;
  kind: Kind;
  status: Status;
  count: number;
  start: number;
  end: number;
  holdEnd: number | null; // a held booking counts until then
  admitted: number;
  checkedIn: number | null;
  checkedInBy: string | null;
  released: number | null;
};
export type Station = { id: string; step: 30 | 60; count: number };
export type Door = "soon" | "open" | "late" | "noShow" | "here" | "ended" | "missed" | "released";

/** Midnight in India on the day that holds `at`. */
export const indiaMidnight = (at: number) => at - ((at + IST) % DAY);

/** "6:30 PM". */
export function timeLabel(at: number): string {
  const d = new Date(at + IST);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** That India day's hours (`day` is an India midnight), or null when it's closed. Sunday is 0, as in the week. */
export const openOn = (week: Week, day: number) => week[new Date(day + IST).getUTCDay()] ?? null;

/**
 * The opening `now` is in, and where `now` is against it: at 1 AM a café open till 2 AM is still on yesterday's. A closed
 * day opens and closes at its midnight, so it reads as "after".
 */
export function hours(week: Week, now: number) {
  const today = indiaMidnight(now);
  const last = openOn(week, today - DAY);
  const day = last && last[1] > 24 && now < today - DAY + last[1] * HOUR ? today - DAY : today;
  const h = openOn(week, day);
  if (!h) return { day, opens: day, closes: day, state: "after" as const };
  const opens = day + h[0] * HOUR;
  const closes = day + h[1] * HOUR;
  return { day, opens, closes, state: now < opens ? ("before" as const) : now < closes ? ("open" as const) : ("after" as const) };
}

// The one place that says which claims take stations: money landed, someone's here, or a hold still running. A walk-in
// freed early or a block lifted early ended "then", so it counts up to then. Refunded and released never count.
export const counts = (c: Pick<Claim, "status" | "holdEnd">, now: number) =>
  c.status === "paid" || c.status === "checked_in" || c.status === "freed" || c.status === "ended" || (c.status === "held" && c.holdEnd !== null && c.holdEnd > now);

/** How many of a station each kind of claim takes at `at`, and how many are left. */
export function taken(claims: readonly Claim[], s: Pick<Station, "id" | "count">, at: number, now: number) {
  const n = { booking: 0, walkin: 0, block: 0 };
  for (const c of claims) if (c.stationId === s.id && counts(c, now) && c.start <= at && at < c.end) n[c.kind] += c.count;
  return { ...n, free: Math.max(s.count - n.booking - n.walkin - n.block, 0) };
}

/** The step a walk-in starts at: the one `now` is in, floored in India time. */
export const walkInStart = (step: number, now: number) => {
  const s = step * MIN;
  return Math.floor((now + IST) / s) * s - IST;
};

/**
 * A walk-in of `count` for `hours` from the current step, or why not. Bookings already in beat it, so it's refused with
 * the line the counter shows: "Only 1 free until 7:00 PM" when too few are free now, "2 free only until 7:00 PM" when they
 * are but a booking takes them before the end (the desk can offer the shorter time). None while it's shut.
 */
export function walkIn(
  claims: readonly Claim[],
  week: Week,
  s: Station,
  now: number,
  hrs: number,
  count: number,
  clock = now, // when holds are read against: a future block starts at `now` but a hold lapses by the real clock
): { ok: true; start: number; end: number } | { ok: false; line: string } {
  const { opens, closes: close, state } = hours(week, now);
  if (state === "before") return { ok: false, line: `Opens at ${timeLabel(opens)}` };
  if (state === "after") return { ok: false, line: "Closed for the day" };
  const start = walkInStart(s.step, now);
  const end = Math.min(start + hrs * HOUR, close);
  const n = (at: number) => taken(claims, s, at, clock).free;
  // The step it starts in is checked from now, so a station freed early this step is free for it.
  for (let at = start; at < end; at += s.step * MIN) {
    if (n(Math.max(at, now)) >= count) continue;
    if (at > start) return { ok: false, line: `${count} free only until ${timeLabel(at)}` };
    let back = at;
    while (back < close && n(back) < count) back += s.step * MIN;
    const few = n(now) === 0 ? "None free" : `Only ${n(now)} free`;
    return { ok: false, line: back < close ? `${few} until ${timeLabel(back)}` : `${few} till closing` };
  }
  // From the step's start, unless something there ended only now (freed early): then from now, so the bar never counts
  // two groups on one station.
  return { ok: true, start: n(start) >= count ? start : now, end };
}

/** Whether `count` fit on every step of [start, end): what a hold needs. */
export function fits(claims: readonly Claim[], s: Station, start: number, end: number, count: number, now: number) {
  for (let at = start; at < end; at += s.step * MIN) if (taken(claims, s, at, now).free < count) return false;
  return true;
}

const live = (c: Claim, now: number) => c.kind === "booking" && counts(c, now) && c.end > now;

/** The bookings that wouldn't fit if the station had only `count`: every one on a moment that needs more than that. Only
 * bookings stand in the way; the desk can free walk-ins and lift blocks. */
export function stranded(claims: readonly Claim[], stationId: string, count: number, now: number): Claim[] {
  const mine = claims.filter((c) => c.stationId === stationId && live(c, now));
  const out = new Set<Claim>();
  for (const at of new Set([now, ...mine.map((c) => Math.max(c.start, now))])) {
    const on = mine.filter((c) => c.start <= at && at < c.end);
    if (on.reduce((n, c) => n + c.count, 0) > count) on.forEach((c) => out.add(c));
  }
  return [...out].sort((a, b) => a.start - b.start);
}

/** The live bookings the new week leaves outside its hours: not inside the opening the new week puts their start in (a
 * closed day has none). Read against the new week alone, so a night slot that moves into the next day's hours still fits. */
export function outsideWeek(claims: readonly Claim[], newWeek: Week, now: number): Claim[] {
  return claims
    .filter((c) => {
      if (!live(c, now)) return false;
      const h = hours(newWeek, c.start);
      return !(c.start >= h.opens && c.end <= h.closes);
    })
    .sort((a, b) => a.start - b.start);
}

export function door(c: Claim, now: number): Door {
  if (c.released !== null) return "released";
  if (c.checkedIn !== null) return now < c.end ? "here" : "ended";
  if (now >= c.end) return "missed";
  if (now < c.start - EARLY) return "soon";
  if (now < c.start) return "open";
  return now < c.start + NO_SHOW ? "late" : "noShow";
}

/**
 * Have `total` of a booking in, never fewer than are in already nor more than it holds: so a tap that lands twice still
 * lets in only who was counted. The first time and who did it stay as they were.
 */
export const admitTo = (c: Claim, total: number, now: number, by: string): Claim => ({
  ...c,
  admitted: Math.min(Math.max(c.admitted, total), c.count),
  checkedIn: c.checkedIn ?? now,
  checkedInBy: c.checkedInBy ?? by,
  status: "checked_in",
});

/** Why a scan is refused, in the scanner's order: refunded, released, ended, early. Null when it's let in. */
export function scanRefusal(c: Claim, now: number): { error: string; message: string } | null {
  if (c.status === "refunded") return { error: "refunded", message: "Refunded: not valid." };
  if (c.status === "released") return { error: "released", message: "Released as a no-show." };
  if (now >= c.end) return { error: "ended", message: "This booking has ended." };
  if (now < c.start - EARLY) return { error: "early", message: "Too early: check-in opens 15 minutes before the start." };
  return null;
}
