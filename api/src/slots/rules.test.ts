import assert from "node:assert/strict";
import { test } from "node:test";
import type { Week } from "@orbit/contract";
import { type Claim, HOUR, MIN, admitTo, counts, door, fits, hours, openOn, outsideWeek, scanRefusal, stranded, taken, timeLabel, walkIn, walkInStart } from "./rules.ts";

// Parity with host/src/station/day.test.ts: the same cases, on a week with the same hours every day, then the cases a week adds.
const every = (h: [number, number] | null) => Array(7).fill(h) as Week;
const cafe = every([11, 26]); // 11 AM to 2 AM
const turf = every([6, 24]);
const pc = { id: "pc", step: 30 as const, count: 12 };
const pitch = { id: "football", step: 60 as const, count: 2 };
const day = Date.UTC(2026, 10, 22) - 330 * MIN; // Sun 22 Nov 2026, midnight in India
const at = (h: number, m = 0) => day + h * HOUR + m * MIN;
const now = at(18, 20);

let n = 0;
const claim = (c: Partial<Claim> & Pick<Claim, "stationId" | "count" | "start" | "end">): Claim => ({
  id: `c${n++}`, kind: "booking", status: "paid", holdEnd: null, admitted: 0, checkedIn: null, checkedInBy: null, released: null, ...c,
});
const booking = (count: number, start: number, end: number, more: Partial<Claim> = {}) => claim({ stationId: "pc", count, start, end, ...more });
const ids = (l: Claim[]) => l.map((c) => c.id);

test("walk-ins start at the current step, floored in India time", () => {
  assert.equal(timeLabel(walkInStart(30, at(18, 20))), "6:00 PM");
  assert.equal(timeLabel(walkInStart(30, at(18, 40))), "6:30 PM");
  assert.equal(timeLabel(walkInStart(60, at(18, 40))), "6:00 PM");
});

test("a booking beats a walk-in, and the counter says what is free", () => {
  const claims = [booking(10, at(19), at(21))];
  const fit = walkIn(claims, cafe, pc, now, 1, 2);
  assert.ok(fit.ok && timeLabel(fit.start) === "6:00 PM" && timeLabel(fit.end) === "7:00 PM");
  assert.deepEqual(walkIn(claims, cafe, pc, now, 2, 3), { ok: false, line: "3 free only until 7:00 PM" });
  assert.deepEqual(walkIn(claims, cafe, pc, at(19, 10), 1, 3), { ok: false, line: "Only 2 free until 9:00 PM" });
  assert.deepEqual(walkIn(claims, cafe, pc, at(25, 40), 1, 13), { ok: false, line: "Only 12 free till closing" });
  const full = [claim({ stationId: "football", count: 2, start: at(18), end: at(20) })];
  assert.deepEqual(walkIn(full, turf, pitch, now, 1, 1), { ok: false, line: "None free until 8:00 PM" });
});

test("blocks and walk-ins take stations; released and refunded bookings give them back", () => {
  const claims = [
    booking(10, at(19), at(21)),
    booking(1, at(18), at(22), { kind: "block" }),
    booking(3, at(18), at(19), { status: "released" }),
    booking(2, at(18), at(19), { status: "refunded" }),
  ];
  assert.deepEqual(taken(claims, pc, at(19, 30), now), { booking: 10, walkin: 0, block: 1, free: 1 });
  assert.equal(taken(claims, pc, at(18), now).free, 11);
});

test("a hold counts until it lapses, no job needed", () => {
  const held = booking(4, at(19), at(20), { status: "held", holdEnd: at(18, 30) });
  assert.equal(counts(held, at(18, 29)), true);
  assert.equal(counts(held, at(18, 30)), false);
  assert.equal(taken([held], pc, at(19), at(18, 29)).free, 8);
  assert.equal(taken([held], pc, at(19), at(18, 31)).free, 12);
  assert.equal(fits([held], pc, at(19), at(20), 9, at(18, 29)), false);
  assert.equal(fits([held], pc, at(19), at(20), 9, at(18, 31)), true);
});

