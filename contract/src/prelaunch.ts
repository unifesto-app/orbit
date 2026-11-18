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
export const InterestCode = z.object({ phone: z.string().min(1).max(20), proof: Proof.optional().catch(undefined) });

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
