import { test } from "node:test";
import assert from "node:assert/strict";
import { STAFF_FEATURES } from "@orbit/contract";
import { acceptRule, addRule, confirmRule, confirmSeatRule, endRule, endSeatRule, suspendRule, type Actor, type Grant, type Seat } from "./rules.ts";

// The Roles doc's staff and team rules, row by row.
const NOW = Date.parse("2026-11-16T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const owner: Actor = { id: "owner", owner: true, features: STAFF_FEATURES };
const staffA: Actor = { id: "a", owner: false, features: ["staff"] };
const staffB: Actor = { id: "b", owner: false, features: ["staff", "people"] };
const peopleOnly: Actor = { id: "p", owner: false, features: ["people"] };
const nobody: Actor = { id: "n", owner: false, features: [] };

test("giving a feature", () => {
  assert.deepEqual(addRule(staffA, { id: "x", owner: false }, NOW), { ok: true, startsAt: null }); // waits for a confirm
  assert.deepEqual(addRule(owner, { id: "x", owner: false }, NOW), { ok: true, startsAt: new Date(NOW + DAY) }); // 24 hours
  assert.deepEqual(addRule(peopleOnly, { id: "x", owner: false }, NOW), { ok: false, error: "forbidden" });
  assert.deepEqual(addRule(staffA, { id: "a", owner: false }, NOW), { ok: false, error: "self" });
  assert.deepEqual(addRule(staffA, { id: "owner", owner: true }, NOW), { ok: false, error: "owner" });
});

test("confirming a feature takes a third person", () => {
  const g: Grant = { userId: "x", addedBy: "a", startsAt: null, endedAt: null };
  assert.deepEqual(confirmRule(staffB, g), { ok: true });
  assert.deepEqual(confirmRule(staffA, g), { ok: false, error: "self" }); // the adder
  assert.deepEqual(confirmRule({ ...staffB, id: "x" }, g), { ok: false, error: "self" }); // the person
  assert.deepEqual(confirmRule(peopleOnly, g), { ok: false, error: "forbidden" });
  assert.deepEqual(confirmRule(staffB, { ...g, startsAt: new Date(NOW + DAY) }), { ok: false, error: "notWaiting" }); // owner's add
  assert.deepEqual(confirmRule(staffB, { ...g, endedAt: new Date(NOW) }), { ok: false, error: "notWaiting" });
});

test("taking a feature away is immediate, by anyone with Staff but the person", () => {
  const g: Grant = { userId: "x", addedBy: "a", startsAt: new Date(NOW), endedAt: null };
  assert.deepEqual(endRule(staffA, g), { ok: true }); // even the adder
  assert.deepEqual(endRule(staffB, { ...g, startsAt: new Date(NOW + DAY) }), { ok: true }); // cancelling the owner's add
  assert.deepEqual(endRule({ ...staffB, id: "x" }, g), { ok: false, error: "self" });
  assert.deepEqual(endRule(nobody, g), { ok: false, error: "forbidden" });
  assert.deepEqual(endRule(staffA, { ...g, endedAt: new Date(NOW) }), { ok: false, error: "notOpen" });
});

test("suspending an account", () => {
  const person = { id: "x", owner: false, staff: false };
  assert.deepEqual(suspendRule(peopleOnly, person), { ok: true });
  assert.deepEqual(suspendRule(staffA, person), { ok: false, error: "forbidden" });
  assert.deepEqual(suspendRule(peopleOnly, { ...person, id: "p" }), { ok: false, error: "self" });
  assert.deepEqual(suspendRule(owner, { ...person, id: "o2", owner: true }), { ok: false, error: "owner" });
  assert.deepEqual(suspendRule(peopleOnly, { ...person, staff: true }), { ok: false, error: "needsStaff" });
  assert.deepEqual(suspendRule(staffB, { ...person, staff: true }), { ok: true });
});

const seat = (o: Partial<Seat> = {}): Seat => ({ userId: null, addedBy: "admin", addedAt: new Date(NOW - DAY), acceptedAt: null, startedAt: null, endedAt: null, ...o });

test("accepting an invite", () => {
  assert.deepEqual(acceptRule(seat(), true, NOW), { ok: true });
  assert.deepEqual(acceptRule(seat(), false, NOW), { ok: false, error: "notFound" }); // someone else's
  assert.deepEqual(acceptRule(seat({ addedAt: new Date(NOW - 14 * DAY) }), true, NOW), { ok: false, error: "notWaiting" }); // 14 days
  assert.deepEqual(acceptRule(seat({ acceptedAt: new Date(NOW) }), true, NOW), { ok: false, error: "notWaiting" });
});

test("only the adder confirms an Admin, after Accept", () => {
  const accepted = seat({ userId: "x", acceptedAt: new Date(NOW) });
  assert.deepEqual(confirmSeatRule("admin", true, accepted, NOW), { ok: true });
  assert.deepEqual(confirmSeatRule("admin2", true, accepted, NOW), { ok: false, error: "forbidden" });
  assert.deepEqual(confirmSeatRule("admin", false, accepted, NOW), { ok: false, error: "forbidden" }); // no longer an Admin
  assert.deepEqual(confirmSeatRule("admin", true, seat(), NOW), { ok: false, error: "notAccepted" });
});

test("withdrawing and removing", () => {
  const started = { ...seat({ userId: "x", acceptedAt: new Date(NOW), startedAt: new Date(NOW) }), owner: false };
  assert.deepEqual(endSeatRule("admin", true, { ...seat(), owner: false }, NOW), { ok: true, reason: "withdrawn" });
  assert.deepEqual(endSeatRule("admin2", true, started, NOW), { ok: true, reason: "removed" });
  assert.deepEqual(endSeatRule("admin2", true, { ...started, owner: true }, NOW), { ok: false, error: "owner" });
  assert.deepEqual(endSeatRule("x", true, started, NOW), { ok: false, error: "self" });
  assert.deepEqual(endSeatRule("crew", false, started, NOW), { ok: false, error: "forbidden" });
});
