import type { MetadataRoute } from "next";
import { SITE } from "./site";

// The site's three pages. Dates are the day each last changed.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, lastModified: "2026-11-18", changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/terms`, lastModified: "2026-11-18", changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE}/privacy`, lastModified: "2026-11-18", changeFrequency: "yearly", priority: 0.3 },
  ];
}
