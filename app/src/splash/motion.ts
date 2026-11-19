/**
 * "ORBIT, in orbit": the launch splash's motion as pure functions of two clocks, `run` (intro, then the ride while
 * loading) and `out` (the exit), in seconds, over a scene laid out for one screen.
 *
 * Owner, 19 Nov 2026: "redesign the entire splash, bring symbols and orbits", then "Redesign it completely new and
 * unique. a perfect splash."; of the two takes previewed, "Take A, round" (the rings sweeping round the word and off
 * the screen's sides; Take B stood them upright). Then "make it slow, smooth and check the orbit meeting its end
 * perfectly": everything slower, every body's speed continuous (no stop and start), and each ring closing exactly on
 * its own start as its body glides through it. Then "some lag and stuck there": the tails' 64 dot views went, and the
 * splash waits on a still frame until Home has mounted under it (Splash.tsx). It replaced the kit's symbols-in-orbit
 * board, which had replaced the
 * Horizon walker wallpaper, thrown props and letter swaps.
 *
 * The 3D wordmark rises in on Charcoal over a soft Sage glow. A pearl, a spark and a star set off round tilted orbits
 * round the word, each drawing its ring as it goes; a small heart follows the spark. The
 * rings pass behind the letters; a body goes behind the word round the back of its ring and in front round the near
 * side, larger and brighter. They ride on while the app loads. At the exit they're pulled into the O, R B I T collapse
 * into it, and the O zooms out through its counter onto Home.
 *
 * Every constant comes before the first worklet (a worklet copies constants where it's defined).
 */

/** Seconds: the intro (every ring closed by then), and the exit. RUN_MAX bounds the run clock, past the cap. */
export const INTRO_END = 3.75; // the last ring closes at 3.6; the still rings take over after
export const EXIT_END = 1.9;
export const RUN_MAX = 60;

/** The mark's own units (web/src/app/brand.tsx Wordmark): letters' x extents, all from y -682 to 0. */
export const MARK = { x: 36, w: 5371, h: 682 };
export const LETTERS = [
  { name: 'o', x0: 36, x1: 1185 },
  { name: 'r', x0: 1319, x1: 2520 },
  { name: 'b', x0: 2611, x1: 3732 },
  { name: 'i', x0: 3878, x1: 4275 },
  { name: 't', x0: 4388, x1: 5407 },
] as const;
/** Each letter's PNG has PAD mark units round its box, for its shadow. */
export const PAD = 260;
/** The O's counter, where everything is pulled in and the zoom goes through. */
export const O_CENTRE = { x: 36 + 0.494 * 1149, y: -682 + 0.499 * 682 };

/**
 * Rings: circles of radius `r` (x the screen's width) tilted away by `tilt` degrees (90 is edge on) and turned `turn`
 * degrees on screen; `from` is where its first body sets off (degrees round, 90 the nearest point), placed so no body
 * rests on a letter; `way` its direction. Crossing, never concentric-looking: three sizes, tilts and turns.
 */
export const RINGS = [
  { r: 0.62, tilt: 74, turn: -12, from: 105, way: 1, opacity: 0.45 },
  { r: 0.5, tilt: 58, turn: 24, from: 250, way: -1, opacity: 0.55 },
  { r: 0.78, tilt: 76, turn: -28, from: 118, way: 1, opacity: 0.35 },
] as const;
/**
 * The symbols riding them, each from its ring's start: when it sets off (`at`), and how far round (`lap`) it has gone
 * when its sweep of `for` seconds ends. The first body on a ring draws it, a whole lap, so its ring closes on its own
 * start just as the sweep ends. `size` is pt per kit board unit, as the symbol PNGs are drawn (`half` units each side).
 */
export const BODIES = [
  { art: 'pearl', ring: 0, at: 0.5, lap: 1, for: 2.7, size: 0.62, half: 38 },
  { art: 'spark', ring: 1, at: 0.7, lap: 1, for: 2.7, size: 0.6, half: 42 },
  { art: 'star', ring: 2, at: 0.9, lap: 1, for: 2.7, size: 0.6, half: 42 },
  // Follows the spark round its drawn ring, ending its sweep with the spark's, half a lap behind: opposite it.
  { art: 'heartSmall', ring: 1, at: 1.6, lap: 0.5, for: 1.8, size: 0.55, half: 50 },
] as const;
/** Seconds a lap at cruising speed: how a body sets off, ends its sweep and rides while the app loads. */
export const LAP = 24;
export const POINTS = 240;
/** Round the back a body is BACK_SCALE / BACK_OPACITY of its near self. */
export const BACK_SCALE = 0.76;
export const BACK_OPACITY = 0.55;
export const O_ZOOM_TO = 45;

/** GSAP's eases (power1 = quad, power2 = cubic, power3 = quart) and back.out(c). */
export const P1O = 1;
export const P2O = 2;
export const P3O = 3;
export const P1I = 4;
export const P2I = 5;
export const P3I = 6;
export const P3IO = 8;
export const BACK = 9;

