import { z } from "zod";
import { Dob, Proof } from "./user.ts";

// Prelaunch interest (owner, 17 Nov 2026: "add express interest and collect info", "metadata is much needed and
// display no of people shows interest", "create a page in galaxy web - prelaunch"). The landing page takes a name, a
// WhatsApp number proved by a code, a date of birth and the features wanted; the web server adds what the visit says.
// Nothing in `meta` is proof of anything: the API's own record of the visitor's address is `ip`, read from the request.

// No NUL anywhere: Postgres refuses it in text and jsonb.
const text = (max: number) => z.string().trim().max(max).refine((v) => !v.includes("\0"));
const short = text(200);

export const InterestMeta = z
  .object({
    // From Cloudflare's headers on the web request: country always, the rest only with its visitor location headers on.
    country: text(8),
    region: short,
    city: short,
    // From the browser's request.
    userAgent: text(500),
    acceptLanguage: short,
    // From the page itself: where the visitor came from, how the link was tagged, and their device.
    referrer: text(1000),
    utm: z.record(text(40), short).refine((o) => Object.keys(o).length <= 10),
    timezone: text(64),
    language: text(35),
    screen: text(20), // "390x844@3"
  })
  .partial();
export type InterestMeta = z.infer<typeof InterestMeta>;

// What Orbit will have, for the waitlist to pick from (owner, 18 Nov 2026: "list down our features and let them choose
// which they really love to use"), from the plan's launch feature list; only Orbit's own, not what every events app has
// (owner: "remove common and generic one's"). Keys are kept; labels can change.
export const FEATURES = {
  fests: "Fests in one click",
  slots: "Turf, courts and gaming by the hour",
  hackathons: "Hackathons with teams and results",
  inroom: "inRoom at meetups",
  performers: "Comedians and bands you love",
  host: "Hosting my own events",
} as const;
export type Feature = keyof typeof FEATURES;
const featureKeys = Object.keys(FEATURES) as [Feature, ...Feature[]];

// One address: dot-separated parts that can't hold a dot, so the pattern can't backtrack, and it runs only within 254
// characters (zod would otherwise test the pattern on a string already too long).
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

// Where the waitlist's people write to leave it or ask about their data: the legal pages and the welcome email
// (owner, 18 Nov 2026: "Use hello@heyorbit.in").
export const WAITLIST_CONTACT = "hello@heyorbit.in";

// The waitlist takes what sign-up takes (owner, 18 Nov 2026: "Name, Mobile, WhatsApp Otp, DoB ( same as account
// creation )"): a WhatsApp code proves the number. It is a list, not an account: no terms, no session.
// POST /public/interest/code: sends the code. `phone` is read as sign-in reads it (readPhone).
// `view`: the page view the form sits on (contract visit.ts), so the visit log can count "got a code" and "joined". It
// never fails a send or a join, and the waitlist row never keeps it.
const view = z.string().uuid().optional().catch(undefined);
export const InterestCode = z.object({ phone: z.string().min(1).max(20), proof: Proof.optional().catch(undefined), view });

// POST /public/interest: 204 for a new number and one already on the list alike.
export const Interest = z.object({
  name: text(100).pipe(z.string().min(1)),
  phone: z.string().min(1).max(20),
  // Where the welcome email goes (owner, 18 Nov 2026: "send them email, after joining the waitlist"). Not proved by a
  // code: each join needs a WhatsApp code, which caps how often a stranger's address can be given.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v.length <= 254 && !v.includes("\0") && EMAIL.test(v)),
  dob: Dob,
  code: z.string().regex(/^\d{6}$/),
  features: z.array(z.enum(featureKeys)).max(featureKeys.length).default([]).transform((a) => [...new Set(a)]),
  meta: InterestMeta.default({}),
  view,
});
export type Interest = z.infer<typeof Interest>;

// GET /public/interest.
export type InterestCount = { count: number };

// GET /galaxy/prelaunch?page=: everyone who has asked, newest first (People only).
// Rows from before 18 Nov 2026 have an email and nothing else typed; later ones a name, phone and date of birth.
export type InterestRow = InterestMeta & {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  dob: string | null;
  features: Feature[];
  ip: string | null;
  createdAt: string;
};
export type InterestList = { people: InterestRow[]; total: number; page: number; pageSize: number };

