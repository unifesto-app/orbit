// The app icon (owner, 16 Nov 2026: "add app logo"), from the "App icon" board in docs/context/artifacts/orbit-logo-concepts:
// the ORBIT + by unifesto lockup on #121215, with by unifesto sized up for the icon. Drawn from the same files as the
// logo everywhere else: the splash letters (via web/public/orbit-wordmark.svg) and assets/splash/by-unifesto.svg.
// Also the alternate icons picked in Account > Appearance (ALT below). Writes the files app.json already names.
// Run: node app/scripts/app-icon.cjs (from the repo root), then prebuild and rebuild.
/* global __dirname, Buffer */
const sharp = require('sharp');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const asset = (f) => path.join(root, 'app', 'assets', f);
const GROUND = '#121215';
const ACCENT = '#295EFF';
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// An SVG file as a tight, transparent PNG `width` wide (the files carry padding in their viewBox), all `fill` if given.
async function art(file, width, fill) {
  let svg = require('fs').readFileSync(path.join(root, file), 'utf8');
  if (fill) svg = svg.replace(/fill="#[0-9a-fA-F]{6}"/g, `fill="${fill}"`);
  // At the default density the files' viewBox units are pixels: the wordmark is 5507 wide, by unifesto 1735, plenty.
  const big = await sharp(Buffer.from(svg)).trim({ threshold: 0 }).png().toBuffer();
  return sharp(big).resize({ width }).png().toBuffer({ resolveWithObject: true });
}

// The lockup, `width` wide, centred on a `size` square: by unifesto at 60% of ORBIT's width, half ORBIT's height below it.
async function lockup(size, width, background, fill) {
  const mark = await art('web/public/orbit-wordmark.svg', width, fill);
  const by = await art('app/assets/splash/by-unifesto.svg', Math.round(width * 0.6), fill);
  const gap = Math.round(mark.info.height * 0.5);
  const top = Math.round((size - (mark.info.height + gap + by.info.height)) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([
      { input: mark.data, left: Math.round((size - mark.info.width) / 2), top },
      { input: by.data, left: Math.round((size - by.info.width) / 2), top: top + mark.info.height + gap },
    ])
    .png();
}

// A 1024 square SVG.
const square = (body, defs = '') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs>${defs}</defs>${body}</svg>`);

// The alternate icons (owner, 16 Nov 2026: Ticket and Hologram approved of the themed sets, "ship the approved ones").
// Each is a full-bleed `back` and the `front` drawn on it. The names are the ones app.json's expo-alternate-app-icons
// entry and src/app/account/appearance.tsx use.
const ALT = {
  // The lockup's ORBIT printed on an event ticket in the accent, turned a little, over Account's accent glow.
  Ticket: {
    back: () =>
      square(
        `<rect width="1024" height="1024" fill="${GROUND}"/><rect width="1024" height="1024" fill="url(#g)"/>`,
        `<radialGradient id="g" cx="0.5" cy="1" r="0.9"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0.75"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>`,
      ),
    front: async () => {
      const ticket = square(
        `<g transform="rotate(-14 512 600)">
           <mask id="cut"><rect width="1024" height="1024" fill="#fff"/><circle cx="222" cy="600" r="44" fill="#000"/><circle cx="802" cy="600" r="44" fill="#000"/><circle cx="640" cy="390" r="26" fill="#000"/><circle cx="640" cy="810" r="26" fill="#000"/></mask>
           <rect x="222" y="390" width="580" height="420" rx="36" fill="url(#t)" mask="url(#cut)"/>
           <line x1="640" y1="440" x2="640" y2="760" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="8" stroke-dasharray="4 22" stroke-linecap="round"/>
           <g fill="#FFFFFF" opacity=".9"><rect x="680" y="470" width="80" height="12" rx="6"/><rect x="680" y="500" width="56" height="12" rx="6"/><rect x="680" y="700" width="80" height="12" rx="6"/></g>
           <g fill="#FFFFFF" opacity=".75"><rect x="290" y="700" width="140" height="14" rx="7"/><rect x="290" y="730" width="90" height="14" rx="7"/></g>
         </g>`,
        `<linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#748FFC"/><stop offset=".5" stop-color="${ACCENT}"/><stop offset="1" stop-color="#7048E8"/></linearGradient>`,
      );
      const mark = await sharp((await art('web/public/orbit-wordmark.svg', 300, '#ffffff')).data).rotate(-14, { background: CLEAR }).png().toBuffer();
      return sharp(ticket).composite([{ input: mark, left: 290, top: 470 }]).png().toBuffer();
    },
  },
  // The lockup as it is, in the ground colour, on pastel holographic foil with a diagonal sheen.
  Hologram: {
    back: () =>
      square(
        `<rect width="1024" height="1024" fill="url(#h)"/><rect width="1024" height="1024" fill="url(#sheen)"/>`,
        `<linearGradient id="h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFDEEB"/><stop offset=".25" stop-color="#C5F6FA"/><stop offset=".5" stop-color="#E5DBFF"/><stop offset=".75" stop-color="#FFF3BF"/><stop offset="1" stop-color="#D0EBFF"/></linearGradient>
         <linearGradient id="sheen" x1="0" y1="1" x2="1" y2="0"><stop offset=".35" stop-color="#FFFFFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFFFFF" stop-opacity=".6"/><stop offset=".65" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`,
      ),
    front: async () => (await lockup(1024, 640, CLEAR, GROUND)).toBuffer(),
  },
};
// Android's adaptive foreground: the back full bleed (the launcher's mask trims it) and the front's drawing centred and
// shrunk until its box fits the circle every mask shape shows (66 of the 108dp, a radius of 313 at 1024). Ticket's
// drawing sits low on iOS, so centring it is what keeps a round launcher from clipping its corner.
const SAFE_RADIUS = 300;

