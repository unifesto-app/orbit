import { test } from "node:test";
import assert from "node:assert/strict";
import type { EditEvent } from "@orbit/contract";
import { editRule, effectiveVisibility, placeColumns, stageOf, timesRule, visibilityRule } from "./rules.ts";

// The Hosts and Discover flows' event rules, row by row.
const NOW = Date.parse("2026-12-01T12:00:00Z");
const past = new Date(NOW - 1000), future = new Date(NOW + 1000);
const ok = { ok: true };
const edit = (p: object) => p as EditEvent;

const nothingStored = { startsAt: null, timezone: "Asia/Kolkata", online: false, onlineLink: null, venue: null, address: null, area: null, city: null, lat: null, lng: null, placeId: null };
const stored = (status: "draft" | "published" | "cancelled", endsAt: Date | null, more: object = {}) => ({ ...nothingStored, status, endsAt, ...more });
const hall = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4, placeId: null };
const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };

test("a cancelled event can't be edited, whatever the patch", () => {
  assert.deepEqual(editRule(stored("cancelled", future), edit({ title: "x" }), NOW), { ok: false, error: "cancelled" });
});

test("an ended, published event can't change its date, place or online details; the rest stays editable", () => {
  const e = stored("published", past, { startsAt: new Date(NOW - 5000), ...hall });
  const different = {
    startsAt: null, endsAt: null, timezone: "Asia/Dubai", place: null, online: true, onlineLink: "https://meet.example.com/x",
  };
  for (const [key, v] of Object.entries(different)) assert.deepEqual(editRule(e, edit({ [key]: v }), NOW), { ok: false, error: "ended" }, key);
  assert.deepEqual(editRule(e, edit({ place: { ...place, venue: "Other" } }), NOW), { ok: false, error: "ended" });
  for (const key of ["title", "about", "agenda", "faq", "terms", "category", "slug", "visibility"])
    assert.deepEqual(editRule(e, edit({ [key]: null }), NOW), ok, key);
  // ends exactly now counts as ended
  assert.deepEqual(editRule(stored("published", new Date(NOW)), edit({ startsAt: "2026-12-01T10:00:00Z" }), NOW), { ok: false, error: "ended" });
});

test("a whole form sent back with the same date and place passes on an ended event", () => {
  const e = stored("published", past, { startsAt: new Date(NOW - 5000), timezone: "Asia/Kolkata", onlineLink: "https://meet.example.com/x", online: true, ...hall });
  const same = edit({
    title: "New title", startsAt: new Date(NOW - 5000).toISOString(), endsAt: past.toISOString(), timezone: "Asia/Kolkata",
    place: { ...place, placeId: null }, online: true, onlineLink: "https://meet.example.com/x",
  });
  assert.deepEqual(editRule(e, same, NOW), ok);
  // the same instant written with another offset is the same instant
  assert.deepEqual(editRule(e, edit({ endsAt: new Date(past.getTime()).toISOString().replace("Z", "+00:00") }), NOW), ok);
});

test("drafts, running and open-ended events never lock", () => {
  assert.deepEqual(editRule(stored("draft", past), edit({ startsAt: null }), NOW), ok);
  assert.deepEqual(editRule(stored("published", future), edit({ place: null }), NOW), ok);
  assert.deepEqual(editRule(stored("published", null), edit({ place: null }), NOW), ok);
});

test("a published event's end can't be moved into the past; a draft's can", () => {
  const live = stored("published", future);
  const early = { ok: false, error: "endInPast" };
  assert.deepEqual(editRule(live, edit({ endsAt: past.toISOString() }), NOW), early);
  assert.deepEqual(editRule(live, edit({ endsAt: new Date(NOW).toISOString() }), NOW), early);
  assert.deepEqual(editRule(stored("published", null), edit({ endsAt: past.toISOString() }), NOW), early);
  assert.deepEqual(editRule(live, edit({ endsAt: future.toISOString() }), NOW), ok);
  assert.deepEqual(editRule(live, edit({ endsAt: null }), NOW), ok);
  assert.deepEqual(editRule(stored("draft", future), edit({ endsAt: past.toISOString() }), NOW), ok);
});

test("start and end are checked as merged with what's stored", () => {
  const stored = { startsAt: new Date("2026-12-10T10:00:00Z"), endsAt: null };
  assert.deepEqual(timesRule(stored, edit({ endsAt: "2026-12-10T09:00:00Z" })), { ok: false, error: "endsBeforeStart" });
  assert.deepEqual(timesRule(stored, edit({ endsAt: "2026-12-10T10:00:00Z" })), { ok: false, error: "endsBeforeStart" });
  assert.deepEqual(timesRule(stored, edit({ endsAt: "2026-12-10T11:00:00Z" })), ok);
  const both = { startsAt: new Date("2026-12-10T10:00:00Z"), endsAt: new Date("2026-12-10T12:00:00Z") };
  assert.deepEqual(timesRule(both, edit({ startsAt: "2026-12-10T13:00:00Z" })), { ok: false, error: "endsBeforeStart" });
  assert.deepEqual(timesRule(both, edit({ startsAt: null })), ok); // a null clears
  assert.deepEqual(timesRule(both, edit({ endsAt: null })), ok);
  assert.deepEqual(timesRule(both, edit({ title: "x" })), ok); // untouched keys aren't re-judged
});

test("a private host's events can't be made public", () => {
  assert.deepEqual(visibilityRule("private", edit({ visibility: "public" })), { ok: false, error: "linkOnly" });
  assert.deepEqual(visibilityRule("private", edit({ visibility: "link" })), ok);
  assert.deepEqual(visibilityRule("private", edit({ title: "x" })), ok);
  assert.deepEqual(visibilityRule("public", edit({ visibility: "public" })), ok);
});

test("a private host's events show as link-only, whatever they stored", () => {
  assert.equal(effectiveVisibility("private", "public"), "link");
  assert.equal(effectiveVisibility("private", "link"), "link");
  assert.equal(effectiveVisibility("public", "public"), "public");
  assert.equal(effectiveVisibility("public", "link"), "link");
});

test("an event is a draft, upcoming or past by status and end time", () => {
  assert.equal(stageOf({ status: "draft", endsAt: past }, NOW), "draft");
  assert.equal(stageOf({ status: "published", endsAt: future }, NOW), "upcoming");
  assert.equal(stageOf({ status: "published", endsAt: null }, NOW), "upcoming");
  assert.equal(stageOf({ status: "published", endsAt: past }, NOW), "past");
  assert.equal(stageOf({ status: "published", endsAt: new Date(NOW) }, NOW), "past");
  assert.equal(stageOf({ status: "cancelled", endsAt: future }, NOW), "upcoming");
  assert.equal(stageOf({ status: "cancelled", endsAt: past }, NOW), "past");
});

test("a place is written or cleared whole", () => {
  const nulls = { venue: null, address: null, area: null, city: null, lat: null, lng: null, placeId: null };
  assert.deepEqual(placeColumns(null), nulls);
  const p = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
  assert.deepEqual(placeColumns(p as any), { ...p, placeId: null });
  assert.deepEqual(placeColumns({ ...p, placeId: "ChIJ" } as any), { ...p, placeId: "ChIJ" });
});
