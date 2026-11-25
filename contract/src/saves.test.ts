import { test } from "node:test";
import assert from "node:assert/strict";
import { ListBody, listName, ListId, nameLength, RemoveSaves, RestoreSaves } from "./saves.ts";

const id = "5f1c0f9e-1c1d-4c6e-8f3a-2b7d9a1e4c10";
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => assert.equal(s.safeParse(v).success, true, JSON.stringify(v));
const bad = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => assert.equal(s.safeParse(v).success, false, JSON.stringify(v));

test("list names are trimmed and counted as people count them", () => {
  assert.deepEqual(listName("  Weekend  "), { name: "Weekend" });
  assert.ok("problem" in listName("   "));
  assert.ok("name" in listName("😀".repeat(40)));
  assert.ok("problem" in listName("😀".repeat(41)));
  assert.ok("name" in listName("ఆ".repeat(40)));
  assert.ok("problem" in listName("a\u0000b"));
});

test("list ids are the app's own, short and plain", () => {
  ok(ListId, "l_lq3x9ab2");
  for (const v of ["", "a b", "x".repeat(41), "a/b", "a\u0000b"]) bad(ListId, v);
});

test("remove and restore bodies", () => {
  ok(RemoveSaves, { eventIds: [id] });
  bad(RemoveSaves, { eventIds: [] });
  bad(RemoveSaves, { eventIds: ["x"] });
  ok(RestoreSaves, { saves: [{ eventId: id, at: new Date().toISOString() }], lists: { l_a: [id] } });
  bad(RestoreSaves, { saves: [{ eventId: id, at: "yesterday" }], lists: {} });
});

test("nameLength works without Intl.Segmenter, as on Hermes", () => {
  assert.equal(nameLength("abc", null), 3);
  assert.equal(nameLength("ఆ".repeat(5) + "\u0C3E", null), 5); // a vowel sign joins the letter before
  assert.equal(nameLength("😀".repeat(3), null), 3);
  assert.equal(nameLength("😀😀"), 2);
});

test("a list body takes create and a first event only together", () => {
  ok(ListBody, { name: "A" });
  ok(ListBody, { name: "A", create: true, eventId: id });
  bad(ListBody, { name: "A", eventId: id });
  bad(ListBody, { name: "A", create: false });
});
