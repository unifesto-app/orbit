import { memo, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { loadLocalRawResource } from 'react-native-svg/css';
import { scheduleOnRN } from 'react-native-worklets';

import { color } from '../theme';
import {
  BOX,
  EXIT_END,
  I,
  INTRO_END,
  INTRO_PROPS,
  LETTERS,
  LOOP_EVERY,
  MARK_H,
  MARK_W,
  ORIGIN,
  SWAP_LEN,
  SWAP_PROPS,
  footerOpacity,
  groundOpacity,
  introPropFrame,
  letterFrame,
  nextSwap,
  splashLayout,
  wallpaperFrame,
  swapPropFrame,
  type PropArt,
} from './motion';

// Real SVG files, swapped by replacing them (see the list in the PR). Letters are cut from the wordmark.
const LETTER_SVG: ImageSourcePropType[] = [
  require('../../assets/splash/letter-o.svg'),
  require('../../assets/splash/letter-r.svg'),
  require('../../assets/splash/letter-b.svg'),
  require('../../assets/splash/letter-i.svg'),
  require('../../assets/splash/letter-t.svg'),
];
const PROP_SVG: Record<PropArt, ImageSourcePropType> = {
  flower: require('../../assets/splash/prop-flower.svg'),
  dot: require('../../assets/splash/prop-dot.svg'),
  sparkle: require('../../assets/splash/prop-sparkle.svg'),
  bolt: require('../../assets/splash/prop-bolt.svg'),
  arch: require('../../assets/splash/prop-arch.svg'),
  squiggle: require('../../assets/splash/prop-squiggle.svg'),
};
const FOOTER_SVG: ImageSourcePropType = require('../../assets/splash/by-unifesto.svg');
// "Horizon walker" (the Splash board's wallpaper). The artist's credit is part of the image: keep it visible.
const WALLPAPER: ImageSourcePropType = require('../../assets/splash/wallpaper.jpg');
const FOOTER_W = 108; // the Splash board's size
const FOOTER_H = (FOOTER_W * 238) / 1735;

/** On screen at least this long from mount, even if the app is ready at once. */
const HOLD_MS = 2600;
/** Home is mounted underneath; wait this long after the last swap lands before leaving. */
const SETTLE_MS = 350;
/** Never stuck: leave by this time even if the app never says it is ready. */
const CAP_MS = 30000;
/** Start by this time even if some SVGs haven't loaded (they are bundled, so normally a few ms). */
const SVG_WAIT_MS = 1500;
/** The others have joined the O by this point in the exit; their clock stops there so they stop redrawing. */
const COLLAPSE_END = 0.66;
/** The JS fallback finishes the handover this long after the exit's own end, if its callback was lost. */
const FALLBACK_MS = 2000;
/** The O is drawn at this multiple and scaled down, so it stays sharper through its 45× zoom out.
 * ponytail: still soft at the very end of the zoom; redraw at a second size mid-zoom if it shows. */
const O_RES = 2;

type Xml = {
  letters: (string | null)[];
  props: Partial<Record<PropArt, string | null>>;
  footer: string | null;
};

/** Reads every SVG file once, before the intro starts. A file that fails stays null and is skipped. */
async function loadXml(): Promise<Xml> {
  const read = (s: ImageSourcePropType) => loadLocalRawResource(s).catch(() => null);
  const arts = Object.keys(PROP_SVG) as PropArt[];
  const [letters, props, footer] = await Promise.all([
    Promise.all(LETTER_SVG.map(read)),
    Promise.all(arts.map((a) => read(PROP_SVG[a]))),
    read(FOOTER_SVG),
  ]);
  return { letters, props: Object.fromEntries(arts.map((a, k) => [a, props[k]])), footer };
}

/** A frame vector ([x, y, scale, scaleY, rotate, opacity]) as a style. Transform and opacity only. */
function frameStyle(v: number[]) {
  'worklet';
  const s = Math.max(v[2], 0.001); // a 0 scale is a singular matrix on iOS
  return {
    opacity: Math.min(Math.max(v[5], 0), 1),
    transform: [
      { translateX: v[0] },
      { translateY: v[1] },
      { rotate: `${v[4]}deg` },
      { scaleX: s },
      { scaleY: Math.max(s * v[3], 0.001) },
    ],
  };
}

/**
 * The launch splash, over Home: ORBIT arrives letter by letter while props are thrown in with GSAP
 * physics; while the app is still loading, a random letter at a time swaps out for its prop; then
 * the word collapses into its O, which zooms out past the screen into Home.
 * Motion lives in motion.ts.
 *
 * `ready`: the app can show Home (fonts today; auth later). `onDone`: the splash has left.
 */
export function Splash({ ready, onLeave, onDone }: { ready: boolean; onLeave: () => void; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  // Cover the screen, anchored to the bottom: a shorter screen (iPhone SE, iPad) loses sky from the
  // top, never the artist's credit at the foot.
  const screen = useWindowDimensions();
  const layout = splashLayout(screen.width, screen.height, insets.bottom);
  // With reduced motion the intro and exit jump to their ends (Reanimated follows the system
  // setting) and the loader stays off.
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);
  const [xml, setXml] = useState<Xml | null>(null);

  const t = useSharedValue(0);
  const out = useSharedValue(0);
  const collapse = useSharedValue(0);
  // One swap clock per letter (seconds into its swap; idle below 0). The I never swaps.
  const swaps = [useSharedValue(-1), useSharedValue(-1), useSharedValue(-1), useSharedValue(-1), useSharedValue(-1)];

  const live = useRef({
    alive: true,
    started: false,
    introDone: false,
    held: false,
    ready,
    winding: false,
    settled: false,
    exiting: false,
    done: false,
    last: -1,
    swapTimer: null as ReturnType<typeof setTimeout> | null,
  });
  const done = useRef(onDone);
  const leave = useRef(onLeave);
  useEffect(() => {
    done.current = onDone;
    leave.current = onLeave;
  }, [onDone, onLeave]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  const finish = () => {
    const s = live.current;
    if (s.done) return;
    s.done = true;
    if (s.swapTimer) clearTimeout(s.swapTimer);
    done.current();
  };

  const startExit = () => {
    const s = live.current;
    if (s.exiting) return;
    s.exiting = true;
    leave.current(); // Home mounts now (if it hasn't), so the O zooms out onto it
    // Armed first, so even a throw below can't leave the splash up: if the UI thread's callback is lost.
    later(EXIT_END * 1000 + FALLBACK_MS, finish);
    out.value = withTiming(EXIT_END, { duration: EXIT_END * 1000, easing: Easing.linear }, (ok) => {
      if (ok) scheduleOnRN(finish);
    });
    collapse.value = withTiming(COLLAPSE_END, { duration: COLLAPSE_END * 1000, easing: Easing.linear });
  };

  const tick = () => {
    const s = live.current;
    if (s.settled && s.held) startExit();
  };

  // The app is ready (or the cap is hit): no new swap starts, and the exit waits for the last to land.
  const windDown = () => {
    const s = live.current;
    if (s.winding || !s.introDone) return;
    s.winding = true;
    if (s.swapTimer) clearTimeout(s.swapTimer);
    s.swapTimer = null;
    // The last swap's own clock says how long until it lands (a finished or idle clock: now).
    const clock = s.last >= 0 ? swaps[s.last].value : SWAP_LEN;
    const landing = clock >= 0 ? Math.max(0, SWAP_LEN - clock) * 1000 : 0;
    later(landing + SETTLE_MS, () => {
      s.settled = true;
      tick();
    });
  };

  // The loader: a random letter (never the I, never twice running) swaps for its prop every LOOP_EVERY.
  const swapNext = () => {
    const s = live.current;
    s.swapTimer = null;
    if (!s.alive) return;
    if (s.winding || reducedRef.current) return;
    const i = nextSwap(s.last);
    s.last = i;
    swaps[i].value = 0;
    swaps[i].value = withTiming(SWAP_LEN, { duration: SWAP_LEN * 1000, easing: Easing.linear });
    s.swapTimer = setTimeout(swapNext, LOOP_EVERY * 1000);
  };

  const onIntroDone = () => {
    const s = live.current;
    if (s.introDone) return;
    s.introDone = true;
    if (s.ready) windDown();
    else swapNext();
  };

  const start = () => {
    const s = live.current;
    if (s.started || !s.alive) return; // a load finishing after unmount starts nothing
    s.started = true;
    later(INTRO_END * 1000 + 400, onIntroDone); // armed first: if the UI thread's callback is lost
    t.value = withTiming(INTRO_END, { duration: INTRO_END * 1000, easing: Easing.linear }, (ok) => {
      if (ok) scheduleOnRN(onIntroDone);
    });
  };

  useEffect(() => {
    const s = live.current;
    s.alive = true; // (again, after React's dev-only StrictMode unmount and remount)
    loadXml()
      .then(setXml)
      .catch(() => {}) // no art: the ground and timing still run, and it still leaves
      .finally(start);
    later(SVG_WAIT_MS, start);
    later(HOLD_MS, () => {
      s.held = true;
      tick();
    });
    later(CAP_MS, () => {
      s.ready = true;
      windDown();
    });
    // The last word: whatever happened above, the splash is gone by now.
    later(CAP_MS + EXIT_END * 1000 + FALLBACK_MS, finish);
    const pending = timers.current;
    return () => {
      s.alive = false;
      pending.forEach(clearTimeout);
      if (s.swapTimer) clearTimeout(s.swapTimer);
    };
    // Runs once: the clocks and timers belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    live.current.ready = ready;
    if (ready) windDown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const groundStyle = useAnimatedStyle(() => ({ opacity: groundOpacity(out.value) }));
  const wallpaperStyle = useAnimatedStyle(() => {
    const w = wallpaperFrame(t.value, out.value);
    return { opacity: w[0], transform: [{ scale: w[1] }] };
  });
  const footerStyle = useAnimatedStyle(() => ({ opacity: footerOpacity(t.value, out.value) }));

  return (
    <View style={styles.root} accessible accessibilityRole="image" accessibilityLabel="Orbit by Unifesto">
      <Animated.View style={[StyleSheet.absoluteFill, styles.ground, groundStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, wallpaperStyle]}>
          <Image source={WALLPAPER} style={[styles.abs, layout.wallpaper]} />
        </Animated.View>
      </Animated.View>
      {xml && (
        <>
          <View style={styles.centre} pointerEvents="none">
            <View style={styles.mark}>
              {LETTERS.map((name, i) => (
                <Letter key={name} i={i} t={t} swap={swaps[i]} exit={i === 0 ? out : collapse} xml={xml.letters[i]} />
              ))}
              {INTRO_PROPS.map((p, k) => (
                <IntroProp key={k} k={k} t={t} xml={xml.props[p.art] ?? null} />
              ))}
              {LETTERS.map((_, i) => (i === I ? null : <SwapProp key={`s${i}`} i={i} swap={swaps[i]} xml={xml.props[SWAP_PROPS[i]!.art] ?? null} />))}
            </View>
          </View>
          {xml.footer && (
            <Animated.View style={[styles.footer, { bottom: layout.footerBottom }, footerStyle]} pointerEvents="none">
              <Art xml={xml.footer} w={FOOTER_W} h={FOOTER_H} />
            </Animated.View>
          )}
        </>
      )}
    </View>
  );
}

/** Parsed once; its wrapper moves it. */
const Art = memo(function Art({ xml, w, h }: { xml: string; w: number; h: number }) {
  return <SvgXml xml={xml} width={w} height={h} />;
});

function Letter({ i, t, swap, exit, xml }: { i: number; t: SharedValue<number>; swap: SharedValue<number>; exit: SharedValue<number>; xml: string | null }) {
  const style = useAnimatedStyle(() => frameStyle(letterFrame(i, t.value, swap.value, exit.value)));
  const b = BOX[i];
  const res = i === 0 ? O_RES : 1; // drawn bigger, shown at size: the O's zoom then enlarges a sharper drawing
  if (!xml) return null;
  return (
    <Animated.View style={[styles.abs, { left: b.x, top: b.y, width: b.w, height: b.h, transformOrigin: ORIGIN[i] }, style]}>
      <View style={{ width: b.w * res, height: b.h * res, transformOrigin: '0 0', transform: [{ scale: 1 / res }] }}>
        <Art xml={xml} w={b.w * res} h={b.h * res} />
      </View>
    </Animated.View>
  );
}

/** Places a prop centred in its host letter's box. */
function propBox(host: number, w: number, h: number) {
  const b = BOX[host];
  return { left: b.x + (b.w - w) / 2, top: b.y + (b.h - h) / 2, width: w, height: h };
}

function IntroProp({ k, t, xml }: { k: number; t: SharedValue<number>; xml: string | null }) {
  const style = useAnimatedStyle(() => frameStyle(introPropFrame(k, t.value)));
  const p = INTRO_PROPS[k];
  if (!xml) return null;
  return (
    <Animated.View style={[styles.abs, propBox(p.host, p.w, p.h), style]}>
      <Art xml={xml} w={p.w} h={p.h} />
    </Animated.View>
  );
}

function SwapProp({ i, swap, xml }: { i: number; swap: SharedValue<number>; xml: string | null }) {
  const style = useAnimatedStyle(() => {
    const v = swapPropFrame(swap.value);
    return { opacity: v[0] > 0.001 ? 1 : 0, transform: [{ rotate: `${v[1]}deg` }, { scale: Math.max(v[0], 0.001) }] };
  });
  const p = SWAP_PROPS[i]!;
  if (!xml) return null;
  return (
    <Animated.View style={[styles.abs, propBox(i, p.w, p.h), style]}>
      <Art xml={xml} w={p.w} h={p.h} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Above Home until it removes itself.
  root: { ...StyleSheet.absoluteFill, zIndex: 2000, elevation: 2000 },
  ground: { backgroundColor: color.ground },
  abs: { position: 'absolute' },
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  mark: { width: MARK_W, height: MARK_H },
  footer: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
