import assert from "node:assert/strict";
import { test } from "node:test";
import { allCities, popularCities, searchCities } from "./cities.ts";

test("every popular city is in the list (find would throw otherwise)", () => {
  assert.equal(popularCities.length, 12);
  assert.equal(popularCities[0]?.name, "Hyderabad");
  assert.ok(popularCities.every((c) => c && c.state));
});

test("the list is A to Z with no duplicate city-state pairs", () => {
  const names = allCities.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en")));
  assert.equal(new Set(allCities.map((c) => `${c.name}|${c.state}`)).size, allCities.length);
});

test("search: names that start with the query come first, states match too", () => {
  assert.equal(searchCities("hyd")[0]?.name, "Hyderabad");
  assert.equal(searchCities("  WAR ")[0]?.name, "Warangal");
  const kerala = searchCities("kerala");
  assert.ok(kerala.length >= 5 && kerala.every((c) => c.state === "Kerala"));
  const pur = searchCities("pur").map((c) => c.name);
  assert.equal(pur[0], "Puri"); // "Puri" starts with "pur"; "Jaipur" only contains it
  assert.deepEqual(searchCities("   "), []);
  assert.deepEqual(searchCities("zzz"), []);
});
