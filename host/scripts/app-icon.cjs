// The host apps' icons (owner, 21 Nov 2026): small ORBIT and the app's name big, all caps in Sofachrome, 3D type, on a
// glass pill ("just glass enough", picked over versions with symbols), Charcoal ground. Same 3D as the main icon
// (app/scripts/app-icon.cjs); the glass is the app's Glass look (tokens' glass border, a Stone sheen on top).
// Letters are Sofachrome Regular outlines (Typodermic desktop licence: images only, so the paths are inline and the
// font file never enters the repo). Set with the font's kerning plus ORBIT's +46 tracking; x is each glyph's origin.
// Run from the repo root: node host/scripts/app-icon.cjs [outDir] (outDir defaults to host/assets/icons), then prebuild
// and rebuild each app. Writes <app>.png (iOS), <app>-android.png and <app>-android-mono.png (adaptive foreground and
// themed monochrome; the background is Charcoal in app.config.ts). Sharp is borrowed from the people app.
/* global __dirname, Buffer */
const path = require('path');
const root = path.join(__dirname, '..', '..');
const sharp = require(require.resolve('sharp', { paths: [path.join(root, 'app')] }));
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'host', 'assets', 'icons');
const { palette: P, depth, glass } = require(path.join(root, 'tokens', 'tokens.json'));

