/**
 * The launch splash's motion as pure functions of three clocks, in seconds:
 * `t` the intro, `swap` a letter's loader swap, `out` the exit.
 *
 * Ported from Unifesto's splash (mobile/src/screens/splashMotion.ts), which the owner approved on
 * 13 Nov 2026 from a GSAP prototype: the eases are GSAP's formulas and the letter tracks are its
 * timeline segments, number for number. Unifesto's eight letters map onto ORBIT's five:
 * O takes the u (the others collapse into it at the exit), R the n, B the e, I the i and T the t.
 *
 * The props no longer follow tweened paths: they move by GSAP's physics plugins (owner, 15 Nov),
 * Physics2D for position (velocity, angle, gravity, friction) and PhysicsProps for spin.
 *
 * Everything is a worklet, so the splash runs on the UI thread: a busy JS thread can delay when it
 * starts or leaves, never how it moves. No React Native imports, so `node --test` can check it.
 */

/** ORBIT's letters; each is an SVG cut from the wordmark (assets/splash/letter-*.svg). */
export const LETTERS = ['o', 'r', 'b', 'i', 't'] as const;
export const MARK_W = 240;
export const MARK_H = 30.47;
/** Each letter's box in pt inside the 240-wide mark, from web/public/orbit-wordmark.svg. */
export const BOX = [
  { x: 0, y: 0, w: 51.34, h: 30.47 },
  { x: 57.33, y: 0, w: 53.67, h: 30.47 },
  { x: 115.06, y: 0, w: 50.09, h: 30.47 },
  { x: 171.68, y: 0, w: 17.74, h: 30.47 },
  { x: 194.47, y: 0, w: 45.53, h: 30.47 },
];
/** Pivots: the O shrinks into its counter (where the rings are born), the R unfolds from its foot, the T pops from its middle. */
export const ORIGIN = ['49.4% 49.9%', '50% 100%', '50% 50%', '50% 50%', '50% 60%'];
/** The I never swaps in the loader (Unifesto's i didn't either). */
export const I = 3;

/** Seconds: the intro settles by INTRO_END (the loader starts then); the exit lasts EXIT_END. */
export const INTRO_END = 2.3;
export const EXIT_END = 2.05;
/** The loader: a swap starts every LOOP_EVERY seconds and lasts SWAP_LEN (so two overlap briefly). */
export const LOOP_EVERY = 0.9;
export const SWAP_LEN = 1.08;

// State vector indices: translateX, translateY, scale, scaleY (on top of scale), rotate (deg), opacity.
const X = 0;
const Y = 1;
const S = 2;
const SY = 3;
const R = 4;
const A = 5;

// GSAP eases. A segment names one by kind (and back's overshoot / elastic's period in `c`).
const NONE = 0;
const P1O = 1; // power1.out, GSAP's default
const P2O = 2;
const P3O = 3;
const P1I = 4;
const P2I = 5;
const P3I = 6;
const P2IO = 7;
const P3IO = 8;
const BACK = 9; // back.out(c)

/** GSAP's ease formulas (its powerN is one degree up: power3 = quart). */
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
    case P2IO:
      return p < 0.5 ? Math.pow(2 * p, 3) / 2 : 1 - Math.pow(2 * (1 - p), 3) / 2;
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

/** [property, from, to, at, duration, ease kind, ease param]. */
type Seg = [number, number, number, number, number, number, number];
/** A timeline track: the start state and its segments, in time order per property. */
type Track = { i: number[]; s: Seg[] };

/** The state at clock `t`: every segment that has started sets its property; the latest wins. */
export function evalTrack(track: Track, t: number): number[] {
  'worklet';
  const v = track.i.slice();
  for (let k = 0; k < track.s.length; k++) {
    const g = track.s[k];
    if (t >= g[3]) v[g[0]] = g[1] + (g[2] - g[1]) * ease(g[5], g[6], phase(t, g[3], g[4]));
  }
  return v;
}

