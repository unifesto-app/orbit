// The app icons (owner, 16 Nov 2026: "add app logo"; 19 Nov 2026: "build new app icons"), in the brand kit's look
// (https://claude.ai/artifact/R9S2HUVQ9q4PAHC9YPPBQ2, drawn inline in web/src/app/brand.tsx): the 3D ORBIT, the symbols
// on tilted, crossing orbits, the green palette from @orbit/tokens, Charcoal ground. The lockup never moves: ORBIT
// alone, centred, 640 wide; only the theme round it changes. The main icon, then the alternates picked in
// Account > Appearance (ALT below; the names are app.json's expo-alternate-app-icons entry and appearance.tsx's ICONS).
// Run: node app/scripts/app-icon.cjs [outDir] (from the repo root; outDir defaults to app/assets), then prebuild and rebuild.
/* global __dirname, Buffer */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'app', 'assets');
const { palette: P, depth, glass } = require(path.join(root, 'tokens', 'tokens.json'));

// ORBIT's letters in their own units (brand.tsx's Wordmark): x 36 to 5407, baseline 0, cap height 682.
const LETTERS = [
  [0, 'M855 0C1052 0 1185 -149 1185 -341C1185 -536 1054 -682 855 -682H365C167 -682 36 -539 36 -341C36 -148 170 0 365 0ZM786 -300C786 -164 750 -118 668 -118H532C456 -118 422 -165 422 -300V-409C422 -530 453 -565 532 -565H668C755 -565 786 -532 786 -409Z'],
  [1266, 'M1236 0C1248 0 1254 -8 1254 -16C1254 -21 1252 -28 1247 -32L971 -315C1078 -331 1166 -395 1166 -508C1166 -611 1075 -682 954 -682H80C62 -682 53 -673 53 -656V-27C53 -9 62 0 80 0H423C441 0 450 -9 450 -27V-565H673C736 -565 768 -541 768 -498C768 -455 736 -430 673 -430H536C518 -430 510 -421 510 -404V-373C510 -355 516 -347 527 -336L828 -27C846 -8 869 0 894 0Z'],
  [2575, 'M913 0C1083 0 1157 -104 1157 -205C1157 -305 1093 -368 1050 -382C1078 -396 1129 -427 1129 -510C1129 -617 1062 -682 930 -682H62C45 -682 36 -673 36 -656V-27C36 -9 45 0 62 0ZM656 -313C731 -313 763 -282 763 -217C763 -153 731 -118 656 -118H421V-565H673C739 -565 760 -538 760 -498C760 -458 739 -430 673 -430H510C493 -430 484 -421 484 -404V-339C484 -322 493 -313 510 -313Z'],
  [3820, 'M429 0C446 0 455 -9 455 -27V-656C455 -673 446 -682 429 -682H84C67 -682 58 -673 58 -656V-27C58 -9 67 0 84 0Z'],
  [4379, 'M698 0C710 0 716 -4 716 -13V-565H1009C1022 -565 1028 -568 1028 -576V-669C1028 -678 1022 -682 1009 -682H28C15 -682 9 -678 9 -669V-576C9 -568 15 -565 28 -565H320V-13C320 -4 326 0 339 0Z'],
];
// The symbols, each centred on 0, 0 at the kit's size (brand.tsx): pearl, five-point star, four-point spark, heart.
const HEART = 'M 500 553 C 455 523, 440 493, 448 473 C 456 451, 486 446, 500 468 C 514 446, 544 451, 552 473 C 560 493, 545 523, 500 553 Z';
const spark = (r) => {
  const c = r * 0.2;
  return `M 0 ${-r} C ${c} ${-c}, ${c} ${-c}, ${r} 0 C ${c} ${c}, ${c} ${c}, 0 ${r} C ${-c} ${c}, ${-c} ${c}, ${-r} 0 C ${-c} ${-c}, ${-c} ${-c}, 0 ${-r} Z`;
};
const SYM = {
  pearl: '<circle r="15"/>',
  star: '<path transform="translate(-211.7 -295.1)" d="M 211.7 275.4 L 216.8 288.1 L 230.4 289.0 L 220.0 297.8 L 223.3 311.0 L 211.7 303.8 L 200.2 311.0 L 203.5 297.8 L 193.0 289.0 L 206.6 288.1 Z"/>',
  spark: `<path d="${spark(19.7)}"/>`,
  heart: `<path transform="translate(-500 -503)" d="${HEART}"/>`,
};

