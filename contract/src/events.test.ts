import { test } from "node:test";
import assert from "node:assert/strict";
import { categories } from "./categories.ts";
import { EditEvent, EditTicketType, EventCategory, EventRow, EventSlug, HostEvents, NewEvent, NewTicketType, Place, span, TeamEvent, TicketTypeFields } from "./events.ts";

type S = { safeParse: (v: unknown) => { success: boolean } };
const ok = (s: S, v: unknown) => assert.equal(s.safeParse(v).success, true, JSON.stringify(v));
const bad = (s: S, v: unknown) => assert.equal(s.safeParse(v).success, false, JSON.stringify(v));

test("EventSlug takes lowercase words joined by single hyphens", () => {
  for (const s of ["abc", "stand-up-night-hyderabad-k3f9", "a".repeat(110)]) ok(EventSlug, s);
  for (const s of ["ab", "-abc", "abc-", "a--b", "Abc", "a_b", "a".repeat(111)]) bad(EventSlug, s);
});

test("EventCategory is every category slug and nothing else", () => {
  for (const c of categories) ok(EventCategory, c.slug);
  bad(EventCategory, "nightlife");
});

const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };

test("Place stays inside India and on the city list", () => {
  ok(Place, place);
  ok(Place, { ...place, placeId: "ChIJxyz" });
  ok(Place, { ...place, placeId: null });
  bad(Place, { ...place, placeId: "" });
  for (const p of [{ lat: 5.9 }, { lat: 37.6 }, { lng: 67.9 }, { lng: 97.6 }, { city: "Atlantis" }, { venue: "  " }]) bad(Place, { ...place, ...p });
  bad(Place, { ...place, lat: 78.4, lng: 17.4 }); // swapped
  bad(Place, { ...place, lat: 0, lng: 0 });
});

test("NewEvent is a trimmed name", () => {
  assert.deepEqual(NewEvent.parse({ title: " Open mic " }), { title: "Open mic" });
  bad(NewEvent, { title: "   " });
  ok(NewEvent, { title: "x".repeat(120) });
  bad(NewEvent, { title: "x".repeat(121) });
});

const t1 = "2026-12-01T18:00:00+05:30";
const t2 = "2026-12-01T21:00:00+05:30";

test("EditEvent refuses an empty change and an event that ends before it starts", () => {
  bad(EditEvent, {});
  assert.deepEqual(EditEvent.parse({ title: " Open mic " }), { title: "Open mic" });
  ok(EditEvent, { startsAt: t1 });
  ok(EditEvent, { endsAt: t2 });
  ok(EditEvent, { startsAt: t1, endsAt: t2 });
  bad(EditEvent, { startsAt: t2, endsAt: t1 });
  bad(EditEvent, { startsAt: t1, endsAt: t1 });
  // The same instant in two offsets is equal, so refused; a minute later is fine.
  bad(EditEvent, { startsAt: "2026-12-01T12:30:00Z", endsAt: "2026-12-01T18:00:00+05:30" });
  ok(EditEvent, { startsAt: "2026-12-01T12:30:00Z", endsAt: "2026-12-01T18:01:00+05:30" });
  bad(EditEvent, { startsAt: "2026-12-01T18:00:00" }); // no offset
  bad(EditEvent, { startsAt: "2026-12-01 18:00" });
  ok(EditEvent, { place: null, about: null });
  bad(EditEvent, { about: "x".repeat(5001) });
});

test("EditEvent keeps its text clean and its dates in range", () => {
  bad(EditEvent, { title: "a\u0000b" });
  bad(EditEvent, { faq: [{ q: "a\u0000b", a: "y" }] });
  bad(EditEvent, { terms: ["a\u0000b"] });
  bad(EditEvent, { about: "   " });
  ok(EditEvent, { about: null });
  for (const y of ["0000", "1999", "2101"]) bad(EditEvent, { startsAt: `${y}-06-01T10:00:00Z` });
  ok(EditEvent, { startsAt: "2026-06-01T10:00:00Z" });
  bad(EditEvent, { agenda: [{ at: "0000-06-01T10:00:00Z", item: "Doors" }] });
});

test("EditEvent can empty a draft, and checks zone, link, visibility and slug", () => {
  ok(EditEvent, { startsAt: null });
  ok(EditEvent, { endsAt: null, startsAt: t1 });
  ok(EditEvent, { category: null });
  ok(EditEvent, { timezone: "Asia/Kolkata" });
  bad(EditEvent, { timezone: "Mars/Olympus" });
  bad(EditEvent, { timezone: null });
  ok(EditEvent, { visibility: "link" });
  bad(EditEvent, { visibility: "private" });
  ok(EditEvent, { onlineLink: "https://meet.example.com/abc" });
  ok(EditEvent, { onlineLink: null, online: true });
  bad(EditEvent, { onlineLink: "http://meet.example.com/abc" });
  bad(EditEvent, { onlineLink: "https://meet.example.com/a\u0000b" });
  ok(EditEvent, { slug: "open-mic-k3f9ab" });
  bad(EditEvent, { slug: "Open Mic" });
});

test("EditEvent caps agenda, faq and terms", () => {
  const a = { at: t1, item: "Doors" };
  const f = { q: "Parking?", a: "Yes" };
  ok(EditEvent, { agenda: Array(30).fill(a) });
  bad(EditEvent, { agenda: Array(31).fill(a) });
  bad(EditEvent, { agenda: [{ at: "6pm", item: "Doors" }] });
  ok(EditEvent, { faq: Array(20).fill(f) });
  bad(EditEvent, { faq: Array(21).fill(f) });
  bad(EditEvent, { faq: [{ q: "x".repeat(201), a: "y" }] });
  ok(EditEvent, { terms: Array(20).fill("No refunds") });
  bad(EditEvent, { terms: Array(21).fill("x") });
  bad(EditEvent, { terms: ["x".repeat(501)] });
  bad(EditEvent, { terms: [""] });
});