/**
 * GSAP's physics, one axis: how far something has moved `t` seconds after launch.
 * velocity in pt/s, acceleration in pt/s². Without friction it is the exact formula, as in GSAP.
 * With friction GSAP steps 30 times a second (Physics2DPlugin and PhysicsPropsPlugin both set
 * sps = 30): each step the velocity gains the acceleration, keeps 1 - friction of itself, and moves
 * the value. Between steps this blends straight towards the next step's position, so it never jumps
 * back (GSAP's own blend leaves out the acceleration, a sub-point difference).
 */
export const FPS = 30;
export function physics(t: number, velocity: number, acceleration: number, friction: number): number {
  'worklet';
  if (t <= 0) return 0;
  if (!friction) return velocity * t + 0.5 * acceleration * t * t;
  const keep = 1 - friction;
  const a = acceleration / (FPS * FPS);
  const steps = t * FPS;
  let v = velocity / FPS;
  let x = 0;
  for (let n = Math.floor(steps); n > 0; n--) {
    v = (v + a) * keep;
    x += v;
  }
  return x + (v + a) * keep * (steps % 1);
}

/** GSAP's Physics2D: launched at `velocity` along `angle` (deg; 0 is right, 90 is down), gravity pulls down. */
export function physics2D(t: number, velocity: number, angle: number, gravity: number, friction: number): number[] {
  'worklet';
  const r = (angle * Math.PI) / 180;
  return [physics(t, velocity * Math.cos(r), 0, friction), physics(t, velocity * Math.sin(r), gravity, friction)];
}

const REST = [0, 0, 1, 1, 0, 1];

/** The intro, per letter (O R B I T): Unifesto's u, n, e, i and t tracks. */
const LETTER_INTRO: Track[] = [
  // O (the u): rises, dips back, rises again to rest.
  { i: [0, 34, 1, 1, 0, 0], s: [[A, 0, 1, 0.15, 0.18, NONE, 0], [Y, 34, 0, 0.15, 0.3, P3O, 0], [Y, 0, 12, 0.5, 0.25, P2IO, 0], [Y, 12, 0, 0.75, 0.55, P3O, 0]] },
  // R (the n): unfolds up from its foot once the flower has flown off.
  { i: [0, 0, 1, 0, 0, 0], s: [[A, 0, 1, 0.72, 0.05, NONE, 0], [SY, 0, 1, 0.72, 0.5, BACK, 2.2]] },
  // B (the e): rises in after the reel.
  { i: [0, 30, 1, 1, 0, 0], s: [[A, 0, 1, 1.05, 0.18, NONE, 0], [Y, 30, 0, 1.05, 0.55, BACK, 1.4]] },
  // I (the i): drops from above and overshoots its seat.
  { i: [0, -34, 1, 1, 0, 0], s: [[A, 0, 1, 0.5, 0.18, NONE, 0], [Y, -34, 0, 0.5, 0.6, BACK, 1.8]] },
  // T (the t): pops out of nothing as the bolt shrinks away.
  { i: [0, 0, 0, 1, 0, 0], s: [[A, 0, 1, 1.78, 0.05, NONE, 0], [S, 0, 1, 1.78, 0.45, BACK, 2.4]] },
];

/** A prop's artwork: assets/splash/prop-<name>.svg. */
export type PropArt = 'flower' | 'dot' | 'sparkle' | 'bolt' | 'arch' | 'squiggle';

/**
 * An intro prop, thrown with GSAP physics. It sits centred in its host letter's box, offset by
 * (x0, y0) at launch; `look` animates its scale, opacity and extra rotation on top of the throw.
 */
export type PhysicsProp = {
  host: number;
  art: PropArt;
  w: number;
  h: number;
  /** Launch time on the intro clock, and where it starts relative to its host's centre (pt). */
  at: number;
  x0: number;
  y0: number;
  /** Physics2D: pt/s along angle (deg), gravity pt/s², friction 0–1. */
  velocity: number;
  angle: number;
  gravity: number;
  friction: number;
  /** PhysicsProps on rotation: start angle (deg), deg/s, friction 0–1. */
  spin: [number, number, number];
  look: Track;
};

