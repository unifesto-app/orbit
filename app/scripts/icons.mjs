// Regenerates src/icons.tsx from Phosphor's duotone icons (MIT) via the Iconify API.
// Same source and icon keys as web/scripts/icons.mjs (plus the app's own), drawn with react-native-svg.
// To add an icon: add `name: "phosphor-name-duotone"` below, then run `node app/scripts/icons.mjs`.
// It also renders the tab bar's icons to PNGs in assets/tabs (the native tab bar takes images, not SVG), which needs
// rsvg-convert (`brew install librsvg`).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const icons = {
  pin: "map-pin-duotone",
  search: "magnifying-glass-duotone",
  user: "user-duotone",
  caretDown: "caret-down-duotone",
  repeat: "repeat-duotone",
  code: "code-duotone",
  comedy: "microphone-stage-duotone",
  music: "music-notes-duotone",
  group: "users-three-duotone",
  workshop: "chalkboard-teacher-duotone",
  fest: "confetti-duotone",
  sports: "soccer-ball-duotone",
  theatre: "mask-happy-duotone",
  art: "palette-duotone",
  film: "film-slate-duotone",
  startup: "rocket-launch-duotone",
  gaming: "game-controller-duotone",
  heart: "heart-duotone", // "Loved it" on an event you went to (owner, 19 Nov 2026: "replace the love with loved it")
  heartFill: "heart-fill", // loved, in the love red
  star: "star-duotone", // Save (owner, 19 Nov 2026: "saved love with star")
  starFill: "star-fill", // saved
  back: "arrow-left-duotone", // same key as web/scripts/icons.mjs
  verified: "seal-check-fill", // filled, not duotone (owner, 15 Nov 2026: "use filled verifed")
  apple: "apple-logo-fill", // Continue with Apple on the sign-in sheet, white, as Apple's own button draws it
  close: "x-bold", // the plain X in bold, in every modal (owner, 15 Nov 2026: "use x ( fill ) in all modals", then "x use normal bold")
  more: "dots-three-outline-duotone", // outlined dots with a faint fill, like the heart beside them
  share: "export-duotone", // the ⋯ menu's items: share, copy link, add to calendar, report
  link: "link-duotone",
  calendar: "calendar-plus-duotone",
  report: "flag-duotone",
  copy: "copy-duotone", // the venue sheet's copy, and its tick once copied
  check: "check-duotone",
  chevron: "caret-right-bold", // the ">" on the event page's tappable facts
  chevronDown: "caret-down-bold", // an open list in Account › Saved
  external: "arrow-up-right-bold", // a row that opens the web, in place of the > (owner, 19 Nov 2026)
  // Account's rows, each in its own colour (owner, 15 Nov 2026: "add icon on left", "should have various acents").
  ticket: "ticket-duotone",
  following: "user-check-duotone",
  history: "clock-counter-clockwise-duotone",
  receipt: "receipt-duotone",
  refund: "arrow-u-up-left-duotone",
  card: "credit-card-duotone",
  // Account › Payment methods, a kind of payment each (owner, 19 Nov 2026).
  upi: "device-mobile-duotone",
  vpa: "at-duotone",
  wallet: "wallet-duotone",
  bank: "bank-duotone",
  bell: "bell-duotone",
  moon: "moon-duotone",
  shield: "shield-check-duotone",
  key: "key-duotone",
  trash: "trash-duotone",
  megaphone: "megaphone-duotone",
  help: "question-duotone",
  terms: "file-text-duotone",
  privacy: "lock-duotone",
  interests: "sparkle-duotone", // Account › Interests: the brand's spark (owner, 19 Nov 2026)
  // Saved lists (Saved doc, 16 Nov 2026): the ⋯ menus’ Add to a list, Rename list and Take out of a list.
  list: "list-star-duotone", // a list in Account › Saved, starred like a save
  listPlus: "list-plus-duotone",
  rename: "pencil-simple-duotone",
  takeOut: "minus-circle-duotone",
  send: "arrow-up-bold", // the chat's send button (owner, 19 Nov 2026: "add chat interface")
  plus: "plus-bold", // the chat's attach button (owner, 19 Nov 2026: "add attachments")
  mic: "microphone-duotone", // the chat's voice button (owner, 19 Nov 2026: "also bring voice chat")
  info: "info-duotone", // the chat header's (i) (owner, 19 Nov 2026: "also add info ( i ) to right on header")
  // The inbox (owner, 25 Nov 2026: "in notifications, instead of name, use icon"): Settings as a gear, and a reminder's
  // alarm beside its kind.
  gear: "gear-duotone",
  alarm: "alarm-duotone",
};

