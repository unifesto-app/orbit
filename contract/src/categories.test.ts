import assert from "node:assert/strict";
import { test } from "node:test";

import { categories, movedCategory } from "./categories.ts";

test("the eight Discover tiles, in the doc's order", () => {
  assert.deepEqual(
    categories.map((c) => c.slug),
    ["comedy", "jams", "meetups", "hackathons", "fests", "gaming", "sports", "events"],
  );
});

test("every old category moves onto one of the eight, and none of the old ones is still a tile", () => {
  const slugs = new Set<string>(categories.map((c) => c.slug));
  assert.deepEqual(movedCategory, { music: "jams", workshops: "events", film: "events", startups: "events" });
  for (const [old, now] of Object.entries(movedCategory)) {
    assert.ok(slugs.has(now), `${old} moves to ${now}, a tile`);
    assert.ok(!slugs.has(old), `${old} isn't a tile any more`);
  }
});