// A reel item hops out of the B and falls back in: up ~24pt in 0.15s, so 320pt/s against 2133pt/s².
const reel = (k: number, art: PropArt, size: number, angle: number): PhysicsProp => {
  const at = 0.55 + k * 0.16;
  return {
    host: 2,
    art,
    w: size,
    h: size,
    at,
    x0: 0,
    y0: 8,
    velocity: 320,
    angle,
    gravity: 2133,
    friction: 0,
    spin: [0, (angle + 90) * 12, 0],
    look: {
      i: [0, 0, 0.4, 1, 0, 0],
      s: [[S, 0.4, 1, at, 0.12, P2O, 0], [A, 0, 1, at, 0.12, P2O, 0], [S, 1, 0.4, at + 0.18, 0.14, P2I, 0], [A, 1, 0, at + 0.18, 0.14, P2I, 0]],
    },
  };
};

/** The intro's props: the flower arcs over the R, the reel hops through the B, the bolt skids onto the T. */
export const INTRO_PROPS: PhysicsProp[] = [
  // Tossed from below-left, it peaks on the R's centre 0.3s later and falls away spinning as the R unfolds.
  // Peak 60pt up in 0.3s: 400pt/s up and 1333pt/s² of gravity; 40pt across: 133pt/s.
  {
    host: 1, art: 'flower', w: 24, h: 24, at: 0.25, x0: -40, y0: 60,
    velocity: 421.6, angle: -71.6, gravity: 1333, friction: 0, spin: [-90, 540, 0.04],
    look: { i: [0, 0, 0, 1, 0, 1], s: [[S, 0, 1, 0.25, 0.3, BACK, 2], [S, 1, 0, 0.62, 0.2, P2I, 0]] },
  },
  reel(0, 'dot', 14, -101),
  reel(1, 'sparkle', 22, -90),
  reel(2, 'dot', 14, -79),
  // Thrown in from the right, friction skids it to a stop on the T's centre: with 0.15 friction it
  // covers velocity/30 × 0.85/0.15 pt, so 374.35pt/s along 171.87° travels the 70.71pt from (70, -10)
  // and has settled within 1pt by the time it shrinks away (0.95s, 28 steps). Its spin settles from
  // 38° to 0 the same way: 201.18°/s.
  {
    host: 4, art: 'bolt', w: 20, h: 34, at: 0.65, x0: 70, y0: -10,
    velocity: 374.35, angle: 171.87, gravity: 0, friction: 0.15, spin: [38, -201.18, 0.15],
    look: { i: [0, 0, 0, 1, 0, 1], s: [[S, 0, 1, 0.65, 0.45, BACK, 2.5], [S, 1, 0, 1.6, 0.25, P2I, 0], [R, 0, 20, 1.6, 0.25, P2I, 0]] },
  },
];

/** Intro prop `k` at clock `t`: [x, y, scale, scaleY, rotate, opacity]. */
export function introPropFrame(k: number, t: number): number[] {
  'worklet';
  const p = INTRO_PROPS[k];
  const v = evalTrack(p.look, t);
  const local = t - p.at;
  const xy = physics2D(local, p.velocity, p.angle, p.gravity, p.friction);
  v[X] = p.x0 + xy[0];
  v[Y] = p.y0 + xy[1];
  v[R] += p.spin[0] + physics(local, p.spin[1], 0, p.spin[2]);
  return v;
}

/** The loader's prop for each letter (O R B I T; the I never swaps, so it has none). */
export const SWAP_PROPS: ({ art: PropArt; w: number; h: number } | null)[] = [
  { art: 'flower', w: 22, h: 22 },
  { art: 'arch', w: 26, h: 19 },
  { art: 'sparkle', w: 24, h: 24 },
  null,
  { art: 'squiggle', w: 26, h: 16 },
];

const cx = (i: number) => BOX[i].x + BOX[i].w / 2;
// The O's counter: it lands on the mark's centre, where the rings are born.
const O_CX = BOX[0].x + 0.494 * BOX[0].w;
const O_CY = BOX[0].y + 0.499 * BOX[0].h;

/**
 * The exit, per letter: the others are pulled into the O, and the O takes the centre (Unifesto's
 * timing). Then, instead of zooming through it (owner, 15 Nov), the O shrinks away as the orbit
 * rings burst out of it (ringFrame).
 */