// The tab bar's icons, Phosphor filled since our own bar (owner, 15 Nov 2026: "Phosphor duotone even in tab bar"; 19 Nov
// 2026: "use filled instead of duotone").
const tabIcons = {
  home: "house-fill",
  search: "magnifying-glass-fill",
};
const TAB_PT = 25; // Apple's size for a tab bar icon; Android's is 24dp

// The chat's reactions (src/app/chat.tsx; owner, 19 Nov 2026: "in reaction bring 3d symbols", "instead of star, plus,
// peral bring thumbsup and any two useful ones", then "make heart straight and give them original colors"): Phosphor's
// filled glyphs in the brand's 3D look, each in its own colours, rendered to assets/reactions/<key>.png below. Each
// ramp runs from the lit top left to the shaded rim.
const reactionIcons = {
  heart: ["heart-fill", [[0, "#ffb3ad"], [0.42, "#ff453a"], [0.8, "#d1281f"], [1, "#8f140e"]]], // the app's love red
  thumbsUp: ["thumbs-up-fill", [[0, "#fff1b8"], [0.42, "#ffc83d"], [0.8, "#e59e0b"], [1, "#a86a00"]]],
  thumbsDown: ["thumbs-down-fill", [[0, "#fff1b8"], [0.42, "#ffc83d"], [0.8, "#e59e0b"], [1, "#a86a00"]]], // an answer missed
  fire: ["fire-fill", [[0, "#ffe08a"], [0.4, "#ff9a1f"], [0.78, "#f2541b"], [1, "#b8300c"]]], // something to be excited about
};

const names = [...new Set([...Object.values(icons), ...Object.values(tabIcons), ...Object.values(reactionIcons).map(([n]) => n)])];
const res = await fetch(`https://api.iconify.design/ph.json?icons=${names.join(",")}`);
if (!res.ok) throw new Error(`Iconify answered ${res.status}`);
const data = await res.json();
if (data.not_found) throw new Error(`Not in Phosphor: ${data.not_found.join(", ")}`);

// Every Phosphor duotone icon is a 20% tint path under a solid path, and a filled or bold one is a single path (its
// tint left null); refuse anything else.
const shape = /^<g fill="currentColor"><path d="([^"]+)" opacity="\.2"\/><path d="([^"]+)"\/><\/g>$/;
const filled = /^<path fill="currentColor" d="([^"]+)"\/>$/;
const entries = Object.entries(icons).map(([key, name]) => {
  const body = data.icons[name]?.body;
  const fill = /-(fill|bold)$/.test(name) && body?.match(filled);
  if (fill) return `  // ${name}\n  ${key}: [null, ${JSON.stringify(fill[1])}],`;
  const m = body?.match(shape);
  if (!m) throw new Error(`Missing or unexpected markup for ${name}`);
  return `  // ${name}\n  ${key}: [\n    ${JSON.stringify(m[1])},\n    ${JSON.stringify(m[2])},\n  ],`;
});

