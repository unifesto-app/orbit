import { test } from "node:test";
import assert from "node:assert/strict";
import { fresh, heldUntil, HOLD_MS } from "./security.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const MIN = 60_000;

test("a device is fresh for 10 minutes after a code", () => {
  assert.equal(fresh({ freshAt: new Date(NOW - 9 * MIN) }, NOW), true);
  assert.equal(fresh({ freshAt: new Date(NOW - 10 * MIN) }, NOW), false);
  assert.equal(fresh({ freshAt: null }, NOW), false);
});

test("after Is this you?, only an older way in lifts the 7-day hold", () => {
  const mark = new Date(NOW - 2 * 24 * 60 * MIN);
  const olderEmail = { newDevicePhoneAt: mark, emailVerifiedAt: new Date(mark.getTime() - MIN) };
  const newerEmail = { newDevicePhoneAt: mark, emailVerifiedAt: new Date(mark.getTime() + MIN) };
  const until = new Date(mark.getTime() + HOLD_MS);
  assert.deepEqual(heldUntil(olderEmail, { freshVia: "phone" }, NOW), until);
  assert.equal(heldUntil(olderEmail, { freshVia: "email" }, NOW), null); // a code to the email that was there lifts it
  assert.deepEqual(heldUntil(newerEmail, { freshVia: "email" }, NOW), until); // an email added since doesn't
  assert.deepEqual(heldUntil({ newDevicePhoneAt: mark, emailVerifiedAt: null }, { freshVia: null }, NOW), until);
  assert.equal(heldUntil({ ...olderEmail, newDevicePhoneAt: new Date(NOW - HOLD_MS) }, { freshVia: "phone" }, NOW), null); // 7 days on
  assert.equal(heldUntil({ newDevicePhoneAt: null, emailVerifiedAt: null }, { freshVia: "phone" }, NOW), null);
});
