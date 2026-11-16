/**
 * The mode switcher's motion (src/app/switch.tsx) as pure functions of its three clocks, in seconds: `open` since it
 * appeared, `turn` the orbit's turn (in places, not seconds), and `out` the exit after the picked card reaches the
 * centre. Worklets, so it runs on the UI thread; no React Native imports, so `node --test` can check it.
 *
 * Owner, 16 Nov 2026: "make the animation slow", "out should be accumulating the space dots same as splash screen
 * photo", "animation should be like launch and zoom out the card same as o zooms out in splash", then "the accumulate
 * should be in orbit path only" and "into should be same coming out from back of current one". So:
 * - Opening: the other cards come out from behind the current one, round the orbit to their places, and the splash
 *   photo's fine dots
 *   gather across the whole page in waves, each wave sweeping in along orbits round the centre, ellipses shaped like
 *   the cards' own ("why dots on orbit. should spread across page").
 * - Everything a card does is on the orbit ("going out and coming out should happen on orbit path only").
 * - The exit copies the splash's (src/splash/motion.ts, LETTER_EXIT): the other cards go round the orbit into the picked
 *   one as ORBIT's letters are pulled into the O, then the card zooms out past the screen and fades, while the dots rush out
 *   and the backdrop lifts off the new mode underneath.
 */

/** Three places round the orbit, a third of a turn apart. */
export const STEP = (2 * Math.PI) / 3;
/** Seconds for a third of a turn. */
export const SLIDE = 0.9;
/** Seconds from the picked card reaching the centre to the new mode showing. */
export const EXIT = 1.1;
/** How far the picked card zooms: far enough that its face is wider than a phone, as the O's counter is. */
export const ZOOM_TO = 9;

// Every constant comes before the worklets. A worklet is copied to the UI thread with the constants it uses as they are
// where it's defined, so one declared below it reaches the UI thread as undefined (the other cards drew at NaN and
// vanished on the device, 16 Nov 2026). switchMotion.test.ts checks the order.

/**
 * The opening: the cards coming out and the dots gathering share one window, starting and settling together (owner:
 * "coming out and dots animation should happen same time").
 */
export const OPEN_AT = 0.15;
export const OPEN_END = 1.6;
/** The other cards come out from behind the current one over the whole window. */
export const CARDS_AT = OPEN_AT;
export const CARDS_FOR = OPEN_END - OPEN_AT;

/**
 * The dots gather in waves of layers ("accumulating"), each fading in over STAR_FADE and sweeping round its orbits over
 * STAR_SWEEP, the waves spaced so the last settles as the cards do.
 */
export const STAR_LAYERS = 6;
export const STAR_EACH = 26;
export const STAR_AT = OPEN_AT;
export const STAR_FADE = 0.55;
export const STAR_SWEEP = 0.9;
export const STAR_IN = (OPEN_END - OPEN_AT - STAR_SWEEP) / (STAR_LAYERS - 1);

/** How far a segment is (0–1) at clock `t`. */
export function phase(t: number, at: number, dur: number): number {
  'worklet';
  return Math.min(Math.max((t - at) / dur, 0), 1);
}
// GSAP's eases, as on the splash: power3.in (the O's zoom), power1.in (fades), power2.out (stars arriving).
const quartIn = (p: number) => {
  'worklet';
  return p * p * p * p;
};
const quadIn = (p: number) => {
  'worklet';
  return p * p;
};
const cubicOut = (p: number) => {
  'worklet';
  return 1 - (1 - p) * (1 - p) * (1 - p);
};
const quartOut = (p: number) => {
  'worklet';
  return 1 - (1 - p) * (1 - p) * (1 - p) * (1 - p);
};

