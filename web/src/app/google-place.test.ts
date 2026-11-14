import assert from "node:assert/strict";
import { test } from "node:test";
import { placeFromGoogle } from "./google-place.ts";

const c = (long_name: string, ...types: string[]) => ({ long_name, types: [...types, "political"] });

test("neighbourhood, sub-area and city, as other apps show them", () => {
  // Shape of Google's reverse geocode near the Malla Reddy campus.
  const results = [
    { address_components: [c("Maisammaguda", "sublocality_level_2", "sublocality"), c("Bahadurpally", "sublocality_level_1", "sublocality"), c("Hyderabad", "locality"), c("Medchal–Malkajgiri", "administrative_area_level_2"), c("Telangana", "administrative_area_level_1")] },
    { address_components: [c("Bahadurpally", "sublocality_level_1", "sublocality"), c("Hyderabad", "locality")] },
  ];
  assert.deepEqual(placeFromGoogle(results), { area: "Maisammaguda", sub: "Bahadurpally", city: "Hyderabad" });
});

test("falls back to sub-area, then city, without repeating a name", () => {
  assert.deepEqual(placeFromGoogle([{ address_components: [c("Gachibowli", "sublocality_level_1"), c("Hyderabad", "locality")] }]), { area: "Gachibowli", sub: "", city: "Hyderabad" });
  assert.deepEqual(placeFromGoogle([{ address_components: [c("Hyderabad", "locality")] }]), { area: "Hyderabad", sub: "", city: "" });
  assert.deepEqual(placeFromGoogle([{ address_components: [c("Ravulapalem", "neighborhood"), c("East Godavari", "administrative_area_level_2")] }]), { area: "Ravulapalem", sub: "", city: "East Godavari" });
});

test("nothing usable gives null", () => {
  assert.equal(placeFromGoogle([]), null);
  assert.equal(placeFromGoogle([{ address_components: [c("Telangana", "administrative_area_level_1")] }]), null);
});
