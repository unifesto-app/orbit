import { test } from "node:test";
import assert from "node:assert/strict";
import { fromBox, toBox } from "./ist.ts";

test("the date-and-time box reads and writes India's time", () => {
  assert.equal(toBox("2026-11-25T18:00:00+05:30"), "2026-11-25T18:00");
  assert.equal(toBox("2026-11-25T12:30:00Z"), "2026-11-25T18:00");
  assert.equal(toBox("2026-11-25T18:00:00-08:00"), "2026-11-26T07:30");
  assert.equal(toBox(undefined), "");
  assert.equal(fromBox(""), undefined);
  assert.equal(fromBox("2026-11-30T21:00"), "2026-11-30T21:00:00+05:30");
  assert.equal(toBox(fromBox("2026-11-30T21:00")), "2026-11-30T21:00");
});
