// Orbit's categories, fixed in code (Galaxy flow), one per event (Discover decision 12). No alcohol or nightlife.
// Ten since the owner dropped Art and Theatre (15 Nov 2026: "remove Art, Theatre").
// The slug is what URLs and the API carry (the web's /search?c=music); the label is what people read.
export const categories = [
  { slug: "hackathons", label: "Hackathons" },
  { slug: "comedy", label: "Comedy" },
  { slug: "music", label: "Music" },
  { slug: "meetups", label: "Meetups" },
  { slug: "workshops", label: "Workshops" },
  { slug: "fests", label: "Fests" },
  { slug: "sports", label: "Sports" },
  { slug: "film", label: "Film" },
  { slug: "startups", label: "Startups" },
  { slug: "gaming", label: "Gaming" },
] as const;

export type CategorySlug = (typeof categories)[number]["slug"];
