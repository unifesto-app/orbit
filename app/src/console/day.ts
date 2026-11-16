// The heading over an event whose check-in is open, on Console's first tab (direction C, owner 16 Nov 2026): "Today",
// "Tonight" or "Tomorrow", in India time, in that order. Check-in opens 24 hours before the start (src/modes.ts
// onEventDay), so an open event starts today or tomorrow, or began on an earlier day and is still running; that one
// takes its word from the time now. Night is 5 PM to 5 AM, so a show still going at 12:30 AM is still tonight's.
const IST = 19_800_000; // +05:30, all year
const DAY = 86_400_000;
const istDay = (t: number) => Math.floor((t + IST) / DAY);
const night = (t: number) => {
  const hour = new Date(t + IST).getUTCHours();
  return hour >= 17 || hour < 5;
};

export const WORDS = ['Today', 'Tonight', 'Tomorrow'] as const;
export type DayWord = (typeof WORDS)[number];

export function dayWord(startsAt: string, now: number): DayWord {
  const start = Date.parse(startsAt);
  if (istDay(start) > istDay(now)) return 'Tomorrow';
  return night(istDay(start) < istDay(now) ? now : start) ? 'Tonight' : 'Today';
}
