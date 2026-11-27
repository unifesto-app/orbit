import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventDetails } from "@orbit/contract";
import { boxOf, detailsOf } from "./details.ts";

test("kind details go to the form's boxes and back, the category's keys only", () => {
  const hack: EventDetails = {
    teamMin: 2, teamMax: 4,
    tracks: [{ name: "AI", brief: "Build with models" }],
    criteria: [{ name: "Idea", weight: 60 }, { name: "Build", weight: 40 }],
    language: "Hindi", // not a hackathon's
  };
  const boxes = (d: EventDetails) => (k: keyof EventDetails) => boxOf(k, d);
  assert.equal(boxOf("criteria", hack), "Idea | 60\nBuild | 40");
  assert.deepEqual(detailsOf("hackathons", boxes(hack)), { teamMin: 2, teamMax: 4, tracks: hack.tracks, criteria: hack.criteria });
  const fest: EventDetails = { festType: "Food festival", highlights: ["Stalls", "Bands"] };
  assert.deepEqual(detailsOf("fests", boxes(fest)), fest);
  assert.deepEqual(detailsOf("comedy", () => "  "), {}); // empty boxes are left out
  assert.deepEqual(detailsOf("meetups", boxes(hack)), {});
});
