/**
 * The mode switcher's motion (src/app/switch.tsx) as pure functions of its three clocks, in seconds: `open` since it
 * appeared, `turn` the orbit's turn (in places, not seconds), and `out` the exit after the picked card reaches the
 * centre. Worklets, so it runs on the UI thread; no React Native imports, so `node --test` can check it.
 *
 * Owner, 16 Nov 2026: "make the animation slow", "out should be accumulating the space dots same as splash screen
 * photo", "animation should be like launch and zoom out the card same as o zooms out in splash", then "the accumulate
 * should be in orbit path only" and "into should be same coming out from back of current one". So:
 * - Opening: the other cards come out from behind the current one, round the orbit to their places. The space dots that
 *   gathered with them are gone (owner, 19 Nov 2026: "remove space dots, completely").
 * - Everything a card does is on the orbit ("going out and coming out should happen on orbit path only").
 * - The exit copies the splash's (src/splash/motion.ts, LETTER_EXIT): the other cards go round the orbit into the picked
 *   one as ORBIT's letters are pulled into the O, then the card zooms out past the screen and fades, while the backdrop lifts off the new mode underneath.
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

/** The opening window. */
export const OPEN_AT = 0.15;
export const OPEN_END = 1.6;
/** The other cards come out from behind the current one over the whole window. */
export const CARDS_AT = OPEN_AT;
export const CARDS_FOR = OPEN_END - OPEN_AT;

/** How far a segment is (0–1) at clock `t`. */
export function phase(t: number, at: number, dur: number): number {
  'worklet';
  return Math.min(Math.max((t - at) / dur, 0), 1);
}
// GSAP's eases, as on the splash: power3.in (the O's zoom), power1.in (fades).
const quartIn = (p: number) => {
  'worklet';
  return p * p * p * p;
};
const quadIn = (p: number) => {
  'worklet';
  return p * p;
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

/** The backdrop (glass, shade): its opacity. It lifts off the new mode as the card zooms. */
export function backdropOpacity(out: number): number {
  'worklet';
  return 1 - quadIn(phase(out, 0.6, 0.4));
}

