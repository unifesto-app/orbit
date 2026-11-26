import assert from "node:assert/strict";
import { test } from "node:test";
import { badge, kindLabel, readBody, whenLabel } from "./inbox.ts";

const ID = "6f1c2a3e-1b2c-4d5e-8f90-1a2b3c4d5e6f";

test("badge: nothing at 0, the number to 9, then 9+", () => {
  assert.equal(badge(0), null);
  assert.equal(badge(-1), null);
  assert.equal(badge(3), "3");
  assert.equal(badge(9), "9");
  assert.equal(badge(10), "9+");
});

test("readBody: the launch inbox, with checked ids or none for all", () => {
  assert.deepEqual(readBody(), { app: "launch" });
  assert.deepEqual(readBody([ID]), { app: "launch", ids: [ID] });
  assert.equal(readBody(["nope"]), null);
  assert.equal(readBody("x"), null);
  assert.equal(readBody(Array(101).fill(ID)), null);
});

test("kindLabel and whenLabel read as the host app's", () => {
  assert.equal(kindLabel("teamInvite"), "Team invite");
  assert.equal(whenLabel("2026-11-26T12:42:00Z"), "26 Nov, 6:12 pm");
  assert.equal(whenLabel("garbage"), "");
});
