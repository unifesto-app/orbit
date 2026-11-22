import { z } from "zod";
import type { Tally } from "./prelaunch.ts";
import { Text } from "./text.ts";

// Careers (owner, 22 Nov 2026: "careers page at heyorbit.in/careers, link to galaxy", "Openings + applications"):
// openings staff write in Galaxy's Careers page, shown at heyorbit.in/careers while open, and the applications people
// send from each opening's page, with a PDF résumé, read back in Galaxy. Draft and closed openings aren't public.
// Résumés live in the private bucket under resumes/, never served by /media: only staff with People download them.

const keys = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const OPENING_KINDS = { full: "Full-time", intern: "Internship", part: "Part-time", contract: "Contract" } as const;
export type OpeningKind = keyof typeof OPENING_KINDS;
export const OPENING_STATUSES = { draft: "Draft", open: "Open", closed: "Closed" } as const;
export type OpeningStatus = keyof typeof OPENING_STATUSES;
export const APPLICATION_STATUSES = { new: "New", reviewing: "Reviewing", shortlisted: "Shortlisted", rejected: "Rejected", hired: "Hired" } as const;
export type ApplicationStatus = keyof typeof APPLICATION_STATUSES;

// One line each in "What you’ll do" and "What we’re looking for".
const Lines = z.array(Text(1, 200)).max(12);

// POST /galaxy/openings, PUT /galaxy/openings/:id: the whole opening. `about` is plain text, paragraphs split by a blank
// line. Its link (/careers/<slug>) is made from the first title and kept, so a shared link never breaks.
export const Opening = z.object({
  title: Text(1, 80),
  team: Text(1, 40),
  place: Text(1, 60), // "Hyderabad, in office", "Remote in India"
  kind: z.enum(keys(OPENING_KINDS)),
  pay: Text(1, 60).optional(),
  about: Text(1, 4000),
  does: Lines,
  needs: Lines,
  status: z.enum(keys(OPENING_STATUSES)),
});
export type Opening = z.infer<typeof Opening>;

// GET /public/openings: the open ones, for heyorbit.in/careers. GET /public/openings/:slug: one open opening; a draft
// or closed one is 404.
export type OpeningCard = { slug: string; title: string; team: string; place: string; kind: OpeningKind };
export type OpeningPage = OpeningCard & Pick<Opening, "pay" | "about" | "does" | "needs">;

// POST /public/openings/:slug/apply, multipart: these fields as text (an empty one counts as left out), `resume` (a
// PDF up to RESUME_MAX_BYTES, read by its bytes, not its name) and `turnstile` (the page's Cloudflare token). 204,
// also when that email has already applied for this opening (the first is kept), as the waitlist answers a number
// already on it, so nobody can learn who applied.
// Links are http(s) only: staff click them.
const WebLink = z
  .string()
  .trim()
  .max(300)
  .regex(/^https?:\/\/[^\s/?#]+\.[^\s]+$/i, "Give a full link, starting https://")
  .refine((s) => !s.includes("\u0000"), "Remove the NUL character");
export const Apply = z.object({
  name: Text(1, 100),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d][\d\s-]{6,18}$/, "Enter a phone number, digits only")
    .optional(),
  linkedin: WebLink.optional(),
  link: WebLink.optional(), // a portfolio, GitHub or anything else that shows their work
  note: Text(1, 2000).optional(),
});
export type Apply = z.infer<typeof Apply>;
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

/** The apply form's text fields as Apply reads them: trimmed, and an empty one left out. */
export const applyFields = (get: (name: string) => unknown) =>
  Object.fromEntries(
    (["name", "email", "phone", "linkedin", "link", "note"] as const).flatMap((k) => {
      const v = get(k);
      return typeof v === "string" && v.trim() ? [[k, v]] : [];
    }),
  );

// GET /galaxy/openings: every opening, newest first, with how many have applied and how many of those are still New.
export type OpeningAdmin = Opening & { id: string; slug: string; createdAt: string; updatedAt: string; applications: number; fresh: number };
export type OpeningList = { openings: OpeningAdmin[] };

// GET /galaxy/openings/:id/applications?page=: newest first, 50 a page. The résumé is downloaded on its own (GET
// /galaxy/applications/:id/resume, as an attachment). PUT /galaxy/applications/:id: { status }. DELETE
// /galaxy/applications/:id: the application and its résumé, for someone who asks (Privacy Policy).
// DELETE /galaxy/openings/:id: 204 for an opening nobody applied to; 409 "applied" otherwise (close it instead).
export type ApplicationAdmin = Apply & { id: string; status: ApplicationStatus; createdAt: string };
export type ApplicationList = { applications: ApplicationAdmin[]; total: number; page: number; pageSize: number };
export const SetApplication = z.object({ status: z.enum(keys(APPLICATION_STATUSES)) });

// GET /galaxy/careers/stats, for holders of People (owner, 22 Nov 2026: "bring analytics for careers"): the careers
// pages and their applications, summed up. Days are India's (IST), the last 30 counted to today.
// - Applications come from the applications table (as they stand: a deleted one isn't counted).
// - Visitors and sources come from the site's own cookieless visit log (contract/src/visit.ts): a visitor is one
//   visitor-day on /careers or an opening's page, the source is that day's first careers view's, and "applied" is a
//   visit the Apply form was sent from. Nothing about a visit is stored with the application, and no application is
//   tied to a visit after the fact. Visits from before applied was tracked show as not applied.
export type CareersStats = {
  total: number; // applications now on file
  today: number;
  week: number; // the last 7 days, today included
  open: number; // openings now Open
  days: { day: string; count: number }[]; // applications a day, the last 30 days
  statuses: Tally; // by status, in the pipeline's order, zeros included
  cities: Tally; // by the opening's city (its Where before the first comma), most first
  roles: Tally; // by the opening's title without ", <city>", most first
  openings: Tally; // the 10 openings with the most applications, by full title
  visitors: number; // visitor-days on the careers pages, the last 30 days
  funnel: { list: number; opening: number; applied: number }; // visitor-days that saw the list, an opening, and applied
  sources: { name: string; visitors: number; applied: number }[]; // careers visitor-days by source, most first
};
