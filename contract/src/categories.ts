// Orbit's categories, fixed in code (Galaxy flow), one per event (Discover decision 12). No alcohol or nightlife.
// The Discover flow's eight tiles, in its order (owner, 19 Nov 2026: "The eight tiles", replacing the ten): Jams is
// jamming sessions to start; Events holds everything else, band gigs included (Discover 24). The category decides
// one-tap Fests, Loved it and slots (Discover 21). api/drizzle/0014_eight_tiles.sql moved stored events off the old
// slugs (music to jams; workshops, film and startups to events).
// The slug is what URLs and the API carry; the label is what people read.
export const categories = [
  { slug: "comedy", label: "Comedy" },
  { slug: "jams", label: "Jams" },
  { slug: "meetups", label: "Meetups" },
  { slug: "hackathons", label: "Hackathons" },
  { slug: "fests", label: "Fests" },
  { slug: "gaming", label: "Gaming" },
  { slug: "sports", label: "Sports" },
  { slug: "events", label: "Events" },
] as const;

/** Where an old category went (for anything saved before the eight tiles, such as a phone's picked interests). */
export const movedCategory: Record<string, CategorySlug> = { music: "jams", workshops: "events", film: "events", startups: "events" };

export type CategorySlug = (typeof categories)[number]["slug"];