/** Where everything goes on a width x height screen (pt). Pure, run once per layout, not a worklet. */
export function scene(width: number, height: number) {
  const markW = Math.min(width - 56, 340);
  const m = markW / MARK.w; // pt per mark unit
  const markH = MARK.h * m;
  const cx = width / 2;
  const cy = height * 0.46;
  const word = { left: cx - markW / 2, top: cy - markH / 2, width: markW, height: markH };
  const at = (x: number, y: number) => [word.left + (x - MARK.x) * m, word.top + (y + MARK.h) * m];
  const letters = LETTERS.map((l) => {
    const [left, top] = at(l.x0 - PAD, -MARK.h - PAD);
    const w = (l.x1 - l.x0 + 2 * PAD) * m;
    const h = (MARK.h + 2 * PAD) * m;
    const centre = at((l.x0 + l.x1) / 2, -MARK.h / 2);
    return { name: l.name, left, top, width: w, height: h, cx: centre[0], cy: centre[1] };
  });
  const [ox, oy] = at(O_CENTRE.x, O_CENTRE.y);
  const o = { x: ox, y: oy, originX: ox - letters[0].left, originY: oy - letters[0].top };
  // Each ring in pt round (cx, cy), from its first body's start, the way it travels; the last point is the first again.
  const loops = RINGS.map((g) => {
    const R = g.r * width;
    const cosT = Math.cos((g.tilt * Math.PI) / 180);
    const turn = (g.turn * Math.PI) / 180;
    const x: number[] = [];
    const y: number[] = [];
    const depth: number[] = [];
    for (let i = 0; i <= POINTS; i++) {
      const a = ((g.from + (g.way * 360 * (i % POINTS)) / POINTS) * Math.PI) / 180;
      const px = R * Math.cos(a);
      const py = R * cosT * Math.sin(a);
      x.push(cx + px * Math.cos(turn) - py * Math.sin(turn));
      y.push(cy + px * Math.sin(turn) + py * Math.cos(turn));
      depth.push((1 + Math.sin(a)) / 2); // 1 at the nearest point, 0 at the back
    }
    const cum = [0];
    for (let i = 1; i <= POINTS; i++) cum.push(cum[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]));
    return { x, y, depth, cum, length: cum[POINTS], opacity: g.opacity };
  });
  // The rings' drawing only covers where they are on screen, so a redraw paints as little as it can.
  const xs = loops.flatMap((l) => l.x);
  const ys = loops.flatMap((l) => l.y);
  const left = Math.max(Math.floor(Math.min(...xs)) - 2, 0);
  const top = Math.max(Math.floor(Math.min(...ys)) - 2, 0);
  const box = { left, top, width: Math.min(Math.ceil(Math.max(...xs)) + 2, width) - left, height: Math.min(Math.ceil(Math.max(...ys)) + 2, height) - top };
  // Closed with Z, so where a drawn ring meets its own start the line joins, with no seam.
  const rings = loops.map((l) => ({
    ...l,
    d: `${l.x
      .slice(0, POINTS)
      .map((px, i) => `${i ? 'L' : 'M'}${(px - box.left).toFixed(2)} ${(l.y[i] - box.top).toFixed(2)}`)
      .join(' ')} Z`,
  }));
  return { width, height, cx, cy, m, word, letters, o, rings, box };
}
export type Scene = ReturnType<typeof scene>;

const LETTER_IN_AT = 0.2;
const LETTER_IN_STEP = 0.12;

/** GSAP's ease formulas. */
export function ease(kind: number, c: number, p: number): number {
  'worklet';
  switch (kind) {
    case P1O:
      return 1 - (1 - p) * (1 - p);
    case P2O:
      return 1 - Math.pow(1 - p, 3);
    case P3O:
      return 1 - Math.pow(1 - p, 4);
    case P1I:
      return p * p;
    case P2I:
      return p * p * p;
    case P3I:
      return p * p * p * p;
    case P3IO:
      return p < 0.5 ? Math.pow(2 * p, 4) / 2 : 1 - Math.pow(2 * (1 - p), 4) / 2;
    case BACK: {
      const q = p - 1;
      return q * q * ((c + 1) * q + c) + 1;
    }
    default:
      return p;
  }
}

/** How far a segment is (0–1) at clock `t`. */
export function phase(t: number, at: number, dur: number): number {
  'worklet';
  if (dur <= 0) return t >= at ? 1 : 0;
  return Math.min(Math.max((t - at) / dur, 0), 1);
}

/**
 * How far (pt) body `k` has gone round its ring. Its speed is cruising (a lap in LAP) plus a swell, sin² over its
 * sweep, sized so it has gone exactly `lap` round when the sweep ends: it sets off, speeds up, and eases back to
 * cruising as it passes its start again, with no stop and no jolt (speed and its change both continuous).
 */
export function travelled(s: Scene, k: number, run: number): number {
  'worklet';
  const b = BODIES[k];
  const L = s.rings[b.ring].length;
  const v = L / LAP;
  const t = Math.max(run - b.at, 0);
  const D = b.for;
  const swell = (2 * (b.lap * L - v * D)) / D;
  const u = Math.min(t, D);
  return v * t + swell * (u / 2 - (D / (4 * Math.PI)) * Math.sin((2 * Math.PI * u) / D));
}

