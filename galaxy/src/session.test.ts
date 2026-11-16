import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNext } from "./session.ts";

// After sign-in Galaxy goes only to a path on itself, read the way a browser reads it.
test("safeNext keeps paths on Galaxy and drops anything else", () => {
  const cases: [unknown, string][] = [
    ["/hosts/abc?q=1", "/hosts/abc?q=1"],
    ["/", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/\t/evil.example", "/"], // a URL parser drops the tab: //evil.example
    ["/\n/evil.example", "/"],
    ["https://evil.example/x", "/"],
    ["javascript:alert(1)", "/"],
    [null, "/"],
  ];
  for (const [given, want] of cases) assert.equal(safeNext(given), want, JSON.stringify(given));
});