/**
 * Card `index` on the orbit: [translateX, translateY, scale, opacity, zIndex]. The front of the orbit is the centre at
 * full size; round the back a card is smaller and higher (`lift` at the very back). Everything moves along the orbit
 * ("going out and coming out should happen on orbit path only"): on opening, the cards other than `current` set off
 * from behind it at the front and go round the ring to their places; once `out` starts, the cards other than `picked`
 * go round the ring back to the front, behind it, while it zooms.
 */
export function cardFrame(index: number, turn: number, picked: number, out: number, orbit: number, lift: number, open: number, current: number): number[] {
  'worklet';
  let a = STEP * (index - turn);
  a = Math.atan2(Math.sin(a), Math.cos(a)); // the short way round, -π to π
  let o = 1;
  let behind = false;
  if (index !== current) {
    const p = quartOut(phase(open, CARDS_AT, CARDS_FOR));
    a *= p;
    behind = p < 1;
  }
  if (out > 0 && index !== picked) {
    const p = quartIn(phase(out, 0.05, 0.5));
    a *= 1 - p;
    o = 1 - phase(out, 0.4, 0.15); // gone once it's behind the picked card
    behind = true;
  }
  const near = (1 + Math.cos(a)) / 2; // 1 in front, 0 at the very back
  const x = orbit * Math.sin(a);
  const y = -lift * (1 - near);
  let s = 0.7 + 0.3 * near;
  // On its way to or from the front, a card stays behind the one there.
  let z = behind ? Math.min(Math.round(near * 10), 9) : Math.round(near * 10);
  if (out > 0 && index === picked) {
    s *= 1 + (ZOOM_TO - 1) * quartIn(phase(out, 0.45, 0.65));
    o = 1 - quadIn(phase(out, 0.85, 0.25));
    z = 20;
  }
  return [x, y, s, o, z];
}

/** The orbit's ring fades as the cards go round it to the front. */
export function ringOpacity(out: number): number {
  'worklet';
  return 1 - quartIn(phase(out, 0.05, 0.5));
}

/** The dots: [opacity, scale]. They rush out and fade as the picked card zooms. */
export function dustFrame(out: number): number[] {
  'worklet';
  const z = quartIn(phase(out, 0.45, 0.65));
  return [1 - quadIn(phase(out, 0.5, 0.45)), 1 + 0.6 * z];
}

/** The backdrop (glass, shade): its opacity. It lifts off the new mode as the card zooms. */
export function backdropOpacity(out: number): number {
  'worklet';
  return 1 - quadIn(phase(out, 0.6, 0.4));
}

export function starLayerOpacity(layer: number, open: number): number {
  'worklet';
  return cubicOut(phase(open, STAR_AT + layer * STAR_IN, STAR_FADE));
}
/**
 * How far a layer still has to go round its orbits, in degrees (0 once settled). Drawn as squash, rotate, unsquash
 * about the orbit's centre, a whole layer sweeps along ellipses shaped like the cards' orbit, each dot on its own.
 */
export function starLayerTurn(layer: number, open: number): number {
  'worklet';
  return -(150 - layer * 12) * (1 - quartOut(phase(open, STAR_AT + layer * STAR_IN, STAR_SWEEP)));
}


export type Star = { x: number; y: number; r: number; o: number };
/**
 * The dots, as the splash photo's: fine dots of a few sizes and brightnesses scattered over a `width` × `height` page,
 * the same every time (a seeded random), in STAR_LAYERS layers of `each` (a field taller than the screen passes more, to
 * keep the switcher's density: Account's panel).
 */
export function starLayers(width: number, height: number, seed = 7, each = STAR_EACH): Star[][] {
  let s = seed >>> 0;
  const rand = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: STAR_LAYERS }, () =>
    Array.from({ length: each }, () => {
      const big = rand() < 0.12; // a few brighter ones, as in the photo
      return { x: rand() * width, y: rand() * height, r: big ? 1 + rand() * 0.6 : 0.4 + rand() * 0.5, o: big ? 0.8 + rand() * 0.2 : 0.25 + rand() * 0.45 };
    }),
  );
}
