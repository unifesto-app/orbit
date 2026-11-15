// An approved Canva line drawing -> the app's filled, tinted cut-out for its Explore card (src/app/(tabs)/search.tsx).
// Usage: node app/scripts/explore-art.cjs <drawing.png or .svg's embedded png> app/assets/explore/<slug>.png <#colour>
//   [size] [x,y ...]: each x,y (in the source drawing's pixels) clears the enclosed gap it sits in, background showing
//   between objects (owner, 15 Nov 2026: "not that gap b/w reel and clap and camera"). bg=0.7 also clears light grey
//   reachable from the edges, e.g. a floor shadow under the objects ("for music no ground needed"); default 0.9.
//   ink=light draws the lines light and the fills in the colour, for art that is mostly lines (Fests' fireworks would
//   vanish as dark lines on the dark card). parts=0 keeps every separate piece (each firework ray is its own); the
//   default 0.08 drops pieces under 8% of the largest, which is what removes a burst. glow=x,y,r keeps a firework's
//   light centre (Fests: glow=857,863,170 glow=1383,994,110).
// (owner, 15 Nov 2026: the drawings are Canva AI line art, kept in the Canva design "Orbit Explore elements").
// 1. Only the background goes: a flood fill from the edges over near-white pixels; the drawing's own white fills stay.
// 2. Duotone in the category colour: dark lines -> a deep shade, white -> a tint that strengthens toward the bottom
//    centre, like the card's own glow ("apply the same tint applied for card"). Shading lands in between.
const sharp = require('sharp');
const [src, out, hex, size = '480', ...rest] = process.argv.slice(2);
const opt = (k, d) => rest.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1) ?? d;
const gaps = rest.filter((a) => !a.includes('='));
const inkLight = opt('ink', 'dark') === 'light';
const partsMin = Number(opt('parts', 0.08));
const bgLight = Number(opt('bg', 0.9));
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
(async () => {
  // Canva's background remover gives real transparency (soft edges and all); keep it. Only without it, flood-fill.
  const raw = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (i) => raw.data[i * 4 + 3];
  const { data, info } = await sharp(src).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info, n = W * H;
  let cut = false;
  for (let i = 0; i < n && !cut; i++) cut = alpha(i) < 255;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2]) / 255;
  // Background: near-white pixels reachable from the border.
  const bg = new Uint8Array(n), stack = [];
  const push = (i) => { if (!bg[i] && L[i] > bgLight) { bg[i] = 1; stack.push(i); } };
  if (!cut) for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  if (!cut) for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
  // Named gaps: the light region around each point goes too.
  for (const g of gaps) {
    const [gx, gy] = g.split(',').map(Number);
    const q = [gy * W + gx];
    while (q.length) {
      const i = q.pop();
      if (bg[i] || L[i] <= 0.75) continue;
      bg[i] = 1;
      const x = i % W;
      if (x > 0) q.push(i - 1); if (x < W - 1) q.push(i + 1); if (i >= W) q.push(i - W); if (i < n - W) q.push(i + W);
    }
  }
  // Drop the burst ("remove the web kind curved lines"): its strokes aren't joined to the drawn objects, so keep only
  // the large connected parts of the drawing (at least 8% of the largest: a burst piece beside Hackathons' bulb was
  // 5.4%, its </> glyphs 12% and up) and clear the rest.
  if (!cut) {
    const label = new Int32Array(n).fill(-1), sizes = [];
    for (let s0 = 0; s0 < n; s0++) {
      if (bg[s0] || label[s0] >= 0) continue;
      const id = sizes.length, q = [s0];
      label[s0] = id;
      let count = 0;
      while (q.length) {
        const i = q.pop(), x = i % W, y = (i - x) / W;
        count++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!bg[j] && label[j] < 0) { label[j] = id; q.push(j); }
        }
      }
      sizes.push(count);
    }
    const keep = Math.max(...sizes) * partsMin;
    for (let i = 0; i < n; i++) if (!bg[i] && sizes[label[i]] < keep) bg[i] = 1;
  }
  // glow=x,y,r (repeatable) fills back a light core the background fill leaked into through the gaps between rays
  // (owner: "for fireworks dont remove bg in center firework"): solid to half of r, then fading out by r.
  const glowA = new Uint8Array(n);
  for (const g of rest.filter((a) => a.startsWith('glow='))) {
    const [gx, gy, r] = g.slice(5).split(',').map(Number);
    for (let y = Math.max(0, gy - r); y < Math.min(H, gy + r); y++) for (let x = Math.max(0, gx - r); x < Math.min(W, gx + r); x++) {
      const a = Math.round(255 * Math.min(1, Math.max(0, 2 - (2 * Math.hypot(x - gx, y - gy)) / r)));
      glowA[y * W + x] = Math.max(glowA[y * W + x], a);
    }
  }
  const c = rgb(hex), deep = mix(c, [0, 0, 0], 0.55), lightA = mix(c, [255, 255, 255], 0.88), lightB = mix(c, [255, 255, 255], 0.35);
  const outBuf = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i % W, y = (i - x) / W;
    const t = Math.max(0, 1 - Math.hypot(x / W - 0.5, 1 - y / H) / 0.9); // the card's radial: bottom centre, r 0.9
    const light = mix(lightA, lightB, t);
    const v = inkLight ? mix(lightA, c, L[i]) : mix(deep, light, L[i]);
    outBuf[i * 4] = v[0]; outBuf[i * 4 + 1] = v[1]; outBuf[i * 4 + 2] = v[2];
    outBuf[i * 4 + 3] = cut ? alpha(i) : bg[i] ? glowA[i] : 255;
  }
  await sharp(outBuf, { raw: { width: W, height: H, channels: 4 } })
    .trim({ threshold: 0 })
    .resize(+size, +size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log('ok', out);
})();