writeFileSync(
  new URL("../src/icons.tsx", import.meta.url),
  `// Generated by app/scripts/icons.mjs. Do not edit by hand.
// Phosphor Icons, duotone weight (https://phosphoricons.com), MIT licence.
// Each icon is [20% tint layer, solid layer]; a filled icon's tint is null.
import Svg, { Path } from 'react-native-svg';

const paths = {
${entries.join("\n")}
} as const;

export type IconName = keyof typeof paths;

// Duotone on Phosphor's 256 x 256 grid; both layers take \`color\`.
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string }) {
  const [tint, solid] = paths[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" fill={color} accessible={false}>
      {tint && <Path d={tint} opacity={0.2} />}
      <Path d={solid} />
    </Svg>
  );
}
`,
);
console.log(`icons.tsx: ${Object.keys(icons).join(", ")}`);

// At 1x, 2x and 3x (owner, 19 Nov 2026: "add gradiant to icons", then "move other gradiant to active, for other use
// text color"): <key> black on clear, tinted the text colour by the bar, for the tabs that aren't open; <key>-on for the
// open tab, Sage to Moss lit from the top left like the symbols, with no light spot.
const { palette: P, depth } = JSON.parse(readFileSync(new URL("../../tokens/tokens.json", import.meta.url), "utf8"));
const lit = `<defs><radialGradient id="g" cx="0.36" cy="0.3" r="0.8"><stop offset="0" stop-color="${P.sage}"/><stop offset="1" stop-color="${P.moss}"/></radialGradient></defs>`;
for (const [key, name] of Object.entries(tabIcons)) {
  const [, d] = data.icons[name].body.match(filled);
  for (const [file, defs, paint] of [[key, "", "#000"], [`${key}-on`, lit, "url(#g)"]]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${defs}<path fill="${paint}" d="${d}"/></svg>`;
    for (const scale of [1, 2, 3]) {
      const out = new URL(`../assets/tabs/${file}${scale > 1 ? `@${scale}x` : ""}.png`, import.meta.url);
      const px = String(TAB_PT * scale);
      execFileSync("rsvg-convert", ["-w", px, "-h", px, "-o", out.pathname], { input: svg });
    }
  }
}
console.log(`assets/tabs: ${Object.keys(tabIcons).map((k) => `${k}, ${k}-on`).join(", ")}`);

// The reactions, 192px squares: each its own body lit from the top left, a raw gloss and a soft Night shadow below, as
// the kit's Shade (app-icon.cjs), its numbers in the glyph's 256 grid. The glyph fills the middle 62%, leaving room for
// the shadow, like the splash's symbol PNGs.
const REACTION_PX = 192;
const body = (stops) =>
  `<radialGradient id="b" cx="0.36" cy="0.3" r="0.8">${stops.map(([at, c]) => `<stop offset="${at}" stop-color="${c}"/>`).join("")}</radialGradient>`;
const shade = `<filter id="s" x="-30%" y="-30%" width="160%" height="170%" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="height"/>
  <feSpecularLighting in="height" surfaceScale="8" specularConstant="1.2" specularExponent="26" lighting-color="${P.stone}" result="spec">
    <feDistantLight azimuth="${depth.light.azimuth}" elevation="${depth.light.elevation}"/>
  </feSpecularLighting>
  <feComposite in="spec" in2="SourceAlpha" operator="in" result="gloss"/>
  <feOffset in="SourceAlpha" dy="16" result="drop"/>
  <feGaussianBlur in="drop" stdDeviation="14" result="dropBlur"/>
  <feFlood flood-color="${P.night}" flood-opacity="${depth.shadowOpacity}" result="ink"/>
  <feComposite in="ink" in2="dropBlur" operator="in" result="shadow"/>
  <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/><feMergeNode in="gloss"/></feMerge>
</filter>`;
for (const [key, [name, stops]] of Object.entries(reactionIcons)) {
  const [, d] = data.icons[name].body.match(filled);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-78 -70 412 412"><defs>${body(stops)}${shade}</defs><path fill="url(#b)" filter="url(#s)" d="${d}"/></svg>`;
  const out = new URL(`../assets/reactions/${key}.png`, import.meta.url);
  execFileSync("rsvg-convert", ["-w", String(REACTION_PX), "-h", String(REACTION_PX), "-o", out.pathname], { input: svg });
}
console.log(`assets/reactions: ${Object.keys(reactionIcons).join(", ")}`);
