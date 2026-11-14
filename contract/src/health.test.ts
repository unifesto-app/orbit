import { test } from "node:test";
import assert from "node:assert/strict";
import { HealthResponse } from "./health.ts";

test("HealthResponse accepts the health payload", () => {
  const ok = HealthResponse.safeParse({ status: "ok", service: "orbit-api", version: "0.0.0" });
  assert.equal(ok.success, true);
});

test("HealthResponse rejects a wrong status", () => {
  const bad = HealthResponse.safeParse({ status: "down", service: "orbit-api", version: "0.0.0" });
  assert.equal(bad.success, false);
});
