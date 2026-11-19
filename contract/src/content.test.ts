import { test } from "node:test";
import assert from "node:assert/strict";
import { adsFor, CONTENT, DEFAULT_CONTENT, isAppLink, isContentKey, liveAt, nextChange, promotedAt, readContent } from "./content.ts";
import { isStrip } from "./media.ts";

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
  assert.equal(liveAt(a, Date.parse("2026-11-25T17:59:59+05:30")), false);
  assert.equal(liveAt(a, Date.parse("2026-11-25T18:00:00+05:30")), true);
  assert.equal(liveAt(a, Date.parse("2026-11-25T20:59:59+05:30")), true);
  assert.equal(liveAt(a, Date.parse("2026-11-25T21:00:00+05:30")), false);
  assert.equal(liveAt({}, 0), true);
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

const IMG = "https://api.heyorbit.in/media/content/0b6f8c1e-2f4a-4b7e-9c1d-3a5e7f9b1c2d/AbCdEfGhIjKlMnOpQrStUv.webp";

test("an ad is words or an image; an image needs only its title", () => {
  const base = { title: "Card offer", colour: "forest", places: ["home"] };
  assert.equal(CONTENT.ads.safeParse([{ ...base, image: IMG }]).success, true);
  assert.equal(CONTENT.ads.safeParse([base]).success, false); // no words, no image
  assert.equal(CONTENT.ads.safeParse([{ ...base, image: "https://evil.test/x.webp" }]).success, false);
  assert.equal(CONTENT.ads.safeParse([{ ...base, image: IMG.replace("/content/", "/users/") }]).success, false);
});

test("a carousel slide is a pick or an image slide", () => {
  const ok = (s: object) => CONTENT.featured.safeParse([s]).success;
  assert.ok(ok({ kind: "pick", href: "/event/open-mic-night" }));
  assert.ok(ok({ kind: "pick", href: "/host/jam-circle", starts: "2026-11-25T18:00:00+05:30" }));
  assert.ok(!ok({ kind: "pick", href: "/search" })); // a pick is a page with its own picture
  assert.ok(!ok({ kind: "pick" }));
  assert.ok(ok({ kind: "image", image: IMG, edge: "#1d372a", label: "Ten per cent off with cards" }));
  assert.ok(ok({ kind: "image", image: IMG, edge: "#1d372a", label: "Offer", action: "See offer", href: "/account/payment" }));
  assert.ok(!ok({ kind: "image", image: IMG, label: "No edge" }));
  assert.ok(!ok({ kind: "image", image: IMG, edge: "red", label: "Bad edge" }));
  assert.ok(!ok({ kind: "image", image: IMG, edge: "#1d372a", label: "Out", href: "https://evil.test" }));
  assert.equal(CONTENT.featured.safeParse(Array.from({ length: 7 }, () => ({ kind: "pick", href: "/event/a" }))).success, false);
});

test("promoted events: by link, once each, live by their times", () => {
  assert.equal(CONTENT.promoted.safeParse([{ href: "/host/jam-circle" }]).success, false);
  assert.equal(CONTENT.promoted.safeParse([{ href: "/event/a" }, { href: "/event/a" }]).success, false);
  const now = Date.parse("2026-11-25T12:00:00+05:30");
  const ids = promotedAt([{ href: "/event/a" }, { href: "/event/b", ends: "2026-11-25T11:00:00+05:30" }, { href: "/event/c", starts: "2026-11-26T00:00:00+05:30" }], now);
  assert.deepEqual([...ids], ["a"]);
  assert.deepEqual([...promotedAt(DEFAULT_CONTENT.promoted, now)], ["build-anything-hackathon", "reel-society-screening"]);
  assert.deepEqual(DEFAULT_CONTENT.featured, []);
});

test("an ad strip image is 4.5:1, nothing else", () => {
  assert.ok(isStrip(1350, 300));
  assert.ok(isStrip(900, 200));
  assert.ok(!isStrip(1200, 300));
  assert.ok(!isStrip(1200, 900));
  assert.ok(!isStrip(0, 0));
});
