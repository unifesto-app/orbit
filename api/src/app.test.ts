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

test("GET / answers the plain-text footer; other unknown paths stay JSON 404", async () => {
  const app = createApp();
  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(await res.text(), "© 2027 Orbit");
  const nope = await app.request("/nope");
  assert.equal(nope.status, 404);
  assert.deepEqual(await nope.json(), { error: "notFound", message: "There's nothing here." });
});