test("a walk-in freed early this step leaves its station free for the next one", () => {
  const claims = [claim({ stationId: "football", kind: "walkin", status: "freed", count: 2, start: at(18), end: at(18, 20) })];
  assert.equal(taken(claims, pitch, at(18, 20), now).free, 2);
  const again = walkIn(claims, turf, pitch, now, 1, 2);
  assert.ok(again.ok && again.start === now && timeLabel(again.end) === "7:00 PM"); // from now: never two groups on one station
  const sold = [...claims, claim({ stationId: "football", kind: "walkin", status: "checked_in", count: 2, start: now, end: at(19) })];
  for (const s of [at(18), at(18, 20), at(18, 40)]) assert.ok(taken(sold, pitch, s, now).free >= 0 && taken(sold, pitch, s, now).walkin <= pitch.count);
});

test("a shut venue takes no walk-ins; the opening flips at closing", () => {
  assert.deepEqual(walkIn([], cafe, pc, at(8), 1, 1), { ok: false, line: "Opens at 11:00 AM" });
  assert.deepEqual(walkIn([], cafe, pc, at(27), 1, 1), { ok: false, line: "Opens at 11:00 AM" }); // 3 AM, after the night
  const late = walkIn([], cafe, pc, at(25), 3, 1); // 1 AM: the night's opening, cut at 2 AM
  assert.ok(late.ok && timeLabel(late.end) === "2:00 AM");
  assert.equal(hours(cafe, at(25)).day, day); // a café open till 2 AM is still on yesterday at 1 AM
  assert.equal(hours(cafe, at(25)).state, "open");
  assert.equal(hours(cafe, at(11)).day, day);
  assert.deepEqual([hours(cafe, at(25, 59)).state, hours(cafe, at(25, 59)).day === day], ["open", true]);
  assert.deepEqual([hours(cafe, at(26)).state, hours(cafe, at(26)).day === day + 24 * HOUR], ["before", true]);
  assert.equal(hours(turf, at(23, 59)).state, "open");
  assert.deepEqual([hours(turf, at(24)).state, hours(turf, at(24)).day === day + 24 * HOUR], ["before", true]);
  assert.equal(hours(turf, at(5)).state, "before");
});

test("a block goes through the same check as a walk-in", () => {
  const claims = [booking(12, at(19), at(20))];
  assert.deepEqual(walkIn(claims, cafe, pc, now, 2, 1), { ok: false, line: "1 free only until 7:00 PM" });
  assert.equal(walkIn([], cafe, pc, at(25, 40), 1, 1).ok, true); // 1:40 AM: the night's last step
});

test("check-in opens 15 minutes early; a booking can be released 15 minutes in", () => {
  const c = booking(2, at(18, 30), at(20, 30));
  assert.equal(door(c, at(18, 14)), "soon");
  assert.equal(door(c, at(18, 15)), "open");
  assert.equal(door(c, at(18, 40)), "late");
  assert.equal(door(c, at(18, 45)), "noShow");
  assert.equal(door({ ...c, checkedIn: at(18, 50) }, at(19)), "here");
  assert.equal(door({ ...c, released: at(18, 30) }, at(19)), "released");
  assert.equal(door(c, at(20, 30)), "missed");
});

test("letting in never goes past the booking, and a double tap counts once", () => {
  const three = booking(3, at(18, 30), at(20, 30));
  assert.equal(admitTo(three, 5, at(18, 20), "Ravi").admitted, 3);
  assert.equal(admitTo(three, 0, at(18, 20), "Ravi").admitted, 0);
  const one = admitTo(three, 1, at(18, 20), "Ravi");
  assert.equal(admitTo(admitTo(three, 1, at(18, 20), "you"), 1, at(18, 20), "you").admitted, 1);
  assert.equal(admitTo(admitTo(one, 0, at(18, 21), "you"), 1, at(18, 21), "you").admitted, 1); // never fewer than are in
  const all = admitTo(admitTo(three, 2, at(18, 20), "Ravi"), 3, at(18, 50), "Sana");
  assert.deepEqual([all.admitted, all.checkedIn, all.checkedInBy, all.status], [3, at(18, 20), "Ravi", "checked_in"]); // the first time and who stay
});