const GLYPH = {
  O: 'M855 0C1052 0 1185 -149 1185 -341C1185 -536 1054 -682 855 -682H365C167 -682 36 -539 36 -341C36 -148 170 0 365 0ZM786 -300C786 -164 750 -118 668 -118H532C456 -118 422 -165 422 -300V-409C422 -530 453 -565 532 -565H668C755 -565 786 -532 786 -409Z',
  R: 'M1236 0C1248 0 1254 -8 1254 -16C1254 -21 1252 -28 1247 -32L971 -315C1078 -331 1166 -395 1166 -508C1166 -611 1075 -682 954 -682H80C62 -682 53 -673 53 -656V-27C53 -9 62 0 80 0H423C441 0 450 -9 450 -27V-565H673C736 -565 768 -541 768 -498C768 -455 736 -430 673 -430H536C518 -430 510 -421 510 -404V-373C510 -355 516 -347 527 -336L828 -27C846 -8 869 0 894 0Z',
  B: 'M913 0C1083 0 1157 -104 1157 -205C1157 -305 1093 -368 1050 -382C1078 -396 1129 -427 1129 -510C1129 -617 1062 -682 930 -682H62C45 -682 36 -673 36 -656V-27C36 -9 45 0 62 0ZM656 -313C731 -313 763 -282 763 -217C763 -153 731 -118 656 -118H421V-565H673C739 -565 760 -538 760 -498C760 -458 739 -430 673 -430H510C493 -430 484 -421 484 -404V-339C484 -322 493 -313 510 -313Z',
  I: 'M429 0C446 0 455 -9 455 -27V-656C455 -673 446 -682 429 -682H84C67 -682 58 -673 58 -656V-27C58 -9 67 0 84 0Z',
  T: 'M698 0C710 0 716 -4 716 -13V-565H1009C1022 -565 1028 -568 1028 -576V-669C1028 -678 1022 -682 1009 -682H28C15 -682 9 -678 9 -669V-576C9 -568 15 -565 28 -565H320V-13C320 -4 326 0 339 0Z',
  L: 'M992 0C1009 0 1018 -9 1018 -27L1018 -91C1018 -109 1009 -118 992 -118L599 -118C511 -118 481 -161 481 -265L481 -656C481 -673 472 -682 454 -682L71 -682C53 -682 45 -673 45 -656L45 -282C45 -118 139 0 338 0Z',
  A: 'M1393 0C1409 0 1416 -7 1416 -16C1416 -21 1414 -29 1408 -35L790 -663C778 -675 764 -682 746 -682L680 -682C664 -682 650 -675 638 -663L11 -33C5 -28 3 -21 3 -17C3 -7 11 0 22 0L683 0C701 0 710 -9 710 -27L710 -91C710 -109 701 -118 683 -118L229 -118L535 -421L922 -20C935 -7 951 0 974 0Z',
  U: 'M806 0C1039 0 1147 -139 1147 -314L1147 -656C1147 -673 1138 -682 1120 -682L1000 -682C982 -682 973 -673 973 -656L973 -314C973 -192 920 -118 806 -118L634 -118C521 -118 471 -192 471 -314L471 -656C471 -673 462 -682 445 -682L71 -682C53 -682 45 -673 45 -656L45 -314C45 -122 140 0 386 0Z',
  N: 'M1206 0C1224 0 1233 -9 1233 -27L1233 -656C1233 -673 1224 -682 1206 -682L1077 -682C1059 -682 1050 -673 1050 -656L1050 -376L306 -663C263 -680 243 -682 199 -682L76 -682C58 -682 49 -673 49 -656L49 -27C49 -9 58 0 76 0L205 0C223 0 232 -9 232 -27L232 -318L1029 -20C1073 -4 1097 0 1137 0Z',
  C: 'M1049 0C1066 0 1075 -9 1075 -27L1075 -91C1075 -109 1066 -118 1049 -118L598 -118C516 -118 480 -164 480 -300L480 -409C480 -532 511 -565 598 -565L1045 -565C1063 -565 1072 -574 1072 -592L1072 -656C1072 -673 1063 -682 1045 -682L364 -682C167 -682 36 -537 36 -341C36 -143 175 0 364 0Z',
  E: 'M1056 -313C1073 -313 1082 -319 1082 -331L1082 -412C1082 -424 1073 -430 1056 -430L578 -430C560 -430 551 -421 551 -404L551 -339C551 -322 560 -313 578 -313ZM1066 0C1084 0 1093 -9 1093 -27L1093 -91C1093 -109 1084 -118 1066 -118L598 -118C516 -118 480 -164 480 -300L480 -409C480 -532 511 -565 598 -565L1063 -565C1081 -565 1090 -574 1090 -592L1090 -656C1090 -673 1081 -682 1063 -682L364 -682C167 -682 36 -537 36 -341C36 -143 175 0 364 0Z',
  W: 'M1429 0C1445 0 1460 -5 1471 -20L1947 -649C1951 -655 1953 -661 1953 -666C1953 -675 1947 -682 1932 -682L1896 -682C1873 -682 1856 -677 1844 -662L1530 -261L1230 -662C1219 -677 1201 -682 1179 -682L1116 -682C1094 -682 1076 -677 1065 -662L762 -286L461 -662C448 -677 431 -682 409 -682L25 -682C11 -682 3 -675 3 -665C3 -660 5 -654 11 -648L530 -20C542 -6 556 0 575 0L633 0C649 0 663 -5 674 -20L1012 -445L1327 -20C1338 -5 1353 0 1372 0Z',
  H: 'M1121 0C1138 0 1147 -9 1147 -27L1147 -656C1147 -673 1138 -682 1121 -682L777 -682C759 -682 750 -673 750 -656L750 -430L450 -430L450 -656C450 -673 441 -682 424 -682L80 -682C62 -682 53 -673 53 -656L53 -27C53 -9 62 0 80 0L424 0C441 0 450 -9 450 -27L450 -313L750 -313L750 -27C750 -9 759 0 777 0Z',
  S: 'M816 0C944 0 1009 -79 1009 -168C1009 -241 990 -296 887 -344L417 -565L959 -565C977 -565 986 -574 986 -592L986 -656C986 -673 977 -682 959 -682L223 -682C94 -682 29 -603 29 -514C29 -442 49 -387 151 -339L622 -118L61 -118C44 -118 35 -109 35 -91L35 -27C35 -9 44 0 61 0Z',
};
// [glyph, x] per word, and the ink's left and right edge (for centring).
const WORDS = {
  ORBIT: { ink: [36, 5407], at: [['O', 0], ['R', 1266], ['B', 2575], ['I', 3820], ['T', 4379]] },
  LAUNCH: { ink: [45, 7329], at: [['L', 0], ['A', 1092], ['U', 2470], ['N', 3704], ['C', 5032], ['H', 6182]] },
  CREW: { ink: [36, 5539], at: [['C', 0], ['R', 1150], ['E', 2409], ['W', 3586]] },
  STATION: { ink: [29, 7414], at: [['S', 0], ['T', 1084], ['A', 1987], ['T', 3274], ['I', 4356], ['O', 4915], ['N', 6181]] },
};
const CAP = 682;

