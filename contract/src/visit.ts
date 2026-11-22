import { z } from "zod";
import { InterestMeta, type Tally } from "./prelaunch.ts";

// The site's own visit log (owner, 19 Nov 2026: "website and pages analytics in galaxy web", "Our own visit log"): one
// row per page view of heyorbit.in, no cookies. The browser sends a view when a page opens, "start" when the waitlist
// form is first touched, and "leave" with the time the page was visible and its Core Web Vitals; "got a code" and
// "joined" are marked by the API when those succeed (InterestCode and Interest carry the view id). A row keeps only
// what the sums use (page, source, app and system names, place, times, steps), never the address, browser string or
// link. Each visitor is a code over the address's network and browser, keyed by a salt that is random each day and
// deleted after it, so a code can't be remade once its day is over.

// Every opening's page counts as one, "/careers/[slug]" (web visit.tsx), so the list stays short.
export const PAGES = ["/", "/waitlist", "/terms", "/privacy", "/careers", "/careers/[slug]"] as const;

const id = z.string().uuid();
const ms = (max: number) => z.number().int().min(0).max(max);

// POST /public/visit, from the web's own server (web /v), which adds what the request's headers say.
export const VisitHit = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("view"), id, path: z.enum(PAGES) })
    .extend(InterestMeta.pick({ referrer: true, utm: true, timezone: true, language: true, screen: true, country: true, region: true, city: true, userAgent: true }).shape),
  z.object({
    kind: z.literal("leave"),
    id,
    ms: ms(6 * 3600_000), // time the page was visible so far; sent each time it's hidden, the largest kept
    lcp: ms(120_000).optional(),
    inp: ms(120_000).optional(),
    ttfb: ms(120_000).optional(),
    cls: z.number().min(0).max(100).optional(),
  }),
  z.object({ kind: z.literal("start"), id }),
]);
export type VisitHit = z.infer<typeof VisitHit>;

// GET /galaxy/website/stats: the last 30 days of visits, for People holders. Days are India's (IST). Every visitor is
// one visitor-day (the code changes daily), counted under the source of their first view that day.
export type SiteStats = {
  since: string | null; // the first logged day ("2026-11-19"): joins before it aren't in the log
  visitors: number;
  views: number;
  today: { visitors: number; views: number };
  days: { day: string; visitors: number; views: number; joined: number }[]; // 30, oldest first
  funnel: { visitors: number; started: number; code: number; joined: number }; // visitors who reached each step
  sources: { name: string; visitors: number; joined: number }[]; // most visitors first, top 12 and "Others"
  pages: { name: string; views: number; visitors: number; seconds: number | null }[]; // median visible seconds a view
  seconds: number | null; // median visible seconds a view, all pages
  os: Tally; // visitors
  apps: Tally;
  countries: Tally;
  cities: Tally;
  vitals: { lcp: number | null; inp: number | null; cls: number | null; ttfb: number | null; samples: number }; // 75th percentile
};
