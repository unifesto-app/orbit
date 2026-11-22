// The chat orb's disc, set in a glass ring beside the tab bar (owner, 19 Nov 2026: "a separate circle on right side",
// "the gradient should not be radial or straight", a reference AI button (a gradient disc in a dark ring), "orbit
// colors", "use the orbits from brand. like splash", "remove all the symbols, keep only orbits").
// - The gradient: a sweep round the centre (conic, never radial or linear) through the palette, with a narrow Stone
//   streak on the left, softened so the colours melt where they meet in the middle.
// - On it, the splash's three tilted, crossing rings (src/splash/motion.ts RINGS: radius, tilt, turn), in Stone, not the
//   splash's Sage, so they show on the green.
// SVG has no conic gradient, so the sweep is computed here; the rings are SVG on top.
// Also what the orb spreads over the screen when it opens the chat (src/app/chat.tsx): the same sweep, blurred, as a
// disc solid to SOLID of its radius and fading out by the rim (orb-field.png), and the chat's 55% Charcoal as the same
// soft disc (orb-shade.png). Scaled up from the orb they grow soft-edged floods; a sweep round its own centre looks the
// same at any scale, so only the edge moves.
// Run: node app/scripts/chat-orb.cjs (from the repo root). Writes mobile/assets/orb.png, @2x, @3x, and app/assets/orb-field.png, orb-shade.png.
/* global __dirname, Buffer */
const sharp = require('sharp');
const path = require('path');
const { palette: P } = require(path.join(__dirname, '..', '..', 'tokens', 'tokens.json'));

const PT = 44; // DISC in src/app/(tabs)/_layout.tsx
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// Degrees round the centre, clockwise from the right; the last stop meets the first, so there's no seam.
const SWEEP = [
  [0, P.moss],
  [70, P.sage],
  [130, P.moss],
  [168, P.sage],
  [180, P.stone],
  [192, P.sage],
  [240, P.moss],
  [290, P.forest],
  [335, P.forest],
  [360, P.moss],
].map(([at, hex]) => [at, rgb(hex)]);

function sweep(px) {
  const buf = Buffer.alloc(px * px * 3);
  const c = px / 2;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const deg = ((Math.atan2(y + 0.5 - c, x + 0.5 - c) * 180) / Math.PI + 360) % 360;
      const i = SWEEP.findIndex(([at]) => at > deg) - 1;
      const [[a0, ca], [a1, cb]] = [SWEEP[i], SWEEP[i + 1]];
      const f = (deg - a0) / (a1 - a0);
      for (let k = 0; k < 3; k++) buf[(y * px + x) * 3 + k] = Math.round(ca[k] + (cb[k] - ca[k]) * f);
    }
  }
  return sharp(buf, { raw: { width: px, height: px, channels: 3 } }).blur(px * 0.035);
}

// The splash's rings in a 100-unit disc, K units per ring radius, so the widest nearly meets the rim.
const RINGS = [
  { r: 0.62, tilt: 74, turn: -12, opacity: 0.5 },
  { r: 0.5, tilt: 58, turn: 24, opacity: 0.6 },
  { r: 0.78, tilt: 76, turn: -28, opacity: 0.4 },
];
const K = 58;

const rings = (px) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 100 100">
  <g fill="none" stroke="${P.stone}" stroke-width="1.5">${RINGS.map(
    (g) =>
      `<ellipse transform="translate(50 50) rotate(${g.turn})" rx="${g.r * K}" ry="${g.r * K * Math.cos((g.tilt * Math.PI) / 180)}" stroke-opacity="${g.opacity}"/>`,
  ).join('')}</g>
</svg>`;

const round = (px) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}"/></svg>`);

// A soft disc: `paint(i)` gives pixel i's colour, its alpha `alpha` out to SOLID of the radius, then easing to 0 at the
// rim. SOLID is SOLID in src/app/chat.tsx.
const SOLID = 0.8;
function softDisc(px, alpha, paint) {
  const buf = Buffer.alloc(px * px * 4);
  const c = px / 2;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = y * px + x;
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      const t = Math.min(1, Math.max(0, (1 - d) / (1 - SOLID)));
      const [r, g, b] = paint(i);
      buf.set([r, g, b, Math.round(255 * alpha * t * t * (3 - 2 * t))], i * 4);
    }
  }
  return sharp(buf, { raw: { width: px, height: px, channels: 4 } }).png();
}

(async () => {
  const FIELD = 640; // shown some 2,500pt across: it's blurred colour, so it holds up
  const colours = await sweep(FIELD).raw().toBuffer();
  await softDisc(FIELD, 1, (i) => colours.subarray(i * 3, i * 3 + 3)).toFile(path.join(__dirname, '..', 'assets', 'orb-field.png'));
  await softDisc(256, 0.55, () => rgb(P.charcoal)).toFile(path.join(__dirname, '..', 'assets', 'orb-shade.png'));
  console.log('assets: orb-field, orb-shade');
  for (const scale of [1, 2, 3]) {
    const px = PT * scale;
    const ground = await sweep(px).png().toBuffer();
    await sharp(ground)
      .ensureAlpha()
      .composite([{ input: Buffer.from(rings(px)) }, { input: round(px), blend: 'dest-in' }])
      .png()
      .toFile(path.join(__dirname, '..', '..', 'mobile', 'assets', `orb${scale > 1 ? `@${scale}x` : ''}.png`)); // shared with the host apps
  }
  console.log('assets: orb');
})();
