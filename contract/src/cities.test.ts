import assert from "node:assert/strict";
import { test } from "node:test";
import { allCities, isServed, isServedState, popularCities, searchCities, stateOf } from "./cities.ts";

test("every popular city is in the list (find would throw otherwise)", () => {
  assert.equal(popularCities.length, 12);
  assert.equal(popularCities[0]?.name, "Hyderabad");
  assert.ok(popularCities.every((c) => c && c.state));
  assert.ok(popularCities.every((c) => isServedState(c.state)), "popular cities are all where Orbit is open");
});

test("Orbit is open in Telangana and Andhra Pradesh only; a place it can't put in a state counts as open", () => {
  assert.equal(isServedState("Telangana"), true);
  assert.equal(isServedState("andhra pradesh"), true);
  assert.equal(isServedState("TG"), true);
  assert.equal(isServedState("AP"), true);
  assert.equal(isServedState("Karnataka"), false);
  // A picked city carries its state; a found place may carry the geocoder's region; older saved places carry neither.
  assert.equal(isServed({ area: "Warangal", city: "Telangana", state: "Telangana" }), true);
  assert.equal(isServed({ area: "Bengaluru", city: "Karnataka", state: "Karnataka" }), false);
  assert.equal(isServed({ area: "Gachibowli", city: "Hyderabad", state: "TS" }), true);
  assert.equal(isServed({ area: "Koramangala", city: "Bengaluru" }), false); // by the city's name
  assert.equal(isServed({ area: "Gachibowli", city: "Hyderabad" }), true);
  assert.equal(isServed({ area: "Tirupati", city: "Andhra Pradesh" }), true);
  assert.equal(stateOf({ area: "Somewhere", city: "Kerala" }), "Kerala"); // a city named as its state
  assert.equal(isServed({ area: "Nowhere", city: "Unknown" }), true);
  // A region we can't read falls back to the city: a phone in Telugu or Hindi, or a longer name.
  assert.equal(isServed({ area: "Gachibowli", city: "Hyderabad", state: "తెలంగాణ" }), true);
  assert.equal(isServed({ area: "Gachibowli", city: "Hyderabad", state: "तेलंगाना" }), true);
  assert.equal(isServed({ area: "Gachibowli", city: "Hyderabad", state: "Telangana State" }), true);
  assert.equal(isServed({ area: "Koramangala", city: "Bengaluru", state: "ಕರ್ನಾಟಕ" }), false);
  assert.equal(isServed({ area: "Nowhere", city: "Unknown", state: "Somewhere" }), true); // nothing to go on: open
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
