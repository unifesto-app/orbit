// Orbit's categories, fixed in code (Galaxy flow), one per event (Discover decision 12). No alcohol or nightlife.
// The Discover flow's tiles, in its order (owner, 19 Nov 2026: "The eight tiles"; ten since 26 Nov with Workshops and Run clubs): Jams is
// jamming sessions to start; Events holds everything else, band gigs included (Discover 24). The category decides
// one-tap Fests, Loved it and slots (Discover 21). api/drizzle/0014_eight_tiles.sql moved stored events off the old
// slugs (music to jams; workshops, film and startups to events). Owner, 26 Nov 2026: workshops and run clubs go on
// Orbit as their own kinds, so ten tiles; Workshops is a tile again and no longer moves to Events. Events stays last,
// the catch-all.
// The slug is what URLs and the API carry; the label is what people read.
export const categories = [
  { slug: "comedy", label: "Comedy" },
  { slug: "jams", label: "Jams" },
  { slug: "meetups", label: "Meetups" },
  { slug: "hackathons", label: "Hackathons" },
  { slug: "fests", label: "Fests" },
  { slug: "workshops", label: "Workshops" },
  { slug: "gaming", label: "Gaming" },
  { slug: "sports", label: "Sports" },
  { slug: "run-clubs", label: "Run clubs" },
  { slug: "events", label: "Events" },
] as const;

/** Where an old category went (for anything saved before the eight tiles, such as a phone's picked interests). */
export const movedCategory: Record<string, CategorySlug> = { music: "jams", film: "events", startups: "events" };

export type CategorySlug = (typeof categories)[number]["slug"];
