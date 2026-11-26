import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNELS, inboxApp, KINDS } from "./notifications.ts";

const kinds = Object.entries(KINDS);

test("99 kinds: the plan's 94 plus the five host kinds (D1)", () => assert.equal(kinds.length, 99));

test("a kind has an inbox exactly when it names whose", () => {
  for (const [name, d] of kinds) assert.equal(d.inbox, d.app !== null, name);
});

test("staff kinds are email only, always", () => {
  for (const [name, d] of kinds.filter(([, d]) => d.group === "staff")) {
    assert.deepEqual([d.push, d.inbox, d.email, d.level], [false, false, "always", "must"], name);
  }
});

test("no kind uses a channel outside email, push and inbox", () => {
  for (const [name, d] of kinds) {
    const used = [d.email ? "email" : null, d.push ? "push" : null, d.inbox ? "inbox" : null].filter((c) => c !== null);
    assert.ok(used.length > 0, name);
    for (const c of used) assert.ok((CHANNELS as readonly string[]).includes(c), name);
    assert.deepEqual(Object.keys(d).sort(), ["app", "email", "group", "inbox", "level", "opens", "push", "type", "vars"], name);
  }
});

test("the role's app: crew, desk, else Event Partner", () => {
  assert.equal(inboxApp("teamRoleStarted", { role: "crew" }), "crew");
  assert.equal(inboxApp("teamRoleStarted", { role: "desk" }), "station");
  assert.equal(inboxApp("teamRoleStarted", { role: "admin" }), "launch");
  assert.equal(inboxApp("teamRemoved", {}), "launch");
  assert.equal(inboxApp("staffRiskyAction"), null);
});
