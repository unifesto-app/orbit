import { test } from "node:test";
import assert from "node:assert/strict";
import { EditStation, NewStation, slotPrice, Week } from "./slots.ts";

type S = { safeParse: (v: unknown) => { success: boolean } };
const ok = (s: S, v: unknown) => assert.equal(s.safeParse(v).success, true, JSON.stringify(v));
const bad = (s: S, v: unknown) => assert.equal(s.safeParse(v).success, false, JSON.stringify(v));

const all = (h: [number, number] | null) => Array(7).fill(h);

test("Week is seven days, each valid hours or closed", () => {
  ok(Week, all([11, 23]));
  ok(Week, all(null));
  bad(Week, all([11, 23]).slice(1));
  for (const h of [[11, 11], [11, 10], [-1, 5], [24, 25], [0, 25], [8, 31]]) bad(Week, all(h as [number, number]));
});

test("a late close can't run into the next day's opening", () => {
  ok(Week, all([11, 26])); // 2 AM, then 11 AM
  ok(Week, all([4, 28])); // closes at 4 AM, opens at 4 AM: touching is fine
  bad(Week, all([3, 28])); // closes at 4 AM, opens at 3 AM
});

test("past-midnight close meets the next opening, Saturday into Sunday too", () => {
  const w = all([11, 26]);
  w[6] = [11, 28]; // Sat till 4 AM
  w[0] = [3, 12]; // Sun opens at 3 AM: runs into Sat's night
  bad(Week, w);
  w[0] = [4, 12];
  ok(Week, w);
  w[1] = null; // a closed next day never collides
  w[0] = [11, 30];
  ok(Week, w);
});

const station = { name: "Gaming PC", unit: "PC", tile: "gaming", count: 12, pricePaise: 16200 };

test("NewStation: off-peak is cheaper than the price", () => {
  ok(NewStation, station);
  ok(NewStation, { ...station, offPeak: { from: 11, to: 16, weekdays: true, pricePaise: 12000 } });
  bad(NewStation, { ...station, offPeak: { from: 11, to: 16, weekdays: true, pricePaise: 16200 } });
  bad(NewStation, { ...station, offPeak: { from: 16, to: 11, weekdays: true, pricePaise: 12000 } });
  bad(NewStation, { ...station, tile: "bowling" });
  bad(NewStation, { ...station, pricePaise: 99 });
});

test("EditStation: any field; off-peak still checked when both come", () => {
  ok(EditStation, {});
  ok(EditStation, { archived: true });
  ok(EditStation, { offPeak: { from: 11, to: 16, weekdays: false, pricePaise: 20000 } }); // the route checks the stored price
  bad(EditStation, { pricePaise: 10000, offPeak: { from: 11, to: 16, weekdays: false, pricePaise: 10000 } });
});

test("slotPrice: each half hour at its own rate, times count; co-op shares one; free is 0", () => {
  // Off-peak 2-4 PM on weekdays at ₹60, else ₹100. Friday 20 Nov 2026, India time.
  const s = { pricePaise: 10000, coopPaise: 15000, offPeak: { from: 14, to: 16, weekdays: true, pricePaise: 6000 } };
  const at = (t: string) => Date.parse(`2026-11-20T${t}+05:30`);
  assert.equal(slotPrice(s, at("14:00:00"), 2, 1), 12000);
  assert.equal(slotPrice(s, at("15:30:00"), 1, 1), 3000 + 5000); // half off-peak, half not
  assert.equal(slotPrice(s, at("15:30:00"), 1, 3), (3000 + 5000) * 3);
  assert.equal(slotPrice(s, at("18:00:00"), 2, 2), 10000 * 2 * 2);
  assert.equal(slotPrice(s, Date.parse("2026-11-21T14:00:00+05:30"), 1, 1), 10000); // Saturday: weekdays only
  assert.equal(slotPrice(s, at("14:00:00"), 1, 3, true), 15000); // co-op: one station's rate, not per player
  assert.equal(slotPrice({ pricePaise: 0 }, at("14:00:00"), 3, 4), 0);
});
