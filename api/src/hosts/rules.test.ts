import { test } from "node:test";
import assert from "node:assert/strict";
import { type Action, type Status, parentRule, statusRule } from "./rules.ts";

// The Hosts flow's status and parent rules, row by row.
const none = { eventsWithBookings: 0, openMoney: 0 };

test("an owner's status moves", () => {
  const to: Record<Action, Partial<Record<Status, Status>>> = {
    pause: { live: "paused" },
    resume: { paused: "live" },
    archive: { live: "archived", paused: "archived" },
    restore: { archived: "live" },
  };
  for (const action of Object.keys(to) as Action[])
    for (const from of ["live", "paused", "suspended", "archived"] as Status[]) {
      const want = to[action][from];
      assert.deepEqual(statusRule(from, action, none), want ? { ok: true, to: want } : { ok: false, error: "notNow" }, `${action} from ${from}`);
    }
});

test("pause and archive wait for bookings and money; resume and restore don't", () => {
  for (const blockers of [{ eventsWithBookings: 1, openMoney: 0 }, { eventsWithBookings: 0, openMoney: 2 }]) {
    assert.deepEqual(statusRule("live", "pause", blockers), { ok: false, error: "busy" });
    assert.deepEqual(statusRule("paused", "archive", blockers), { ok: false, error: "busy" });
    assert.deepEqual(statusRule("paused", "resume", blockers), { ok: true, to: "live" });
    assert.deepEqual(statusRule("archived", "restore", blockers), { ok: true, to: "live" });
  }
  assert.deepEqual(statusRule("suspended", "pause", { eventsWithBookings: 1, openMoney: 0 }), { ok: false, error: "notNow" }); // not busy: not allowed at all
});

test("a club sits one level under a host", () => {
  const host = { id: "h", hasClubs: false };
  const top = { id: "p", status: "live" as Status, liftTo: null as string | null, parentId: null };
  assert.deepEqual(parentRule(host, top), { ok: true });
  assert.deepEqual(parentRule(host, { ...top, status: "paused" }), { ok: true }); // only archived is refused
  assert.deepEqual(parentRule(host, { ...top, id: "h" }), { ok: false, error: "self" });
  assert.deepEqual(parentRule(host, null), { ok: false, error: "notFound" });
  assert.deepEqual(parentRule(host, { ...top, status: "archived" }), { ok: false, error: "notFound" });
  assert.deepEqual(parentRule(host, { ...top, status: "suspended", liftTo: "archived" }), { ok: false, error: "notFound" }); // archived, then suspended
  assert.deepEqual(parentRule(host, { ...top, status: "suspended", liftTo: "live" }), { ok: true });
  assert.deepEqual(parentRule(host, { ...top, parentId: "g" }), { ok: false, error: "tooDeep" }); // the parent is a club
  assert.deepEqual(parentRule({ ...host, hasClubs: true }, top), { ok: false, error: "tooDeep" }); // the host has clubs
});
