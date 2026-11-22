// When an event's door is open, and the word over it on Events (take 1, approved 22 Nov 2026; direction C from the app's
// Console, 16 Nov). Ported from the Orbit app's Console, removed from the app on 19 Nov (git 58351ce^1:
// app/src/console/day.ts and app/src/modes.ts).
const IST = 19_800_000; // +05:30, all year
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// A moment's day in India time, as a count of days: two moments on the same India day share it.
export const istDay = (t: number) => Math.floor((t + IST) / DAY);
const night = (t: number) => {
  const hour = new Date(t + IST).getUTCHours();
  return hour >= 17 || hour < 5;
};

// Check-in is open from 24 hours before the start until 3 hours after the end (Event day doc).
export const checkInOpen = (startsAt: string, endsAt: string, now: number) =>
  now >= Date.parse(startsAt) - 24 * HOUR && now <= Date.parse(endsAt) + 3 * HOUR;

// Whether an event starts on today's India day: its card then shows the time alone, else its date too.
export const startsToday = (startsAt: string, now: number) => istDay(Date.parse(startsAt)) === istDay(now);

// "Today", "Tonight" or "Tomorrow" in India time. An open event starts today or tomorrow, or began on an earlier day
// and is still running; that one takes its word from now. Night is 5 PM to 5 AM, so a show still going at 12:30 AM is
// still tonight's.
export type DayWord = 'Today' | 'Tonight' | 'Tomorrow';

export function dayWord(startsAt: string, now: number): DayWord {
  const start = Date.parse(startsAt);
  if (istDay(start) > istDay(now)) return 'Tomorrow';
  return night(istDay(start) < istDay(now) ? now : start) ? 'Tonight' : 'Today';
}

// Events' sections: those whose check-in is open under their day word, the word whose first event starts soonest first
// (so a show still running sits above one not yet begun); then what's coming, soonest first; then what's past, newest
// first.
export function split<E extends { startsAt: string }>(events: readonly E[], endsAt: (e: E) => string, now: number) {
  const sorted = [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const open = sorted.filter((e) => checkInOpen(e.startsAt, endsAt(e), now));
  const next = sorted.filter((e) => !open.includes(e) && Date.parse(endsAt(e)) >= now);
  const past = sorted.filter((e) => !open.includes(e) && !next.includes(e)).reverse();
  const groups: { word: DayWord; events: E[] }[] = [];
  for (const e of open) {
    const word = dayWord(e.startsAt, now);
    const group = groups.find((g) => g.word === word);
    if (group) group.events.push(e);
    else groups.push({ word, events: [e] });
  }
  return { groups, next, past };
}
