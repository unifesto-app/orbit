// Galaxy's Analytics (owner, 19 Nov 2026: "user analytics, mau, dau etc", "app analytics and more"): who uses Orbit,
// how often, on what, and whether they come back. Active people come from the API's activity log: one row per person
// per IST day per platform, kept 90 days (owner, 19 Nov 2026: "90 days"), deleted with the account; each day's totals,
// with no people in them, are kept after the rows go.

// Every request from the app says what it is in this header: "ios/1.0.0", "android/1.0.0"; the website "web"; Galaxy
// "galaxy" (staff at work, never counted as people using Orbit); the host apps their name before it, "launch-ios/1.0.0",
// "station-android/1.0.0" or "crew-ios/1.0.0" (hosts at work, kept out of the people's counts, host apps plan decision
// 19). A request without it, or with anything else, counts as "app" (an older build, or an unknown one). Nothing in it
// is trusted: it only sorts the counts.
// ponytail: host apps aren't counted at all yet; they get counts of their own when Galaxy shows host activity.
export const CLIENT_HEADER = "x-orbit-client";
export const PLATFORMS = { ios: "iOS", android: "Android", web: "Web", app: "App (older build)" } as const;
export type Platform = keyof typeof PLATFORMS;
export const HOST_APPS = ["launch", "station", "crew"] as const;
export type HostApp = (typeof HOST_APPS)[number];
export type Client =
  | { platform: Platform; version: string | null }
  | { platform: "galaxy" }
  | { platform: "host"; app: HostApp; os: "ios" | "android"; version: string };

const APP = /^(ios|android)\/(\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const HOST = /^(launch|station|crew)-(ios|android)\/(\d{1,3}\.\d{1,3}\.\d{1,3})$/;
/** What a request's CLIENT_HEADER says it is; anything unreadable is an unknown app. */
export function readClient(header: string | undefined | null): Client {
  const v = (header ?? "").trim().toLowerCase();
  if (v === "galaxy") return { platform: "galaxy" };
  if (v === "web") return { platform: "web", version: null };
  const h = HOST.exec(v);
  if (h) return { platform: "host", app: h[1] as HostApp, os: h[2] as "ios" | "android", version: h[3]! };
  const m = APP.exec(v);
  return m ? { platform: m[1] as "ios" | "android", version: m[2]! } : { platform: "app", version: null };
}

type Tally = { name: string; count: number }[];

// GET /galaxy/analytics, for holders of People. Days are India's; "today" so far since midnight IST; a week the last 7
// IST days, today included; a month the last 30.
export type AnalyticsStats = {
  since: string | null; // the log's first day, "2026-11-20"; null before anyone was counted
  active: { day: number; week: number; month: number }; // DAU (today so far), WAU, MAU: distinct people
  // The last 30 days, oldest first: people active that day, of them how many signed up that same day, and the rest.
  days: { day: string; active: number; new: number; returning: number }[];
  platforms: Tally; // distinct people active in the last 30 days, per platform (PLATFORMS' names); one may count twice
  versions: Tally; // "iOS 1.0.0": distinct people active in the last 7 days on each app version
  // Weekly sign-up cohorts, the last 8 full weeks (Monday to Sunday, IST), newest last: how many signed up, and the share
  // active in each of the 4 weeks after their sign-up week; null while that week hasn't ended yet.
  retention: { week: string; size: number; weeks: (number | null)[] }[];
  signIns: Tally; // sign-ins in the last 30 days by the way used (phone code, email code, Google, Apple, passkey)
  ways: Tally; // accounts with each way to sign in set up (an account can have several)
  ages: Tally; // accounts by age band, in age order: under 18, 18–24, 25–34, 35–44, 45+, not given
  genders: Tally;
  cities: Tally; // the 10 cities with the most accounts, then "Others"
  follows: { people: number; following: number; average: number }; // accounts, those following a host, follows per account
  deletions: { pending: number; month: number }; // waiting out their 30 days; carried out in the last 30 days
};