const LETTER_EXIT: Track[] = LETTERS.map((_, i) => {
  if (i === 0) {
    return {
      i: REST,
      s: [
        [X, 0, MARK_W / 2 - O_CX, 0.35, 0.45, P3IO, 0], [Y, 0, MARK_H / 2 - O_CY, 0.35, 0.45, P3IO, 0], [S, 1, 1.6, 0.35, 0.45, P3IO, 0],
        [S, 1.6, 0.4, 0.72, 0.22, P2I, 0],
        [A, 1, 0, 0.74, 0.16, P1I, 0],
      ] as Seg[],
    };
  }
  const at = 0.1 + (i - 1) * 0.03;
  return { i: REST, s: [[X, 0, O_CX - cx(i), at, 0.36, P3I, 0], [S, 1, 0.2, at, 0.36, P3I, 0], [A, 1, 0, at, 0.36, P3I, 0]] as Seg[] };
});

/** The orbit ring's box in pt (assets/splash/orbit-ring.svg, drawn twice), centred on the screen. */
export const RING_W = 200;
export const RING_H = 105;
/** Ring k's resting tilt: the two cross like the Orbit symbol. */
const RING_TILT = [40, -40];
/** Rings are born as the O shrinks; ring 1 starts its turn a beat later, so they're never edge-on together. */
const RING_BORN = 0.7;
const RING_TURN = [0.7, 0.8];
const RING_TURN_LEN = 0.8;
/** They zoom out once both have come round face-on. */
const RING_ZOOM = 1.45;
const RING_ZOOM_LEN = 0.55;

/**
 * Orbit ring `k` (0 or 1) at exit clock `out`: [scale, tilt (deg), revolve (deg, rotateX), opacity].
 * Born from the O as it shrinks, each ring revolves one full turn about its own long axis (a real
 * 3D turn: the view applies perspective), in opposite directions, drifting a little around the
 * centre as it goes. Both come back face-on, then zoom out past the screen with Home already
 * showing through the gap at their centre.
 */
export function ringFrame(k: number, out: number): number[] {
  'worklet';
  const dir = k === 0 ? 1 : -1;
  const born = phase(out, RING_BORN, 0.45);
  const turn = ease(P2IO, 0, phase(out, RING_TURN[k], RING_TURN_LEN));
  const zoom = ease(P3I, 0, phase(out, RING_ZOOM, RING_ZOOM_LEN));
  const scale = (0.25 + 0.75 * ease(BACK, 1.7, born)) * (1 + 44 * zoom);
  const tilt = RING_TILT[k] + dir * 25 * ease(P1O, 0, phase(out, RING_BORN, RING_ZOOM + RING_ZOOM_LEN - RING_BORN));
  const opacity = out < RING_BORN ? 0 : phase(out, RING_BORN, 0.15) * (1 - phase(out, EXIT_END - 0.1, 0.1));
  return [scale, tilt, dir * 360 * turn, opacity];
}

const FOOTER: Track = { i: [0, 0, 1, 1, 0, 0], s: [[A, 0, 1, 1.4, 0.8, P1O, 0]] };
const FOOTER_EXIT: Track = { i: REST, s: [[A, 1, 0, 0.05, 0.25, P1O, 0]] };
const GROUND_EXIT: Track = { i: REST, s: [[A, 1, 0, 1.65, 0.3, P1I, 0]] };
// The Horizon walker wallpaper takes Unifesto's glass sheet's part: it settles in, then rushes past
// with the rings. It tops out at WALLPAPER_DIM over the dark ground, so it sits back (owner, 15 Nov).
export const WALLPAPER_DIM = 0.7;

/** The wallpaper (assets/splash/wallpaper.jpg) in px, and how high its artist credit reaches above its foot. */
export const WALLPAPER_W = 860;
export const WALLPAPER_H = 1720;
const CREDIT_TOP = 64;

/**
 * Where the wallpaper and the "by unifesto" footer go on a width × height screen (pt): the wallpaper
 * covers it, anchored to the bottom, so a shorter screen loses sky from the top and never the credit;
 * the footer sits above the home indicator and always clear of the credit (on iPad the credit rises
 * into where the footer would otherwise go).
 */
