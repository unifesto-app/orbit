import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.ts";
import { HealthResponse } from "@orbit/contract";

test("GET /health returns a payload that matches the contract", async () => {
  const res = await createApp().request("/health");
  assert.equal(res.status, 200);
  const body = HealthResponse.parse(await res.json());
  assert.equal(body.service, "orbit-api");
});