test("the scanner checks in order: refunded, released, ended, early", () => {
  const c = booking(2, at(18, 30), at(19, 30));
  assert.equal(scanRefusal({ ...c, status: "refunded" }, at(20))?.error, "refunded"); // refunded and ended
  assert.equal(scanRefusal({ ...c, status: "released" }, at(20))?.error, "released"); // released and ended
  assert.equal(scanRefusal(c, at(20))?.error, "ended");
  assert.equal(scanRefusal({ ...c, status: "checked_in" }, at(18, 14))?.error, "early"); // early wins over in
  assert.deepEqual(scanRefusal(c, at(18, 14)), { error: "early", message: "Too early: check-in opens 15 minutes before the start." });
  assert.equal(scanRefusal(c, at(18, 15)), null);
  assert.equal(scanRefusal(c, at(19, 29)), null); // a late arrival still gets in, until the booked end
});

test("fewer stations are refused while bookings stand in the way", () => {
  const claims = [
    booking(8, at(19), at(21)),
    booking(3, at(20), at(22)),
    booking(4, at(23), at(24)),
    booking(4, at(20), at(21), { kind: "walkin", status: "checked_in" }), // the desk can free a walk-in
    booking(9, at(20), at(21), { status: "released" }), // gone
  ];
  const [a, b, c] = claims;
  assert.deepEqual(ids(stranded(claims, "pc", 12, now)), []);
  assert.deepEqual(ids(stranded(claims, "pc", 10, now)), [a!.id, b!.id]); // 8 + 3 at 8 PM
  assert.deepEqual(ids(stranded(claims, "pc", 3, now)), [a!.id, b!.id, c!.id]);
  assert.deepEqual(ids(stranded(claims, "pc", 12, at(22, 30))), []); // played already
  assert.deepEqual(ids(stranded(claims, "ps5", 0, now)), []); // another station's
});

test("a closed day and per-weekday hours", () => {
  const w = every([11, 23]);
  w[1] = [11, 26]; // Monday till 2 AM
  w[2] = null; // Tuesday closed
  assert.deepEqual(openOn(w, day), [11, 23]);
  assert.deepEqual(openOn(w, day + 24 * HOUR), [11, 26]);
  assert.equal(openOn(w, day + 48 * HOUR), null);
  const mon = day + 24 * HOUR;
  assert.equal(hours(w, mon + 25 * HOUR).state, "open"); // Tue 1 AM is still Monday's night
  assert.equal(hours(w, mon + 25 * HOUR).day, mon);
  assert.deepEqual(walkIn([], w, pc, mon + 26 * HOUR + 10 * MIN, 1, 1), { ok: false, line: "Closed for the day" }); // Tue 2:10 AM
  assert.deepEqual(walkIn([], w, pc, mon + 36 * HOUR, 1, 1), { ok: false, line: "Closed for the day" }); // Tue noon
  assert.equal(hours(w, mon + 36 * HOUR).state, "after");
  assert.deepEqual(walkIn([], w, pc, mon + 60 * HOUR - 30 * MIN, 1, 1).ok, true); // Wed 11:30 AM
});

test("a new week strands bookings outside its hours", () => {
  const old = every([11, 26]);
  const claims = [
    booking(1, at(19), at(21)),
    booking(1, at(22), at(23, 30)), // ends 11:30 PM
    booking(1, at(25), at(26)), // 1 AM to 2 AM: Sunday's night
    booking(1, at(19), at(21), { status: "refunded" }), // gone
  ];
  const [a, b, c] = claims;
  assert.deepEqual(ids(outsideWeek(claims, old, old, now)), []); // no change
  const shorter = every([11, 23]);
  assert.deepEqual(ids(outsideWeek(claims, old, shorter, now)), [b!.id, c!.id]); // the late one, and the night
  const sundayShut = every([11, 26]);
  sundayShut[0] = null;
  assert.deepEqual(ids(outsideWeek(claims, old, sundayShut, now)), [a!.id, b!.id, c!.id]);
  const later = every([20, 26]);
  assert.deepEqual(ids(outsideWeek(claims, old, later, now)), [a!.id]);
  assert.deepEqual(ids(outsideWeek(claims, old, shorter, at(22, 30))), [b!.id, c!.id]); // b still runs; a played already
  assert.deepEqual(ids(outsideWeek(claims, old, shorter, at(23, 45))), [c!.id]);
});
