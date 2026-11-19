import { test } from "node:test";
import assert from "node:assert/strict";
import { adLive, adsFor, CONTENT, DEFAULT_CONTENT, isAppLink, isContentKey, nextChange, readContent } from "./content.ts";

const BEFORE_END = Date.parse("2026-11-20T09:00:00+05:30");
const AFTER_END = Date.parse("2026-12-01T00:00:00+05:30");

test("the defaults read, and reproduce the app before the CMS", () => {
  assert.deepEqual(readContent(DEFAULT_CONTENT), DEFAULT_CONTENT);
  assert.deepEqual(adsFor(DEFAULT_CONTENT.ads, "home", BEFORE_END).map((a) => a.kicker), ["Card offer", "Play"]);
  assert.deepEqual(adsFor(DEFAULT_CONTENT.ads, "search", BEFORE_END).map((a) => a.kicker), ["Play"]);
  assert.deepEqual(adsFor(DEFAULT_CONTENT.ads, "account", BEFORE_END).map((a) => a.kicker), ["Card offer"]);
  // The card offer says "till 30 Nov", and goes at midnight.
  assert.deepEqual(adsFor(DEFAULT_CONTENT.ads, "home", AFTER_END).map((a) => a.kicker), ["Play"]);
  assert.deepEqual(adsFor(DEFAULT_CONTENT.ads, "account", AFTER_END), []);
});

test("an ad shows from its start, up to (not at) its end", () => {
  const a = { starts: "2026-11-25T18:00:00+05:30", ends: "2026-11-25T21:00:00+05:30" };
  assert.equal(adLive(a, Date.parse("2026-11-25T17:59:59+05:30")), false);
  assert.equal(adLive(a, Date.parse("2026-11-25T18:00:00+05:30")), true);
  assert.equal(adLive(a, Date.parse("2026-11-25T20:59:59+05:30")), true);
  assert.equal(adLive(a, Date.parse("2026-11-25T21:00:00+05:30")), false);
  assert.equal(adLive({}, 0), true);
  const base = DEFAULT_CONTENT.ads[1]!;
  assert.equal(CONTENT.ads.safeParse([{ ...base, ...a }]).success, true);
  assert.equal(CONTENT.ads.safeParse([{ ...base, starts: a.ends, ends: a.starts }]).success, false);
  assert.equal(CONTENT.ads.safeParse([{ ...base, ends: "tomorrow" }]).success, false);
});

test("the next start or end after now is when a screen redraws", () => {
  const at = (s: string) => Date.parse(`2026-11-25T${s}:00+05:30`);
  const ads = [{ starts: "2026-11-25T18:00:00+05:30", ends: "2026-11-25T21:00:00+05:30" }, { ends: "2026-11-25T19:00:00+05:30" }, {}];
  assert.equal(nextChange([{}], at("12:00")), Infinity);
  assert.equal(nextChange(ads, at("12:00")), at("18:00"));
  assert.equal(nextChange(ads, at("18:00")), at("19:00")); // a start at exactly now has happened
  assert.equal(nextChange(ads, at("19:30")), at("21:00"));
  assert.equal(nextChange(ads, at("21:00")), Infinity);
});

test("Home shows two, the others one, in order", () => {
  const ad = (kicker: string) => ({ ...DEFAULT_CONTENT.ads[1]!, kicker, places: ["home", "search", "account"] as const });
  const ads = [ad("a"), ad("b"), ad("c")].map((x) => ({ ...x, places: [...x.places] }));
  assert.deepEqual(adsFor(ads, "home", 0).map((a) => a.kicker), ["a", "b"]);
  assert.deepEqual(adsFor(ads, "search", 0).map((a) => a.kicker), ["a"]);
});

test("a list that isn't a list falls back; unreadable items are left out one by one", () => {
  const got = readContent({ asks: ["Jams tonight"], help: "nope", ads: [{ kicker: "x" }, DEFAULT_CONTENT.ads[1]] });
  assert.deepEqual(got.asks, ["Jams tonight"]);
  assert.deepEqual(got.help, DEFAULT_CONTENT.help);
  assert.deepEqual(got.ads, [DEFAULT_CONTENT.ads[1]]);
  assert.deepEqual(readContent(null), DEFAULT_CONTENT);
  // Longer than this build allows (a later API raised the limit): the first ones, never the defaults.
  const ad = (n: number) => ({ ...DEFAULT_CONTENT.ads[1]!, kicker: `Ad ${n}` });
  assert.deepEqual(readContent({ ads: Array.from({ length: 11 }, (_, n) => ad(n)) }).ads.map((a) => a.kicker), Array.from({ length: 10 }, (_, n) => `Ad ${n}`));
  assert.equal(readContent({ asks: ["a", "b", "c", "d", "e", "f", "g"] }).asks.length, 6);
});

test("ads open only app screens", () => {
  for (const ok of ["/search", "/account/payment", "/event/open-mic-night", "/host/jam-circle"]) assert.ok(isAppLink(ok), ok);
  for (const bad of ["https://evil.test", "//evil.test", "/event/", "/event/a?x=1", "/account/delete", "/event/../login", "javascript:alert(1)", "constructor", "toString", "__proto__"])
    assert.ok(!isAppLink(bad), bad);
  assert.equal(CONTENT.ads.safeParse([{ ...DEFAULT_CONTENT.ads[0]!, href: "https://evil.test" }]).success, false);
  assert.ok(isContentKey("ads"));
  assert.ok(!isContentKey("constructor"));
});

test("an ad needs a place and words that fit a strip; no repeated questions or chips", () => {
  const base = DEFAULT_CONTENT.ads[0]!;
  assert.equal(CONTENT.ads.safeParse([{ ...base, places: [] }]).success, false);
  assert.equal(CONTENT.ads.safeParse([{ ...base, title: "x".repeat(25) }]).success, false);
  assert.equal(CONTENT.ads.safeParse([{ ...base, colour: "#ff0000" }]).success, false);
  assert.equal(CONTENT.asks.safeParse(["a\u0000b"]).success, false);
  assert.equal(CONTENT.asks.safeParse(["Jams tonight", "jams tonight "]).success, false);
  assert.equal(CONTENT.help.safeParse([DEFAULT_CONTENT.help[0], DEFAULT_CONTENT.help[0]]).success, false);
});