// The 3D look (brand.tsx's Shade): a body lit from the top-left, a raw gloss (never smoothed), a soft Night shadow.
// The numbers are in the drawing's own units, so the gloss and shadow scale with whatever they shade.
const shade = (id, bevel, drop, blur = drop) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="220%" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceAlpha" stdDeviation="${bevel}" result="height"/>
  <feSpecularLighting in="height" surfaceScale="8" specularConstant="1.2" specularExponent="26" lighting-color="${P.stone}" result="spec">
    <feDistantLight azimuth="${depth.light.azimuth}" elevation="${depth.light.elevation}"/>
  </feSpecularLighting>
  <feComposite in="spec" in2="SourceAlpha" operator="in" result="gloss"/>
  <feOffset in="SourceAlpha" dy="${drop}" result="drop"/>
  <feGaussianBlur in="drop" stdDeviation="${blur}" result="dropBlur"/>
  <feFlood flood-color="${P.night}" flood-opacity="${depth.shadowOpacity}" result="ink"/>
  <feComposite in="ink" in2="dropBlur" operator="in" result="shadow"/>
  <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/><feMergeNode in="gloss"/></feMerge>
</filter>`;
const ramp = (id, stops, r) =>
  `<radialGradient id="${id}" cx="0.36" cy="0.3" r="${r}">${stops.map(([at, c]) => `<stop offset="${at}" stop-color="${c}"/>`).join('')}</radialGradient>`;
const DEFS =
  ramp('wmBody', depth.wordmark, 0.85) +
  ramp('body', depth.symbol, 0.8) +
  shade('wm3d', 42, 67.2, 58.8) + // the kit's wordmark: 5 px gloss, 8 px drop, 7 px blur at 640 wide
  shade('sym3d', 3.4, 5, 4.2) +
  shade('heart3d', 8, 12, 10);

// ORBIT `w` wide centred on (cx, cy): the kit's 3D, or flat in `fill`.
function word(w, fill, cx = 512, cy = 512) {
  const k = w / 5371;
  const paint = fill ? `fill="${fill}"` : 'fill="url(#wmBody)" filter="url(#wm3d)"';
  return `<g transform="translate(${cx - w / 2} ${cy + (682 * k) / 2}) scale(${k}) translate(-36 0)" ${paint}>${LETTERS.map(([dx, d]) => `<path transform="translate(${dx} 0)" d="${d}"/>`).join('')}</g>`;
}
// A symbol at (x, y), `s` times its kit size, turned `turn` degrees inside the filter so the light stays top-left.
const sym = (name, x, y, s, turn = 0, opacity = 1, filter = 'sym3d') =>
  `<g transform="translate(${x} ${y}) scale(${s})" opacity="${opacity}"><g filter="url(#${filter})" fill="url(#body)"><g transform="rotate(${turn})">${SYM[name]}</g></g></g>`;
// A point on an orbit: angle t round an ellipse (rx, ry) centred on the icon, turned `tilt` degrees.
function on([rx, ry, tilt], t) {
  const [a, b] = [(t * Math.PI) / 180, (tilt * Math.PI) / 180];
  const [x, y] = [rx * Math.cos(a), ry * Math.sin(a)];
  return [512 + x * Math.cos(b) - y * Math.sin(b), 512 + x * Math.sin(b) + y * Math.cos(b)];
}
const ring = ([rx, ry, tilt], width, opacity) =>
  `<ellipse cx="512" cy="512" rx="${rx}" ry="${ry}" transform="rotate(${tilt} 512 512)" fill="none" stroke="${P.sage}" stroke-opacity="${opacity}" stroke-width="${width}"/>`;

const svg = (body, defs = '') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs>${DEFS}${defs}</defs>${body}</svg>`);
const GROUND = `<rect width="1024" height="1024" fill="${P.charcoal}"/>`;
// The art shrunk about the centre: Android's launcher shows only the middle of an adaptive icon (a circle of radius
// 313 at 1024 on the roundest mask), so each icon names the scale that keeps what matters inside it.
const at = (s, art) => `<g transform="translate(512 512) scale(${s}) translate(-512 -512)">${art}</g>`;

