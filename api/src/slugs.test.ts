import { test } from "node:test";
import assert from "node:assert/strict";
import { EventSlug, HostSlug } from "@orbit/contract";
import { slugFor } from "./slugs.ts";

test("a slug is the name's words and 6 random hex characters", () => {
  assert.match(slugFor("Punchline Collective"), /^punchline-collective-[0-9a-f]{6}$/);
  assert.notEqual(slugFor("Same"), slugFor("Same"));
});

test("accents drop to their letters", () => {
  assert.match(slugFor("Café Résumé Fête"), /^cafe-resume-fete-[0-9a-f]{6}$/);
});

test("a cut base never ends on a hyphen", () => {
  const name = `${"a".repeat(89)} bcd`; // the cut at 90 lands just after the hyphen
  const s = slugFor(name);
  assert.match(s, /^a{89}-[0-9a-f]{6}$/);
  assert.equal(HostSlug.safeParse(s).success, true);
});

test("a name with no Latin letters gets the fallback", () => {
  assert.match(slugFor("హైదరాబాద్"), /^host-[0-9a-f]{6}$/);
  assert.match(slugFor("हिन्दी", "event"), /^event-[0-9a-f]{6}$/);
  assert.match(slugFor("!!!", "event"), /^event-[0-9a-f]{6}$/);
});

test("results pass the contract's slug rules, even from long or odd names", () => {
  for (const name of ["Stand-up Night", "  --  ", "x".repeat(300), "A & B / C", "Ünïcödé"]) {
    assert.equal(HostSlug.safeParse(slugFor(name)).success, true, name);
    assert.equal(EventSlug.safeParse(slugFor(name, "event")).success, true, name);
  }
});
