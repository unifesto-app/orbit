import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceOf, sourceOf } from "./prelaunch.ts";

const IG = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 Instagram 300.0.0.1.1 Android";
const LI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [LinkedInApp]/9.32.5491";
const X = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Twitter for iPhone/12.42.1";
const CH = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const SF = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

test("deviceOf names the app and system", () => {
  assert.deepEqual(deviceOf(IG), { app: "Instagram", os: "Android" });
  assert.deepEqual(deviceOf(LI), { app: "LinkedIn", os: "iPhone" });
  assert.deepEqual(deviceOf(X), { app: "X", os: "iPhone" });
  assert.deepEqual(deviceOf(CH), { app: "Chrome", os: "Windows" });
  assert.deepEqual(deviceOf(SF), { app: "Safari", os: "iPhone" });
  assert.deepEqual(deviceOf(null), { app: null, os: null });
});

test("sourceOf prefers utm_source, then the referrer, then the in-app browser", () => {
  const s = (r: Parameters<typeof sourceOf>[0]) => sourceOf(r);
  assert.equal(s({ utm: { utm_source: "ig" } }), "Instagram");
  assert.equal(s({ utm: { utm_source: "waitlist" } }), "Shared by a member");
  assert.equal(s({ utm: { utm_source: "NewsLetter" } }), "newsletter");
  assert.equal(s({ referrer: "https://l.instagram.com/?u=x" }), "Instagram");
  assert.equal(s({ referrer: "https://t.co/" }), "X");
  assert.equal(s({ referrer: "android-app://com.linkedin.android/" }), "LinkedIn");
  assert.equal(s({ referrer: "com.linkedin.android" }), "Direct"); // a bare host is not a URL: falls through, no throw
  assert.equal(s({ referrer: "http://heyorbit.in/", userAgent: IG }), "Instagram");
  assert.equal(s({ referrer: "http://heyorbit.in/", userAgent: CH }), "Direct");
  assert.equal(s({ referrer: "not a url", userAgent: CH }), "Direct");
  assert.equal(s({ referrer: "https://google.evil.com/" }), "google.evil.com");
  assert.equal(s({ referrer: "https://google.com.evil.org/" }), "google.com.evil.org");
  assert.equal(s({ referrer: "https://www.google.co.in/" }), "Google");
  assert.equal(s({ utm: { utm_source: "google" } }), "Google");
  assert.equal(s({ referrer: "android-app://com.whatsapp/" }), "WhatsApp");
  assert.equal(s({ referrer: "https://galaxy.heyorbit.in/", userAgent: CH }), "Direct");
  assert.equal(s({ referrer: "https://www.heyorbit.in/" }), "Direct");
  assert.equal(s({ referrer: "https://max.com/" }), "max.com");
});