// Avatar B, the heart in orbit the owner picked for Instagram, X and WhatsApp (18 Nov 2026): avatar-b.svg is the
// drawing from its canvas (https://claude.ai/artifact/TgXAHpk1bicRE6GMdCjRjh), 1080 square.
function avatar() {
  const inner = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(fs.readFileSync(path.join(__dirname, 'avatar-b.svg'), 'utf8'))[1];
  return `<g transform="scale(${1024 / 1080})">${inner.replace(/<rect width="1080" height="1080"[^>]*><\/rect>/, '')}</g>`;
}

// The alternates. Each is a full-bleed `ground`, the `art` on it (with any `defs` it needs) and `android`, its scale
// on Android. Ticket and Hologram keep the names shipped 16 Nov.
const IN_ORBIT = [
  [470, 128, -14],
  [410, 178, 22],
];
const ALT = {
  // The lockup with the splash's last frame round it: two tilted, crossing orbits behind the letters, the pearl, spark,
  // star and a small heart riding them, in front of the word on the near side and dimmer behind it on the far side.
  InOrbit: {
    ground: GROUND,
    art: () => {
      const [a, b] = IN_ORBIT;
      const far = sym('star', ...on(a, 200), 1.5, 30, 0.65) + sym('heart', ...on(b, 255), 0.62, -20, 0.65);
      const near = sym('pearl', ...on(a, 35), 1.9) + sym('spark', ...on(b, 100), 2, -15);
      return ring(a, 8, 0.5) + ring(b, 8, 0.42) + far + word(640) + near;
    },
    android: 0.66,
  },
  // The owner's social mark as the icon. It leaves the lockup rule: the heart instead of the word.
  Heart: { ground: GROUND, art: avatar, android: 0.62 },
  // The lockup on a glass pill, the app's buttons, frosting the symbols behind it.
  Glass: {
    ground: GROUND,
    defs: `<clipPath id="pane"><rect x="112" y="402" width="800" height="220" rx="110"/></clipPath>
      <filter id="frost" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="30"/></filter>
      <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.stone}" stop-opacity=".1"/><stop offset=".45" stop-color="${P.stone}" stop-opacity="0"/></linearGradient>
      <linearGradient id="tint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.charcoal}" stop-opacity=".3"/><stop offset="1" stop-color="${P.charcoal}" stop-opacity=".5"/></linearGradient>`,
    art: () => {
      const behind = sym('heart', 700, 380, 2.9, 12, 1, 'heart3d') + sym('pearl', 310, 650, 5.2) + sym('spark', 250, 300, 3.6, -17);
      return `${behind}<g clip-path="url(#pane)"><rect width="1024" height="1024" fill="${P.charcoal}"/><g filter="url(#frost)">${behind}</g>
        <rect width="1024" height="1024" fill="url(#tint)"/><rect x="112" y="402" width="800" height="220" fill="url(#sheen)"/></g>
        <rect x="113.5" y="403.5" width="797" height="217" rx="108.5" fill="none" stroke="${glass.border}" stroke-width="3"/>${word(640)}`;
    },
    android: 0.7,
  },
  // The 16 Nov Ticket in the kit's look: a 3D ticket in the symbols' body over a Sage glow, ORBIT printed on it.
  Ticket: {
    ground: `${GROUND}<rect width="1024" height="1024" fill="url(#glow)"/>`, // full bleed, so Android doesn't shrink it
    defs: `<radialGradient id="glow" cx="0.5" cy="1" r="0.9"><stop offset="0" stop-color="${P.sage}" stop-opacity=".42"/><stop offset="1" stop-color="${P.sage}" stop-opacity="0"/></radialGradient>
      ${ramp('ticket', depth.symbol, 0.95)}${shade('ticket3d', 14, 22, 20)}
      <mask id="cut"><rect width="1024" height="1024" fill="#fff"/><circle cx="222" cy="540" r="44" fill="#000"/><circle cx="802" cy="540" r="44" fill="#000"/><circle cx="640" cy="330" r="26" fill="#000"/><circle cx="640" cy="750" r="26" fill="#000"/></mask>`,
    art: () => `<g transform="rotate(-14 512 540)">
      <g filter="url(#ticket3d)"><rect x="222" y="330" width="580" height="420" rx="36" fill="url(#ticket)" mask="url(#cut)"/></g>
      <line x1="640" y1="380" x2="640" y2="700" stroke="${P.charcoal}" stroke-opacity=".45" stroke-width="8" stroke-dasharray="4 22" stroke-linecap="round"/>
      <g fill="${P.charcoal}" opacity=".5"><rect x="290" y="640" width="140" height="14" rx="7"/><rect x="290" y="670" width="90" height="14" rx="7"/></g>
      <g fill="${P.stone}" opacity=".7"><rect x="680" y="410" width="80" height="12" rx="6"/><rect x="680" y="440" width="56" height="12" rx="6"/><rect x="680" y="640" width="80" height="12" rx="6"/></g>
      ${word(300, P.charcoal, 430, 470)}</g>`,
    android: 0.72,
  },
  // Unchanged from 16 Nov: the lockup in Charcoal on pastel holographic foil with a diagonal sheen.
  Hologram: {
    ground: `<rect width="1024" height="1024" fill="url(#h)"/><rect width="1024" height="1024" fill="url(#holoSheen)"/>`,
    defs: `<linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFDEEB"/><stop offset=".25" stop-color="#C5F6FA"/><stop offset=".5" stop-color="#E5DBFF"/><stop offset=".75" stop-color="#FFF3BF"/><stop offset="1" stop-color="#D0EBFF"/></linearGradient>
      <linearGradient id="holoSheen" x1="0" y1="1" x2="1" y2="0"><stop offset=".35" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".6"/><stop offset=".65" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`,
    art: () => word(640, P.charcoal),
    android: 0.93,
  },
};