// What a visit's user agent says, at a glance (owner, 18 Nov 2026: "need all available useful analytics"): the app or
// browser, and the system. Galaxy's table and the API's analytics read it the same way.
// ponytail: a few common names, not a parser; the whole user agent is kept for anything finer.
export function deviceOf(ua?: string | null): { app: string | null; os: string | null } {
  if (!ua) return { app: null, os: null };
  const app = /Instagram/.test(ua)
    ? "Instagram"
    : /FBAN|FBAV/.test(ua)
      ? "Facebook"
      : /LinkedInApp/.test(ua)
        ? "LinkedIn"
        : /Twitter for|TwitterAndroid/.test(ua)
          ? "X"
          : /Edg\/|EdgiOS|EdgA\//.test(ua)
            ? "Edge"
            : /CriOS|Chrome\//.test(ua)
              ? "Chrome"
              : /FxiOS|Firefox\//.test(ua)
                ? "Firefox"
                : /Safari\//.test(ua)
                  ? "Safari"
                  : null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  return { app, os };
}

// Where a visit came from, as one name: the link's utm_source, else the referring site (heyorbit.in itself is none),
// else the app whose browser opened the page (in-app browsers often send no referrer), else Direct.
// Joins through the share button after joining (web waitlist.tsx tags its link utm_source=waitlist).
export const SHARED = "Shared by a member";
// A tag, a referring host, or an Android app's package (android-app://com.whatsapp/), each to one name.
const SOURCES: [RegExp, string][] = [
  [/^(ig|insta|instagram)$|(^|\.)instagram\.com$|^com\.instagram\.android$/, "Instagram"],
  [/^(li|linkedin)$|(^|\.)linkedin\.com$|^lnkd\.in$|^com\.linkedin\.android$/, "LinkedIn"],
  [/^(x|tw|twitter)$|^t\.co$|(^|\.)(x|twitter)\.com$|^com\.twitter\.android$/, "X"],
  [/^(wa|whatsapp)$|(^|\.)whatsapp\.(com|net)$|^wa\.me$|^l\.wl\.co$|^com\.whatsapp(\.w4b)?$/, "WhatsApp"],
  [/^(fb|facebook)$|(^|\.)facebook\.com$|^fb\.me$|^com\.facebook\.(katana|lite)$/, "Facebook"],
  [/^waitlist$/, SHARED],
  [/^google$|(^|\.)google\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$|^com\.google\.android\.[a-z.]+$/, "Google"],
  [/^direct$/, "Direct"],
];
const named = (s: string) => SOURCES.find(([re]) => re.test(s))?.[1];
export function sourceOf(r: { referrer?: string | null; utm?: Record<string, string> | null; userAgent?: string | null }): string {
  const tag = r.utm?.utm_source?.trim().toLowerCase();
  if (tag) return named(tag) ?? tag.slice(0, 40);
  let host: string | null = null;
  try {
    host = r.referrer ? new URL(r.referrer).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {}
  if (host && host !== "heyorbit.in" && !host.endsWith(".heyorbit.in")) return named(host) ?? host.slice(0, 40); // our own pages are no source
  const app = deviceOf(r.userAgent).app;
  return app && ["Instagram", "Facebook", "LinkedIn", "X"].includes(app) ? app : "Direct";
}

// A count per name, most first.
export type Tally = { name: string; count: number }[];

// GET /galaxy/prelaunch/stats: the whole waitlist summed up, for People holders. Days and hours are India's (IST).
// Only joins are kept, so there are no visit or conversion numbers.
export type InterestStats = {
  total: number;
  today: number; // since midnight IST
  week: number; // the last 7 days, today included
  days: { day: string; count: number }[]; // the last 30 days, oldest first, "2026-11-18"
  hours: number[]; // joins by hour of day, 0 to 23
  ages: Tally; // in age order: 18–19, 20–21, 22–24, 25–29, 30+
  medianAge: number | null;
  wants: { feature: Feature; count: number }[]; // people who picked each, most first; a person can pick several
  asked: number; // joins that were asked about features (the first waitlist wasn't)
  wantedNone: number; // of those, joins that picked none
  sources: Tally;
  campaigns: Tally; // "source / medium / campaign" of tagged links
  apps: Tally;
  os: Tally;
  cities: Tally; // "City, Region", only for joins since Cloudflare's location headers went on (18 Nov 2026)
  located: number; // joins with a city
  countries: Tally;
  emailDomains: Tally; // gmail.com, college and work domains
};