const ticket = { name: "General", pricePaise: 49900, quantity: 100, salesStartAt: null, salesEndAt: null, note: null, perPersonLimit: 10 };

test("TicketTypeFields prices in whole paise: free, or Rs 1 up to the sanity cap", () => {
  for (const p of [0, 100, 100_000_000]) ok(TicketTypeFields, { ...ticket, pricePaise: p });
  for (const p of [50, 99.5, -100, 100_000_001]) bad(TicketTypeFields, { ...ticket, pricePaise: p });
  // The rules survive .partial() on an edit.
  for (const p of [50, 150.5]) bad(EditTicketType, { pricePaise: p });
  ok(EditTicketType, { pricePaise: 150 });
});

test("TicketTypeFields text, quantity, limit and sales window", () => {
  bad(TicketTypeFields, { ...ticket, name: "a\u0000b" });
  bad(TicketTypeFields, { ...ticket, note: "   " });
  ok(TicketTypeFields, { ...ticket, quantity: null });
  for (const q of [0, 1.5, 100_001]) bad(TicketTypeFields, { ...ticket, quantity: q });
  for (const l of [0, 11, 2.5]) bad(TicketTypeFields, { ...ticket, perPersonLimit: l });
  ok(NewTicketType, { ...ticket, salesStartAt: t1, salesEndAt: t2 });
  ok(NewTicketType, { ...ticket, salesEndAt: t2 });
  bad(NewTicketType, { ...ticket, salesStartAt: t2, salesEndAt: t1 });
  bad(NewTicketType, { ...ticket, salesStartAt: t1, salesEndAt: t1 });
  bad(NewTicketType, { ...ticket, salesEndAt: "2101-01-01T00:00:00Z" });
  bad(NewTicketType, { ...ticket, salesEndAt: "0000-01-01T00:00:00Z" });
  bad(EditTicketType, {});
  ok(EditTicketType, { note: "One ticket covers four people" });
  bad(EditTicketType, { salesStartAt: t2, salesEndAt: t1 });
});

test("NewTicketType needs only a name and a price", () => {
  assert.deepEqual(NewTicketType.parse({ name: "General", pricePaise: 0 }), {
    name: "General",
    pricePaise: 0,
    quantity: null,
    salesStartAt: null,
    salesEndAt: null,
    note: null,
    perPersonLimit: 10,
  });
  bad(NewTicketType, { name: "General" });
  bad(NewTicketType, { pricePaise: 0 });
  // An edit never fills in what it didn't mention.
  assert.deepEqual(EditTicketType.parse({ note: "Hi" }), { note: "Hi" });
});

const id = "3f2b8c1e-5a4d-4e6f-9a7b-1c2d3e4f5a6b";
const iso = "2026-12-01T12:00:00.000Z";
const eventRow = { id, slug: "night-k3f9ab", status: "draft", visibility: "public", title: "Night", category: null, startsAt: null, endsAt: null, timezone: "Asia/Kolkata", area: null, city: null, online: false, sold: 0, checkedIn: 0 };
const teamEvent = {
  ...eventRow, hostId: id, place: null, onlineLink: null, about: null, agenda: [], faq: [], terms: [],
  poster: null, wide: null, wideEdge: null, tone: null, publishedAt: null, cancelledAt: null, cancelReason: null, saved: null, createdAt: iso, updatedAt: iso,
};

test("TeamEvent, EventRow and HostEvents are what the API answers", () => {
  ok(TeamEvent, teamEvent);
  ok(TeamEvent, { ...teamEvent, place: { ...place, placeId: null }, agenda: [{ at: iso, item: "Doors" }], startsAt: iso });
  bad(TeamEvent, { ...teamEvent, status: "live" });
  bad(TeamEvent, { ...teamEvent, title: undefined });
  ok(EventRow, eventRow);
  bad(EventRow, { ...eventRow, visibility: "secret" });
  ok(HostEvents, { drafts: [eventRow], upcoming: [], past: [] });
  bad(HostEvents, { drafts: [], upcoming: [] });
});

test("span: today, week and the weekend in India time", () => {
  const ist = (s: string) => Date.parse(`${s}+05:30`);
  const day = 86_400_000;
  const sat0 = ist("2026-12-05T00:00:00"), sun10 = ist("2026-12-06T10:00:00"), mon0 = ist("2026-12-07T00:00:00");
  // A Thursday: the weekend is Saturday and Sunday whole.
  assert.deepEqual(span("weekend", ist("2026-12-03T12:00:00")), [sat0, mon0]);
  // Saturday 00:00 exactly: from that moment to Monday 00:00.
  assert.deepEqual(span("weekend", sat0), [sat0, mon0]);
  // Sunday: what's left of it.
  assert.deepEqual(span("weekend", sun10), [sun10, mon0]);
  // Just before India's midnight it is still Friday, so the weekend is ahead.
  assert.deepEqual(span("weekend", sat0 - 1), [sat0, mon0]);
  assert.deepEqual(span("today", ist("2026-12-03T12:00:00")), [ist("2026-12-03T12:00:00"), ist("2026-12-04T00:00:00")]);
  assert.deepEqual(span("week", sun10), [sun10, sun10 + 7 * day]);
});
