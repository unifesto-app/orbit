// Orbit Station's tab bar icons and marks as PNGs, as the Orbit app's (app/scripts/icons.mjs): Phosphor filled (MIT) via
// the Iconify API, at 1x, 2x and 3x, so the app needs no SVG library. <key> is black on clear, tinted the text colour
// where it's used; <key>-on is the open tab's, Sage to Moss lit from the top left. The scan mark is Station's own (owner,
// 22 Nov 2026: "scan is good"). Run: node host/scripts/icons.mjs (needs rsvg-convert: brew install librsvg).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tabs = { today: "calendar-dot-fill", money: "currency-inr-fill", venue: "storefront-fill" };
const marks = { close: "x-bold", find: "magnifying-glass-bold", sound: "speaker-high-fill", mute: "speaker-slash-fill" }; // the scanner's too
const PT = 25; // the app's TAB_PT

const res = await fetch(`https://api.iconify.design/ph.json?icons=${[...Object.values(tabs), ...Object.values(marks)].join(",")}`);
if (!res.ok) throw new Error(`Iconify answered ${res.status}`);
const data = await res.json();
if (data.not_found) throw new Error(`Not in Phosphor: ${data.not_found.join(", ")}`);
const path = (name) => data.icons[name].body.match(/^<path fill="currentColor" d="([^"]+)"\/>$/)[1];

const { palette: P } = JSON.parse(readFileSync(new URL("../../tokens/tokens.json", import.meta.url), "utf8"));
const lit = `<defs><radialGradient id="g" cx="0.36" cy="0.3" r="0.8"><stop offset="0" stop-color="${P.sage}"/><stop offset="1" stop-color="${P.moss}"/></radialGradient></defs>`;
const svgs = {};
for (const [key, name] of Object.entries(tabs)) {
  svgs[key] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#000" d="${path(name)}"/></svg>`;
  svgs[`${key}-on`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${lit}<path fill="url(#g)" d="${path(name)}"/></svg>`;
}
for (const [key, name] of Object.entries(marks)) svgs[key] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><path fill="#000" d="${path(name)}"/></svg>`;
svgs.scan = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/><path d="M7.5 12h9"/></svg>`;

// A blocked half hour on Today's bars: Stone stripes, baked in (not tinted), tiled across the cell (take 1's hatch).
const hatch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="${P.stone}" fill-opacity=".08"/><path d="M-1 1l2-2M0 4l4-4M3 5l2-2" stroke="${P.stone}" stroke-opacity=".42" stroke-width="1.06"/></svg>`;
for (const scale of [1, 2, 3]) {
  const out = new URL(`../assets/tabs/hatch${scale > 1 ? `@${scale}x` : ""}.png`, import.meta.url);
  execFileSync("rsvg-convert", ["-w", String(4 * scale), "-h", String(4 * scale), "-o", out.pathname], { input: hatch });
}
for (const [file, svg] of Object.entries(svgs)) {
  for (const scale of [1, 2, 3]) {
    const out = new URL(`../assets/tabs/${file}${scale > 1 ? `@${scale}x` : ""}.png`, import.meta.url);
    execFileSync("rsvg-convert", ["-w", String(PT * scale), "-h", String(PT * scale), "-o", out.pathname], { input: svg });
  }
}
console.log(`assets/tabs: ${Object.keys(svgs).join(", ")}`);
