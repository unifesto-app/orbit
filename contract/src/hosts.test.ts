import { test } from "node:test";
import assert from "node:assert/strict";
import { EditHost, HostSlug } from "./hosts.ts";

test("HostSlug takes lowercase words joined by single hyphens", () => {
  for (const s of ["abc", "punchline-collective-k3f9", "a1-b2"]) assert.equal(HostSlug.safeParse(s).success, true, s);
  for (const s of ["ab", "-abc", "abc-", "a--b", "Abc", "a_b", "a b", "a".repeat(101)]) assert.equal(HostSlug.safeParse(s).success, false, s);
});

test("EditHost refuses an empty change and anything but https", () => {
  assert.equal(EditHost.safeParse({}).success, false);
  assert.deepEqual(EditHost.parse({ name: " Punchline " }), { name: "Punchline" });
  assert.equal(EditHost.safeParse({ website: "https://punchline.in" }).success, true);
  assert.equal(EditHost.safeParse({ website: null, about: null }).success, true);
  for (const w of ["http://punchline.in", "javascript:alert(1)", "ftp://x.in", "punchline.in"]) assert.equal(EditHost.safeParse({ website: w }).success, false, w);
  assert.equal(EditHost.safeParse({ about: "x".repeat(2001) }).success, false);
  assert.equal(EditHost.safeParse({ city: "Atlantis" }).success, false);
  assert.equal(EditHost.safeParse({ visibility: "hidden" }).success, false);
});
