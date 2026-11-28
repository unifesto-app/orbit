import { readContact } from "@orbit/contract";
import { sql } from "drizzle-orm";
import type { Review } from "./codes.ts";

// App Store and Play reviewers' sign-in (PM X20; owner, 27 Nov 2026: "Fixed code, review emails"). Reviewers can't get a
// code, so a few review-only emails take one fixed code and nothing is sent (codes.ts). Set on the API box only:
// - REVIEW_CODE: 6 digits, as the app's code field takes.
// - REVIEW_EMAILS: comma-separated, in this order: Orbit's reviewer, Event Partner's, Play Partner's. Fewer seeds fewer.
// Both unset: off, and sign-in is exactly as without this. Neither value is ever logged or sent in a response.
export const REVIEW_APPS = ["orbit", "launch", "station"] as const;
export type ReviewApp = (typeof REVIEW_APPS)[number];
export type ReviewConfig = Review & { accounts: { app: ReviewApp; email: string }[] };

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

// A review account's phone: +91 0000 0000 0N. No real number starts with 0 after +91 and nothing typed can become one
// (readPhone takes 6-9 only), so it belongs to nobody, never collides and never signs in by WhatsApp. It is also how the
// rest of the API knows a review account from the database alone, whatever the env says later: Galaxy tags it, analytics
// leaves it out, and its hosts stay private.
// ponytail: the phone is the mark, so no migration; a column if review accounts ever need a real number.
export const REVIEW_PHONE = "+9100000000";
export const reviewPhone = (app: ReviewApp) => `${REVIEW_PHONE}0${REVIEW_APPS.indexOf(app) + 1}`;
export const isReview = (u: { phone: string | null }) => !!u.phone?.startsWith(REVIEW_PHONE);
// For analytics' raw SQL: a real person, on `users` or the alias `u`.
export const realPerson = sql.raw(`coalesce(phone, '') not like '${REVIEW_PHONE}%'`);
export const realPersonU = sql.raw(`coalesce(u.phone, '') not like '${REVIEW_PHONE}%'`);