const png = (s) => sharp(s).png();
// iOS: opaque and full bleed (iOS rounds the corners). Plus the 40pt preview Appearance shows beside each name (@3x).
async function ios(s, file, thumb) {
  const flat = await png(s).flatten({ background: P.charcoal }).removeAlpha().toBuffer();
  await sharp(flat).toFile(file);
  await sharp(flat).resize(120).png().toFile(thumb);
}
(async () => {
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  await ios(svg(GROUND + word(640)), path.join(out, 'icon.png'), path.join(out, 'icons', 'orbit-thumb.png'));
  // Android adaptive: the lockup inside the middle the launcher shows, on a Charcoal layer.
  await png(svg(word(600))).resize(512).toFile(path.join(out, 'android-icon-foreground.png'));
  await sharp({ create: { width: 512, height: 512, channels: 3, background: P.charcoal } }).png().toFile(path.join(out, 'android-icon-background.png'));
  // Android 13 themed icons: one flat colour, which the launcher tints.
  await png(svg(word(592, '#ffffff'))).resize(432).toFile(path.join(out, 'android-icon-monochrome.png'));
  console.log('ok: icon.png, android-icon-foreground.png, android-icon-background.png, android-icon-monochrome.png');

  for (const [name, { ground, art, defs = '', android }] of Object.entries(ALT)) {
    const file = path.join(out, 'icons', name.toLowerCase());
    await ios(svg(ground + art(), defs), `${file}.png`, `${file}-thumb.png`);
    await png(svg(ground + at(android, art()), defs)).toFile(`${file}-android.png`);
    console.log(`ok: icons/${name.toLowerCase()}.png, -android.png, -thumb.png`);
  }
})();
