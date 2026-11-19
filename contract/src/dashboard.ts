// Galaxy's Dashboard (owner, 19 Nov 2026: "remove all in dashboard page", "add Analytics, Traction and all"): Orbit's
// traction at a glance. GET /galaxy/dashboard, for any staff; each block only for holders of the feature that owns it
// (Galaxy flow: the Dashboard filters by feature), so a block missing from the answer isn't theirs to see. Days are
// India's (IST, a fixed UTC+5:30). "Today" is since midnight IST; "week" is the last 7 days, today included; "prevWeek"
// the 7 before that, for the change.

export type DayCount = { day: string; count: number }; // "2026-11-19"

export type DashboardStats = {
  // People: accounts (deleted ones never count), sign-ups a day for the last 30 days, and who used the app or site:
  // distinct people in the activity log (as Analytics counts them): active today, in the last 7 IST days and the last 30.
  people?: { total: number; today: number; week: number; prevWeek: number; days: DayCount[]; active: { day: number; week: number; month: number } };
  // People: the waitlist (prelaunch interest).
  waitlist?: { total: number; today: number; week: number; prevWeek: number; days: DayCount[] };
  // People: heyorbit.in's own visit log, the last 7 days (a visitor is a visitor-day, as on the Website page).
  website?: { visitors: number; views: number; joined: number };
  // Hosts and events: hosts that aren't archived, verified ones, new this week; follows of them.
  hosts?: { total: number; verified: number; week: number; follows: number };
  // Hosts and events: published events still to come, published this week, drafts, cancelled ever.
  events?: { upcoming: number; week: number; drafts: number; cancelled: number };
  // Staff: people holding at least one started, unended staff feature (the platform owner included).
  staff?: { active: number };
};