(async () => {
  // iOS: opaque, full bleed (iOS rounds the corners).
  await (await lockup(1024, 640, GROUND)).flatten({ background: GROUND }).removeAlpha().toFile(asset('icon.png'));
  // Android adaptive: the launcher masks to a circle or squircle inside the middle 66%, so the lockup stays well within.
  await (await lockup(512, 300, { r: 0, g: 0, b: 0, alpha: 0 })).toFile(asset('android-icon-foreground.png'));
  await sharp({ create: { width: 512, height: 512, channels: 3, background: GROUND } }).png().toFile(asset('android-icon-background.png'));
  // Android 13 themed icons: one colour, which the launcher tints.
  await (await lockup(432, 250, CLEAR, '#ffffff')).toFile(asset('android-icon-monochrome.png'));
  console.log('ok: icon.png, android-icon-foreground.png, android-icon-background.png, android-icon-monochrome.png');

  require('fs').mkdirSync(asset('icons'), { recursive: true });
  for (const [name, { back, front }] of Object.entries(ALT)) {
    const file = name.toLowerCase();
    const drawn = await front();
    await sharp(back()).composite([{ input: drawn }]).flatten({ background: GROUND }).removeAlpha().toFile(asset(`icons/${file}.png`));
    const box = await sharp(drawn).trim({ threshold: 0 }).png().toBuffer({ resolveWithObject: true });
    const fit = Math.min(1, SAFE_RADIUS / (Math.hypot(box.info.width, box.info.height) / 2));
    const small = await sharp(box.data).resize({ width: Math.round(box.info.width * fit) }).png().toBuffer({ resolveWithObject: true });
    const [left, top] = [small.info.width, small.info.height].map((s) => Math.round((1024 - s) / 2));
    await sharp(back()).composite([{ input: small.data, left, top }]).png().toFile(asset(`icons/${file}-android.png`));
    console.log(`ok: icons/${file}.png, icons/${file}-android.png`);
  }
})();
