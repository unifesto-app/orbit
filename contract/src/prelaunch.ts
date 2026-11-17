import { z } from "zod";

// Prelaunch interest (owner, 17 Nov 2026: "add express interest and collect info, email", "metadata is much needed and
// display no of people shows interest", "create a page in galaxy web - prelaunch"). Coming Soon takes an email; the web
// server adds what the visit says about itself. Nothing in `meta` is proof of anything: the API's own record of the
// visitor's address is `ip`, read from the request, never from the body.

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

// One address: dot-separated parts that can't hold a dot, so the pattern can't backtrack, and it runs only within 254
// characters (zod would otherwise test the pattern on a string already too long).
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

// POST /public/interest: 204 for a new email and one already on the list alike, so it tells nobody who has joined.
export const Interest = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v.length <= 254 && !v.includes("\0") && EMAIL.test(v)),
  meta: InterestMeta.default({}),
});
export type Interest = z.infer<typeof Interest>;

// GET /public/interest.
export type InterestCount = { count: number };

// GET /galaxy/prelaunch?page=: everyone who has asked, newest first (People only).
export type InterestRow = InterestMeta & { id: string; email: string; ip: string | null; createdAt: string };
export type InterestList = { people: InterestRow[]; total: number; page: number; pageSize: number };