export function splashLayout(width: number, height: number, insetBottom: number) {
  const fit = Math.max(width / WALLPAPER_W, height / WALLPAPER_H);
  return {
    wallpaper: { width: WALLPAPER_W * fit, height: WALLPAPER_H * fit, left: (width - WALLPAPER_W * fit) / 2, bottom: 0 },
    creditTop: CREDIT_TOP * fit,
    footerBottom: Math.max(insetBottom + 30, CREDIT_TOP * fit + 8),
  };
}
const PANE: Track = { i: [0, 0, 1.04, 1, 0, 0], s: [[A, 0, WALLPAPER_DIM, 0.1, 1.4, P2O, 0], [S, 1.04, 1, 0.1, 1.4, P2O, 0]] };
const PANE_EXIT: Track = { i: REST, s: [[S, 1, 1.6, RING_ZOOM, RING_ZOOM_LEN, P3I, 0]] };

/** The wallpaper: [opacity, scale]. It sits in the ground's layer, so it lifts off Home with it. */
export function wallpaperFrame(t: number, out: number): number[] {
  'worklet';
  const p = evalTrack(PANE, t);
  return [p[A], p[S] * evalTrack(PANE_EXIT, out)[S]];
}

/** The loader's next letter: a random one each time, never the I, never the one that just went. */
export function nextSwap(last: number, random: () => number = Math.random): number {
  const choices = [0, 1, 2, 4].filter((k) => k !== last);
  return choices[Math.floor(random() * choices.length)];
}

/**
 * A letter during its swap, `local` seconds in (idle below 0 or from SWAP_LEN): [translateY, opacity].
 * It lifts out, waits for its prop, drops back in.
 */
function swapLetter(local: number): number[] {
  'worklet';
  if (local < 0 || local >= SWAP_LEN) return [0, 1];
  if (local < 0.2) {
    const p = ease(P2I, 0, local / 0.2);
    return [-16 * p, 1 - p];
  }
  if (local < 0.68) return [-16, 0];
  const p = ease(BACK, 1.6, (local - 0.68) / 0.4);
  return [16 - 16 * p, Math.min(Math.max(p, 0), 1)];
}

/** A swap prop, `local` seconds into its letter's swap: [scale, rotate]. */
export function swapPropFrame(local: number): number[] {
  'worklet';
  if (local < 0.15 || local >= SWAP_LEN) return [0, -60];
  if (local < 0.45) {
    const p = ease(BACK, 2.2, (local - 0.15) / 0.3);
    return [p, -60 + 60 * p];
  }
  if (local < 0.6) return [1, 0];
  const p = ease(P2I, 0, phase(local, 0.6, 0.16));
  return [1 - p, 60 * p];
}

/**
 * Letter `i` at its clocks: the intro `t`, its own swap clock `swap` (seconds into its current
 * swap; idle below 0), and the exit `out`. Returns [x, y, scale, scaleY, rotate, opacity].
 */
export function letterFrame(i: number, t: number, swap: number, out: number): number[] {
  'worklet';
  const v = evalTrack(LETTER_INTRO[i], t);
  if (swap >= 0) {
    const w = swapLetter(swap);
    v[Y] = w[0];
    v[A] = w[1];
  }
  if (out > 0) {
    // A letter still landing settles first (the loader winds down before the exit, so this is a safety net).
    const settle = ease(P1O, 0, phase(out, 0, 0.12));
    v[Y] = v[Y] * (1 - settle);
    v[A] = v[A] + (1 - v[A]) * settle;
    const e = evalTrack(LETTER_EXIT[i], out);
    v[X] += e[X];
    v[Y] += e[Y];
    v[S] *= e[S];
    v[A] *= e[A];
  }
  return v;
}

/** The footer's opacity. */
export function footerOpacity(t: number, out: number): number {
  'worklet';
  return evalTrack(FOOTER, t)[A] * evalTrack(FOOTER_EXIT, out)[A];
}

/** The ground's opacity: it lifts off Home as the rings zoom out. */
export function groundOpacity(out: number): number {
  'worklet';
  return evalTrack(GROUND_EXIT, out)[A];
}
