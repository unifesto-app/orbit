import { test } from "node:test";
import assert from "node:assert/strict";
import { EditStation, NewStation, Week } from "./slots.ts";

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
