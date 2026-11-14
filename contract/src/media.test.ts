import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaRatio, mediaRatio } from "./media.ts";

test("mediaRatio accepts 3:4 and 4:3, including resize rounding", () => {
  assert.equal(mediaRatio(1080, 1440), "3:4");
  assert.equal(mediaRatio(3024, 4032), "3:4"); // phone photo, portrait
  assert.equal(mediaRatio(1001, 1335), "3:4");
  assert.equal(mediaRatio(1440, 1080), "4:3");
  assert.equal(mediaRatio(640, 480), "4:3");
});

test("mediaRatio accepts A-series posters", () => {
  assert.equal(mediaRatio(2480, 3508), "1:1.414"); // A4 at 300 dpi
  assert.equal(mediaRatio(1240, 1754), "1:1.414"); // A4 at 150 dpi
  assert.equal(mediaRatio(3508, 4961), "1:1.414"); // A3 at 300 dpi
  assert.equal(mediaRatio(420, 594), "1:1.414"); // A2 in mm
});

test("mediaRatio refuses every other shape and bad sizes", () => {
  assert.equal(mediaRatio(1080, 1080), null); // square
  assert.equal(mediaRatio(1920, 1080), null); // 16:9
  assert.equal(mediaRatio(1080, 1920), null); // 9:16 story
  assert.equal(mediaRatio(1080, 1350), null); // 4:5, close to 3:4 but not it
  assert.equal(mediaRatio(1080, 1620), null); // 2:3 movie poster
  assert.equal(mediaRatio(3508, 2480), null); // A4 landscape: posters are portrait only
  assert.equal(mediaRatio(0, 1440), null);
  assert.equal(mediaRatio(Number.NaN, 1440), null);
});

test("MediaRatio schema only allows the three shapes", () => {
  assert.equal(MediaRatio.safeParse("3:4").success, true);
  assert.equal(MediaRatio.safeParse("1:1.414").success, true);
  assert.equal(MediaRatio.safeParse("16:9").success, false);
});
