import { z } from "zod";

// Images and videos on Orbit come in three shapes only (owner's rule, 14 Nov 2026; square for photos and logos, and
// 4.5:1 for Orbit's own ad strips, are their own rules below):
//   3:4      portrait
//   4:3      landscape
//   1:1.414  A-series poster, portrait (A4, A3, A2 print shape, 1:√2)
// Uploads that are none of these are refused, never cropped silently.
export const MediaRatio = z.enum(["3:4", "4:3", "1:1.414"]);
export type MediaRatio = z.infer<typeof MediaRatio>;

// width / height for each allowed shape.
const shapes: Record<MediaRatio, number> = { "3:4": 3 / 4, "4:3": 4 / 3, "1:1.414": 1 / Math.SQRT2 };

// CSS `aspect-ratio` value for each allowed shape.
export const mediaAspect: Record<MediaRatio, string> = { "3:4": "3 / 4", "4:3": "4 / 3", "1:1.414": "1 / 1.4142" };

// Which allowed shape a width × height file has, or null for anything else.
// 1% slack absorbs the rounding a resize leaves (1001 × 1335 is still 3:4); the shapes sit
// at least 6% apart, so the slack never lets one pass as another.
export function mediaRatio(width: number, height: number): MediaRatio | null {
  if (!(width > 0 && height > 0)) return null;
  const r = width / height;
  for (const ratio of MediaRatio.options) {
    if (Math.abs(r / shapes[ratio] - 1) <= 0.01) return ratio;
  }
  return null;
}

// People's photos and host logos are square, the one shape outside the three (User doc, decision 7: "square, shown
// round"; owner, 15 Nov 2026: "1:1 for Host Logos, Guests/Speakers/People Photos"). Its own rule, so a square poster
// still fails `mediaRatio`. The same 1% slack.
export const isSquare = (width: number, height: number) => width > 0 && height > 0 && Math.abs(width / height - 1) <= 0.01;

// Orbit's own ad strips are 4.5:1, the fourth shape, for them alone (owner, 19 Nov 2026: "Allow 4.5:1 for ads"). Refused
// otherwise, never cropped; the same 1% slack.
export const isStrip = (width: number, height: number) => width > 0 && height > 0 && Math.abs(width / height / 4.5 - 1) <= 0.01;

// PUT /me/photo (multipart, field `photo`): JPG, PNG or WebP up to 5 MB (User doc, Profile). The API decides the type
// from the bytes, not from what the upload says it is.
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
