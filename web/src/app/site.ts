import { WAITLIST_CONTACT } from "@orbit/contract";

// What the site says about itself, in one place: its address, its search description and who runs it.

export const SITE = "https://heyorbit.in";

// The search and link-preview description (owner, 18 Nov 2026: "make it seo friendly"). The page itself shows only the
// line; this names what Orbit has, so search and AI answers can say what it is.
export const DESCRIPTION =
  "Orbit is coming to Hyderabad. Join the waitlist for fests in one click, turf, courts and gaming by the hour, hackathons, meetups, and the comedians and bands you love.";

// Who runs Orbit for the legal pages: Unifesto Private Limited until Orbit's own company is formed (orbit-plan.md,
// "Ready for the company change"); the terms and privacy policy pass to that company.
export const OPERATOR = "Unifesto Private Limited";
// One address with the welcome email (api/src/prelaunch-email.ts).
export const CONTACT = WAITLIST_CONTACT;
export const LEGAL_UPDATED = "18 November 2026";

// Link previews for every page: a page that sets its own openGraph replaces the root's whole object, so each spreads
// this (the image is app/opengraph-image.png).
export const OPEN_GRAPH = {
  type: "website" as const,
  siteName: "Orbit",
  locale: "en_IN",
  images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "Orbit: There’s more to live beyond the usual." }],
};
