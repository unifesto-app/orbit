import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNext } from "./session.ts";

// After sign-in the Console goes only to a path on itself, read the way a browser reads it.
test("safeNext keeps paths on the Console and drops anything else", () => {
  const cases: [unknown, string][] = [
    ["/hosts/abc?q=1", "/hosts/abc?q=1"],
    ["/", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/\t/evil.example", "/"], // a URL parser drops the tab: //evil.example
    ["/\n/evil.example", "/"],
    // Dot segments fold to a path that starts "//" (review of the Console sign-in).
    ["/.//evil.example", "/"],
    ["/x/..//evil.example", "/"],
    ["/%2e//evil.example", "/"],
    ["/./\\evil.example", "/"],
    ["//console.invalid//evil.example", "/"],
    ["/a/./b/../c?x=1", "/a/c?x=1"],
    ["https://evil.example/x", "/"],
    ["javascript:alert(1)", "/"],
    [null, "/"],
  ];
  for (const [given, want] of cases) assert.equal(safeNext(given), want, JSON.stringify(given));
});
