// The app icon (owner, 16 Nov 2026: "add app logo"), from the "App icon" board in docs/context/artifacts/orbit-logo-concepts:
// the ORBIT + by unifesto lockup on #121215, with by unifesto sized up for the icon. Drawn from the same files as the
// logo everywhere else: the splash letters (via web/public/orbit-wordmark.svg) and assets/splash/by-unifesto.svg.
// Writes the files app.json already names. Run: node app/scripts/app-icon.cjs (from the repo root), then rebuild.
const sharp = require('sharp');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const asset = (f) => path.join(root, 'app', 'assets', f);
const GROUND = '#121215';

// An SVG file as a tight, transparent PNG `width` wide (the files carry padding in their viewBox), all white if `white`.
async function art(file, width, white = false) {
  let svg = require('fs').readFileSync(path.join(root, file), 'utf8');
  if (white) svg = svg.replace(/fill="#[0-9a-fA-F]{6}"/g, 'fill="#ffffff"');
  // At the default density the files' viewBox units are pixels: the wordmark is 5507 wide, by unifesto 1735, plenty.
  const big = await sharp(Buffer.from(svg)).trim({ threshold: 0 }).png().toBuffer();
  return sharp(big).resize({ width }).png().toBuffer({ resolveWithObject: true });
}

// The lockup, `width` wide, centred on a `size` square: by unifesto at 60% of ORBIT's width, half ORBIT's height below it.
async function lockup(size, width, background, white = false) {
  const mark = await art('web/public/orbit-wordmark.svg', width, white);
  const by = await art('app/assets/splash/by-unifesto.svg', Math.round(width * 0.6), white);
  const gap = Math.round(mark.info.height * 0.5);
  const top = Math.round((size - (mark.info.height + gap + by.info.height)) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([
      { input: mark.data, left: Math.round((size - mark.info.width) / 2), top },
      { input: by.data, left: Math.round((size - by.info.width) / 2), top: top + mark.info.height + gap },
    ])
    .png();
}

(async () => {
  // iOS: opaque, full bleed (iOS rounds the corners).
  await (await lockup(1024, 640, GROUND)).flatten({ background: GROUND }).removeAlpha().toFile(asset('icon.png'));
  // Android adaptive: the launcher masks to a circle or squircle inside the middle 66%, so the lockup stays well within.
  await (await lockup(512, 300, { r: 0, g: 0, b: 0, alpha: 0 })).toFile(asset('android-icon-foreground.png'));
  await sharp({ create: { width: 512, height: 512, channels: 3, background: GROUND } }).png().toFile(asset('android-icon-background.png'));
  // Android 13 themed icons: one colour, which the launcher tints.
  await (await lockup(432, 250, { r: 0, g: 0, b: 0, alpha: 0 }, true)).toFile(asset('android-icon-monochrome.png'));
  console.log('ok: icon.png, android-icon-foreground.png, android-icon-background.png, android-icon-monochrome.png');
})();
