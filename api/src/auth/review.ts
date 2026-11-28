import { readContact } from "@orbit/contract";
import { sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { type Env, fail } from "../http.ts";

// App Store and Play reviewers' sign-in (PM X20; owner, 27 Nov 2026: "Fixed code, review emails"). Reviewers can't get a
// code, so a few review-only emails take one fixed code and nothing is sent (codes.ts). Set on the API box only:
// - REVIEW_CODE: 6 digits, as the app's code field takes.
// - REVIEW_EMAILS: comma-separated, in this order: Orbit's reviewer, Event Partner's, Play Partner's. Fewer seeds fewer.
// Both unset: off, and sign-in is exactly as without this. Neither value is ever logged or sent in a response.
export const REVIEW_APPS = ["orbit", "launch", "station"] as const;
export type ReviewApp = (typeof REVIEW_APPS)[number];
export type ReviewConfig = { code: string; emails: ReadonlySet<string>; accounts: { app: ReviewApp; email: string }[] };

export function reviewFrom(code?: string, emails?: string): ReviewConfig | null {
  code = code?.trim();
  const list = emails?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (!code && !list.length) return null;
  if (!code || !list.length) throw new Error("REVIEW_CODE and REVIEW_EMAILS are set together, or neither");
  // A code anyone would try first isn't one: three different digits at least.
  if (!/^\d{6}$/.test(code) || new Set(code).size < 3) throw new Error("REVIEW_CODE must be 6 digits, at least 3 of them different");
  if (list.length > REVIEW_APPS.length) throw new Error(`REVIEW_EMAILS takes up to ${REVIEW_APPS.length} emails: Orbit's, Event Partner's, Play Partner's`);
  const accounts = list.map((e, i) => {
    const c = readContact(e);
    if (!c || c === "abroad" || c.kind !== "email") throw new Error(`REVIEW_EMAILS entry ${i + 1} isn't an email`);
    return { app: REVIEW_APPS[i]!, email: c.email };
  });
  return { code, emails: new Set(accounts.map((a) => a.email)), accounts };
}

// A review account is marked by users.review (which app's), set by the seed only (auth/review-seed.ts), so the mark holds
// whatever the env says later: Galaxy tags it, analytics leave it out, its hosts stay private and its ways in stay put.
// Its phone is +91 00000000 0N: no real number starts with 0 after +91 and nothing typed can become one (readPhone takes
// 6-9 only), so it belongs to nobody and never signs in by WhatsApp; it is there so the account needs no phone step.
export const reviewPhone = (app: ReviewApp) => `+91000000000${REVIEW_APPS.indexOf(app) + 1}`;
export const isReview = (u: { review: string | null }) => u.review !== null;
// For analytics' raw SQL: a real person, on `users` or the alias `u`.
export const realPerson = sql.raw("review is null");
export const realPersonU = sql.raw("u.review is null");

// After `signedIn`: a review account's ways in, account and staff access stay as the seed made them, so a reviewer can't
// lock out the next one, keep a way in past the code, or take the account out of review (PM X20 review).
export const notForReview = createMiddleware<Env>(async (c, next) => {
  if (c.var.user.review) return fail(c, 403, "reviewAccount", "This is a demo account for app review, so this can't be changed.");
  await next();
});
