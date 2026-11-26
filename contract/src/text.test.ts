import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "./text.ts";

test("Text refuses NUL and lone surrogates, keeps real pairs", () => {
  const t = Text(1, 50);
  assert.ok(t.safeParse("Open mic 🎤").success);
  for (const bad of ["a\u0000b", "a\uD83Cb", "\uDFA4", "end\uD83C", "a\uDFA4\uD83C"]) assert.equal(t.safeParse(bad).success, false, JSON.stringify(bad));
});