// brand.tsx's Shade: body lit from the top-left, raw gloss, soft Night shadow; numbers in font units (the kit's
// wordmark values), so the 3D scales with each word.
const DEFS = `<radialGradient id="wmBody" cx="0.36" cy="0.3" r="0.85">${depth.wordmark.map(([at, c]) => `<stop offset="${at}" stop-color="${c}"/>`).join('')}</radialGradient>
<filter id="wm3d" x="-10%" y="-40%" width="120%" height="200%" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceAlpha" stdDeviation="42" result="height"/>
  <feSpecularLighting in="height" surfaceScale="8" specularConstant="1.2" specularExponent="26" lighting-color="${P.stone}" result="spec">
    <feDistantLight azimuth="${depth.light.azimuth}" elevation="${depth.light.elevation}"/>
  </feSpecularLighting>
  <feComposite in="spec" in2="SourceAlpha" operator="in" result="gloss"/>
  <feOffset in="SourceAlpha" dy="67.2" result="drop"/>
  <feGaussianBlur in="drop" stdDeviation="58.8" result="dropBlur"/>
  <feFlood flood-color="${P.night}" flood-opacity="${depth.shadowOpacity}" result="ink"/>
  <feComposite in="ink" in2="dropBlur" operator="in" result="shadow"/>
  <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/><feMergeNode in="gloss"/></feMerge>
</filter>`;

// `name` in 3D (or flat in `fill`), its ink `w` wide, centred on x 512, cap top at `top`.
function word(name, w, top, fill) {
  const { ink, at } = WORDS[name];
  const k = w / (ink[1] - ink[0]);
  const paint = fill ? `fill="${fill}"` : 'fill="url(#wmBody)" filter="url(#wm3d)"';
  return `<g transform="translate(${512 - w / 2} ${top + CAP * k}) scale(${k}) translate(${-ink[0]} 0)" ${paint}>${at.map(([c, x]) => `<path transform="translate(${x} 0)" d="${GLYPH[c]}"/>`).join('')}</g>`;
}
const capOf = (name, w) => (CAP * w) / (WORDS[name].ink[1] - WORDS[name].ink[0]);

// The glass pill, centred: a Charcoal body, the Stone sheen over its top half, the glass border as its rim. ORBIT small
// and the name big on it; every name the same width, so the shorter the name, the taller its caps.
const PILL = { x: 86, y: 378, w: 852, h: 268 };
const pill = (paint) => `<rect x="${PILL.x}" y="${PILL.y}" width="${PILL.w}" height="${PILL.h}" rx="${PILL.h / 2}" ${paint}/>`;
const ORBIT_W = 210;
const NAME_W = 660;
const GAP = 22;
function lockup(name, fill) {
  const [a, b] = [capOf('ORBIT', ORBIT_W), capOf(name, NAME_W)];
  const top = 512 - (a + GAP + b) / 2 + 2;
  return word('ORBIT', ORBIT_W, top, fill) + word(name, NAME_W, top + a + GAP, fill);
}
const art = (name) =>
  pill(`fill="${P.charcoal}"`) + pill('fill="url(#sheen)"') + pill(`fill="none" stroke="${glass.border}" stroke-width="3"`) + lockup(name);
// Android 13 themed icon: one flat colour the launcher tints; the pill becomes its outline.
const mono = (name) => pill('fill="none" stroke="#ffffff" stroke-width="10"') + lockup(name, '#ffffff');

const SHEEN = `<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.stone}" stop-opacity=".14"/><stop offset=".45" stop-color="${P.stone}" stop-opacity="0"/></linearGradient>`;
const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs>${DEFS}${SHEEN}</defs>${body}</svg>`);
// Android keeps only a 66-unit circle of the 108-unit adaptive icon safe from every mask: radius 313 at 1024. The
// pill's round ends reach half its width from the centre, so shrink it to 304 there.
const ANDROID = 304 / (PILL.w / 2);
const at = (s, body) => `<g transform="translate(512 512) scale(${s}) translate(-512 -512)">${body}</g>`;

(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  for (const [variant, name] of [['launch', 'LAUNCH'], ['crew', 'CREW'], ['station', 'STATION']]) {
    const file = (suffix) => path.join(out, `${variant}${suffix}.png`);
    await sharp(svg(`<rect width="1024" height="1024" fill="${P.charcoal}"/>${art(name)}`)).flatten({ background: P.charcoal }).removeAlpha().png().toFile(file('')); // iOS: opaque, full bleed
    await sharp(svg(at(ANDROID, art(name)))).png().toFile(file('-android'));
    await sharp(svg(at(ANDROID, mono(name)))).png().toFile(file('-android-mono'));
    console.log(`ok: ${variant}.png, -android.png, -android-mono.png`);
  }
})();