/** A point `d` pt along ring `r` (wraps): [x, y, depth]. */
export function along(s: Scene, r: number, d: number): number[] {
  'worklet';
  const g = s.rings[r];
  const u = ((d % g.length) + g.length) % g.length;
  let lo = 0;
  let hi = POINTS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (g.cum[mid] <= u) lo = mid;
    else hi = mid;
  }
  const p = (u - g.cum[lo]) / Math.max(g.cum[hi] - g.cum[lo], 1e-6);
  return [g.x[lo] + (g.x[hi] - g.x[lo]) * p, g.y[lo] + (g.y[hi] - g.y[lo]) * p, g.depth[lo] + (g.depth[hi] - g.depth[lo]) * p];
}

/** How much of ring `r` is drawn (pt): as far as its first body has gone, until it closes. */
export function ringDrawn(s: Scene, r: number, run: number): number {
  'worklet';
  let k = 0;
  while (BODIES[k].ring !== r) k++;
  return Math.min(travelled(s, k, run), s.rings[r].length);
}

/** The rings' opacity: they fade as everything is pulled into the O. */
export function ringsOpacity(out: number): number {
  'worklet';
  return 1 - ease(P1I, 0, phase(out, 0, 0.7));
}

/** Body `k` appearing as it sets off. */
function shown(k: number, run: number): number {
  'worklet';
  return ease(P1O, 0, phase(run, BODIES[k].at, 0.5));
}

/** Body `k`: [x, y (pt, its centre), scale, opacity, zIndex]. Round the back it's behind the word (z 1), else in front (3). */
export function bodyFrame(s: Scene, k: number, run: number, out: number): number[] {
  'worklet';
  const b = BODIES[k];
  const p = along(s, b.ring, travelled(s, k, run));
  let x = p[0];
  let y = p[1];
  let sc = (BACK_SCALE + (1 - BACK_SCALE) * p[2]) * (0.6 + 0.4 * ease(P3O, 0, phase(run, b.at, 0.7)));
  let a = (BACK_OPACITY + (1 - BACK_OPACITY) * p[2]) * shown(k, run);
  let z = p[2] < 0.5 ? 1 : 3;
  if (out > 0) {
    // Pulled into the O while still riding round, so it curves in rather than turning.
    const pull = ease(P3I, 0, phase(out, 0.04 * k, 0.8));
    x += (s.o.x - x) * pull;
    y += (s.o.y - y) * pull;
    sc *= 1 - 0.85 * pull;
    a *= 1 - ease(P1I, 0, phase(out, 0.55 + 0.04 * k, 0.25));
    z = 1;
  }
  return [x, y, Math.max(sc, 0.001), Math.min(Math.max(a, 0), 1), z];
}

/** Letter `i`: [translateX, translateY, scale, opacity, zoom layer's opacity (the O only)]. */
export function letterFrame(s: Scene, i: number, run: number, out: number): number[] {
  'worklet';
  const at = LETTER_IN_AT + LETTER_IN_STEP * i;
  let x = 0;
  let y = 22 * (1 - ease(BACK, 1.1, phase(run, at, 1)));
  let sc = 0.94 + 0.06 * ease(P3O, 0, phase(run, at, 1));
  let a = ease(P1O, 0, phase(run, at, 0.45));
  let zoom = 0;
  if (out > 0) {
    y *= 1 - phase(out, 0, 0.15); // still landing: settle first
    if (i === 0) {
      // To the screen's centre at 1.6x, coming to rest there; then the zoom sets off from rest.
      const p = ease(P3IO, 0, phase(out, 0.6, 0.6));
      x = (s.width / 2 - s.o.x) * p;
      y = (s.height / 2 - s.o.y) * p;
      sc = 1 + 0.6 * p + (O_ZOOM_TO - 1.6) * ease(P3I, 0, phase(out, 1.2, EXIT_END - 1.2));
      a *= 1 - ease(P1I, 0, phase(out, EXIT_END - 0.3, 0.3));
      zoom = phase(out, 0.6, 0.6); // the shadowless O takes over as it comes forward
    } else {
      const p = ease(P3I, 0, phase(out, 0.2 + (i - 1) * 0.05, 0.6));
      x = (s.o.x - s.letters[i].cx) * p;
      sc *= 1 - 0.8 * p;
      a *= 1 - p;
    }
  }
  return [x, y, Math.max(sc, 0.001), Math.min(Math.max(a, 0), 1), zoom];
}

/** The Sage glow behind the word: its opacity. */
export function glowOpacity(run: number, out: number): number {
  'worklet';
  return ease(P2O, 0, phase(run, 0, 1.4)) * (1 - phase(out, 0.5, 0.7));
}

/** The ground: it lifts off Home as the O zooms out. */
export function groundOpacity(out: number): number {
  'worklet';
  return 1 - ease(P1I, 0, phase(out, 1.4, EXIT_END - 1.4));
}
