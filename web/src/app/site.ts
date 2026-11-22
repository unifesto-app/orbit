import { WAITLIST_CONTACT } from "@orbit/contract";

// What the site says about itself, in one place: its address, its search description and who runs it.

export const SITE = "https://heyorbit.in";

// The search and link-preview descriptions (owner, 18 Nov 2026: "make it seo friendly"): what Orbit has, so search and
// AI answers can say what it is. They name no place (owner, 21 Nov 2026: was "coming to Hyderabad").
export const DESCRIPTION =
  "There’s more to live beyond the usual. Fests in one click, turf, courts and gaming by the hour, hackathons, meetups, and the comedians and bands you love, on Orbit.";
export const WAITLIST_DESCRIPTION =
  "Join the Orbit waitlist for fests in one click, turf, courts and gaming by the hour, hackathons, meetups, and the comedians and bands you love.";

// Who Orbit is for, so the right people see themselves and the rest pass (owner, 19 Nov 2026), on the homepage and the
// waitlist.
export const FIT = [
  "You’ve said “there’s nothing to do this weekend” and didn’t quite believe it.",
  "You usually hear about the good stuff a day late.",
  "You’d try a jam, a comedy night or a hackathon with people you haven’t met yet.",
  "You’d rather book the turf than plan it over twenty messages.",
  "You want what’s on near you in one place, not spread across ten WhatsApp groups.",
];

// One address with the welcome email (api/src/prelaunch-email.ts).
export const CONTACT = WAITLIST_CONTACT;
export const LEGAL_UPDATED = "22 November 2026";

// Orbit's accounts, for the footers and the structured data (owner, 18 Nov 2026: "add X account to web"); the X handle
// also marks link previews on X as Orbit's.
export const SOCIAL = [
  ["Instagram", "https://www.instagram.com/heyorbit.in"],
  ["X", "https://x.com/HeyOrbitIn"],
] as const;
export const X_HANDLE = "@HeyOrbitIn";

// Link previews for every page: a page that sets its own openGraph replaces the root's whole object, so each spreads
// this (the image is app/opengraph-image.png).
export const OPEN_GRAPH = {
  type: "website" as const,
  siteName: "Orbit",
  locale: "en_IN",
  images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "Orbit: There’s more to live beyond the usual." }],
};
