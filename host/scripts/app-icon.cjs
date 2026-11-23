// The host apps' icons (owner, 23 Nov 2026, after "logo's are not good at all", then "add glass pill and center. symbol
// behind"): the main Glass icon's centred glass pill with ORBIT on it, and one big 3D symbol of the brand's four behind
// it, frosted where the glass covers it. Event Partner the spark, Play Partner the pearl (a ball), Crew the star; the
// heart stays the people's. Drawn with the main icon's own pieces (app/scripts/app-icon.cjs), so the letters, symbols,
// glass and 3D match it exactly.
// Run from the repo root: node host/scripts/app-icon.cjs [outDir] (outDir defaults to host/assets/icons), then prebuild
// and rebuild each app. Writes <app>.png (iOS), <app>-android.png and <app>-android-mono.png (adaptive foreground and
// themed monochrome; the background is Charcoal in app.config.ts).
/* global __dirname */
const path = require('path');
const root = path.join(__dirname, '..', '..');
const { P, SYM, word, sym, svg, at, GROUND, GLASS_DEFS, onGlass } = require(path.join(root, 'app', 'scripts', 'app-icon.cjs'));
const sharp = require(require.resolve('sharp', { paths: [path.join(root, 'app')] }));
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'host', 'assets', 'icons');

// [symbol, scale, centre y]: each about 540 across, so it shows well above and below the pill; the star a little low,
// its legs are lighter than its top point.
const MARK = { launch: ['spark', 15, 512], station: ['pearl', 17.7, 512], crew: ['star', 14.4, 530] };
const art = ([name, s, y]) => onGlass(sym(name, 512, y, s));
// Android 13 themed icon: one flat colour the launcher tints. The symbol only where the glass doesn't cover it, the
// pill as an outline, ORBIT on it.
const MONO_DEFS = '<mask id="outside"><rect width="1024" height="1024" fill="#fff"/><rect x="112" y="402" width="800" height="220" rx="110" fill="#000"/></mask>';
const mono = ([name, s, y]) =>
  `<g mask="url(#outside)" opacity=".6"><g transform="translate(512 ${y}) scale(${s})" fill="#ffffff">${SYM[name]}</g></g>` +
  '<rect x="117" y="407" width="790" height="210" rx="105" fill="none" stroke="#ffffff" stroke-width="10"/>' +
  word(640, '#ffffff');
// Android keeps only a circle of radius 313 (of 1024) safe from every mask; the pill's round ends reach 400 out.
const ANDROID = 300 / 400;

(async () => {
  require('fs').mkdirSync(out, { recursive: true });
  for (const [variant, mark] of Object.entries(MARK)) {
    const file = (suffix) => path.join(out, `${variant}${suffix}.png`);
    await sharp(svg(GROUND + art(mark), GLASS_DEFS)).flatten({ background: P.charcoal }).removeAlpha().png().toFile(file('')); // iOS: opaque, full bleed
    await sharp(svg(at(ANDROID, art(mark)), GLASS_DEFS)).png().toFile(file('-android'));
    await sharp(svg(at(ANDROID, mono(mark)), MONO_DEFS)).png().toFile(file('-android-mono'));
    console.log(`ok: ${variant}.png, -android.png, -android-mono.png`);
  }
})();
