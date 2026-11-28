import assert from "node:assert/strict";
import { test } from "node:test";
import { SendCode } from "./user.ts";

test("a code send keeps the Android proof's package, and drops a proof whose package is bad", () => {
  const proof = { kind: "android", challenge: "c", token: "t", app: "in.heyorbit.launch" };
  assert.deepEqual(SendCode.parse({ to: "a@b.in", proof }).proof, proof);
  assert.deepEqual(SendCode.parse({ to: "a@b.in", proof: { kind: "android", challenge: "c", token: "t" } }).proof, { kind: "android", challenge: "c", token: "t" });
  assert.equal(SendCode.parse({ to: "a@b.in", proof: { ...proof, app: "" } }).proof, undefined);
});
