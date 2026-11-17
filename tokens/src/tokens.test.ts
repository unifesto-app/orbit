import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { renderCss, renderJson } from "./css.ts";
import { contrast, palette, role } from "./index.ts";

const root = new URL("../", import.meta.url);

test("tokens.css and tokens.json match the source (run the build after a change)", () => {
  assert.equal(readFileSync(new URL("tokens.css", root), "utf8"), renderCss());
  assert.equal(readFileSync(new URL("tokens.json", root), "utf8"), renderJson());
});

test("text and accent stay readable on the ground", () => {
  assert.ok(contrast(role.text, role.ground) >= 4.5);
  assert.ok(contrast(role.accent, role.ground) >= 4.5);
  assert.ok(contrast(role.onAccent, role.accent) >= 4.5);
  assert.ok(contrast(palette.stone, palette.forest) >= 4.5);
});

test("moss stays a fill: it fails as text on the ground", () => {
  assert.ok(contrast(palette.moss, role.ground) < 3);
});

test("the ground is #rrggbb, since the app appends hex opacity to it", () => {
  assert.match(role.ground, /^#[0-9a-f]{6}$/i);
});

test("every --orbit-* the web and Galaxy use exists in tokens.css", () => {
  const defined = new Set([...renderCss().matchAll(/--orbit-[a-z0-9-]+(?=:)/g)].map((m) => m[0]));
  for (const dir of ["web/src", "galaxy/src"]) {
    const base = new URL(`../../${dir}/`, import.meta.url);
    for (const file of readdirSync(base, { recursive: true }) as string[]) {
      if (!/\.(css|tsx?)$/.test(file)) continue;
      for (const [name] of readFileSync(new URL(file, base), "utf8").matchAll(/--orbit-[a-z0-9-]+/g)) {
        assert.ok(defined.has(name), `${dir}/${file} uses ${name}, which tokens.css doesn't define`);
      }
    }
  }
});
