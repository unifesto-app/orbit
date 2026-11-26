import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNELS, EMAIL_SWITCHES, inboxApp, KINDS, PUSH_SWITCHES } from "./notifications.ts";

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
    assert.deepEqual(Object.keys(d).sort(), ["app", "email", "group", "inbox", "level", "opens", "push", "switch", "type", "vars"], name);
  }
});

test("the role's app: crew, desk, else Event Partner", () => {
  assert.equal(inboxApp("teamRoleStarted", { role: "crew" }), "crew");
  assert.equal(inboxApp("teamRoleStarted", { role: "desk" }), "station");
  assert.equal(inboxApp("teamRoleStarted", { role: "admin" }), "launch");
  assert.equal(inboxApp("teamRemoved", {}), "launch");
  assert.equal(inboxApp("staffRiskyAction"), null);
});

test("a support reply lands in the app it was asked from, opening Help", () => {
  assert.equal(inboxApp("supportReply", { app: "station" }), "station");
  assert.equal(inboxApp("supportReply", { app: "launch" }), "launch");
  assert.equal(inboxApp("supportReply", { app: "orbit" }), "orbit");
  assert.equal(inboxApp("supportReply", { app: "crew" }), "crew");
  assert.equal(inboxApp("supportReply", { app: "nope" }), "orbit");
  assert.equal(inboxApp("supportReply"), "orbit");
  assert.equal(KINDS.supportReply.opens, "help");
});

test("every optional kind has a switch, every Must kind none; email switches are push switches", () => {
  for (const [name, d] of kinds) {
    if (d.level === "must") assert.equal(d.switch, null, name);
    else assert.ok((PUSH_SWITCHES as readonly string[]).includes(d.switch!), name);
  }
  for (const s of EMAIL_SWITCHES) assert.ok((PUSH_SWITCHES as readonly string[]).includes(s));
});
