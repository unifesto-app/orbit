import { useEffect, useMemo, useRef } from 'react';
import { Image, type ImageSourcePropType, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, type SharedValue, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { color } from '../theme';
import {
  BODIES,
  EXIT_END,
  INTRO_END,
  RUN_MAX,
  type Scene,
  bodyFrame,
  glowOpacity,
  groundOpacity,
  letterFrame,
  ringDrawn,
  ringsOpacity,
  scene,
} from './motion';

// ORBIT in the kit's 3D (body ramp, raw gloss, Night shadow) and the symbols, rendered from web/src/app/brand.tsx:
// React Native SVG has no specular lighting. Letters are padded for their shadow (PAD in motion.ts); the O has a
// shadowless twin for the zoom, so no baked shadow veils Home through its counter.
const LETTER_ART: ImageSourcePropType[] = [
  require('../../assets/splash/mark-o.png'),
  require('../../assets/splash/mark-r.png'),
  require('../../assets/splash/mark-b.png'),
  require('../../assets/splash/mark-i.png'),
  require('../../assets/splash/mark-t.png'),
];
const O_ZOOM_ART: ImageSourcePropType = require('../../assets/splash/mark-o-zoom.png');
const BODY_ART: Record<(typeof BODIES)[number]['art'], ImageSourcePropType> = {
  pearl: require('../../assets/splash/sym-pearl.png'),
  spark: require('../../assets/splash/sym-spark.png'),
  star: require('../../assets/splash/sym-star.png'),
  heartSmall: require('../../assets/splash/sym-heartSmall.png'),
};
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** On screen at least this long from mount, even if the app is ready at once. */
const HOLD_MS = 2600;
/** Never stuck: leave by this time even if the app never says it is ready. */
const CAP_MS = 30000;
/** Home mounts under the splash once the app is ready; the intro waits this long after that, so Home's first render
 * and the art's loading are done before anything moves (React commits pause Reanimated's updates: "some lag and stuck
 * there", owner, 19 Nov 2026). Till then the splash is the still Charcoal of the launch screen. */
const SETTLE_MS = 450;
/** Start by this time whatever: the O's art (bundled, but read over the network from Metro in a dev build) or the
 * app being slow to be ready never leaves a still screen. */
const START_CAP_MS = 2000;
/** The JS fallback finishes the handover this long after the exit's own end, if its callback was lost. */
const FALLBACK_MS = 2000;

/**
 * The launch splash, over Home: "ORBIT, in orbit" (owner, 19 Nov 2026, Take A; then "make it slow, smooth"). The 3D
 * word rises in over a Sage glow; a pearl, a spark and a star set off round tilted orbits round it, each drawing its
 * ring, a small heart following the spark; they ride while the app loads; then everything is pulled into the O, which
 * zooms out through its counter onto Home. Motion lives in motion.ts.
 *
 * Kept light: nothing re-renders once it starts, and after the intro only the four bodies are updated each frame (the
 * rings, letters and glow follow `intro`, which stops), so the SVG isn't repainted while loading.
 *
 * `ready`: the app can show Home (fonts today; auth later). `onLeave`: mount Home under it now. `onDone`: it has left.
 */
export function Splash({ ready, onLeave, onDone }: { ready: boolean; onLeave: () => void; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const s = useMemo(() => scene(width, height), [width, height]);
  // With reduced motion the intro and exit jump to their ends (Reanimated follows the system setting) and nothing
  // rides the rings while loading.
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  const run = useSharedValue(0);
  // The same clock, stopping at the end of the intro: what only moves in the intro (rings, letters, glow) follows this
  // one, so once it's over their worklets stop running and nothing is resent to them (Reanimated compares a style's
  // values by reference, and a dash or transform is a new array every frame).
  const intro = useSharedValue(0);
  const out = useSharedValue(0);
  const live = useRef({ alive: true, started: false, art: 0, settled: false, introDone: false, held: false, ready, home: ready, exiting: false, done: false });
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
    const l = live.current;
    if (l.done) return;
    l.done = true;
    done.current();
  };

  const startExit = () => {
    const l = live.current;
    if (l.exiting) return;
    l.exiting = true;
    // Home is already under it once the app was ready; only when the cap got here first is it mounted now. Telling the
    // layout anyway would re-render the app's whole navigator just as the O sets off.
    if (!l.home) leave.current();
    // Armed first, so even a throw below can't leave the splash up: if the UI thread's callback is lost.
    later(EXIT_END * 1000 + FALLBACK_MS, finish);
    out.value = withTiming(EXIT_END, { duration: EXIT_END * 1000, easing: Easing.linear }, (ok) => {
      if (ok) scheduleOnRN(finish);
    });
  };

  // Leaves once the intro has played, the hold is up and the app is ready (or the cap is hit).
  const tick = () => {
    const l = live.current;
    if (l.introDone && l.held && l.ready) startExit();
  };

  const start = () => {
    const l = live.current;
    if (l.started || !l.alive) return; // a load finishing after unmount starts nothing
    l.started = true;
    const introDone = () => {
      l.introDone = true;
      tick();
    };
    if (reducedRef.current) {
      run.value = INTRO_END; // settled at once, and still
      intro.value = INTRO_END;
      introDone();
      return;
    }
    // One clock for the intro and the ride while loading, linear seconds up to well past the cap; the intro's own, set
    // off in the same call so a ring's line stays under its body.
    run.value = withTiming(RUN_MAX, { duration: RUN_MAX * 1000, easing: Easing.linear });
    intro.value = withTiming(INTRO_END, { duration: INTRO_END * 1000, easing: Easing.linear });
    later(INTRO_END * 1000, introDone);
  };

  // Starts once both O images have loaded (the plain and the zoom's) and Home has settled under it.
  const artLoaded = () => {
    const l = live.current;
    l.art++;
    if (l.art >= 2 && l.settled) start();
  };

  useEffect(() => {
    const l = live.current;
    l.alive = true; // (again, after React's dev-only StrictMode unmount and remount)
    later(START_CAP_MS, start);
    later(HOLD_MS, () => {
      l.held = true;
      tick();
    });
    later(CAP_MS, () => {
      l.ready = true;
      tick();
    });
    // The last word: whatever happened above, the splash is gone by now.
    later(CAP_MS + EXIT_END * 1000 + FALLBACK_MS, finish);
    const pending = timers.current;
    return () => {
      l.alive = false;
      pending.forEach(clearTimeout);
    };
    // Runs once: the clocks and timers belong to this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const l = live.current;
    l.ready = ready;
    l.home = ready; // the layout mounts Home as soon as it's ready
    if (!ready) return;
    // Home mounts in this same commit; give its first render time to land before anything moves.
    if (!l.settled)
      later(SETTLE_MS, () => {
        l.settled = true;
        if (l.art >= 2) start();
      });
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const groundStyle = useAnimatedStyle(() => ({ opacity: groundOpacity(out.value) }));

  // One parent, so zIndex orders them: the ground, glow and rings (0), bodies round the back (1), the word (2), bodies
  // on the near side (3). A body moves between behind and in front of the word as it rides round.
  return (
    <View style={styles.root} accessible accessibilityRole="image" accessibilityLabel="Orbit">
      <Animated.View style={[StyleSheet.absoluteFill, styles.ground, groundStyle]} />
      <Glow s={s} run={intro} out={out} />
      <Rings s={s} run={intro} out={out} />
      {s.letters.map((l, i) => (
        <Letter key={l.name} s={s} i={i} run={intro} out={out} onLoad={i === 0 ? artLoaded : undefined} />
      ))}
      {BODIES.map((b, k) => (
        <Body key={k} s={s} k={k} run={run} out={out} />
      ))}
    </View>
  );
}

type Props = { s: Scene; run: SharedValue<number>; out: SharedValue<number> };

/** The Sage glow behind the word, coming up with it and going as the O comes forward. */
function Glow({ s, run, out }: Props) {
  const size = s.width * 1.5;
  const style = useAnimatedStyle(() => ({ opacity: glowOpacity(run.value, out.value) }));
  return (
    <Animated.View style={[styles.abs, { left: s.cx - size / 2, top: s.cy - size / 2, width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="splashGlow" cx="0.5" cy="0.5" r="0.5">
            <Stop offset={0} stopColor={color.accent} stopOpacity={0.26} />
            <Stop offset={0.55} stopColor={color.accent} stopOpacity={0.08} />
            <Stop offset={1} stopColor={color.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#splashGlow)" />
      </Svg>
    </Animated.View>
  );
}

/**
 * The rings, in the accent, behind the letters: each a dash as long as its first body has gone, until it closes (a
 * whole lap, ending on its own start; a closed path, so the ends join). They fade as one as everything is pulled
 * into the O.
 */
function Rings({ s, run, out }: Props) {
  const style = useAnimatedStyle(() => ({ opacity: ringsOpacity(out.value) }));
  return (
    <Animated.View style={[styles.abs, s.box, style]}>
      <Svg width={s.box.width} height={s.box.height}>
        {s.rings.map((_, r) => (
          <Drawing key={r} s={s} r={r} run={run} />
        ))}
      </Svg>
    </Animated.View>
  );
}

function Drawing({ s, r, run }: { s: Scene; r: number; run: SharedValue<number> }) {
  const g = s.rings[r];
  const L = g.length;
  // Runs on the intro's clock (Rings is given it), so once the ring has closed this stops and the SVG is left alone.
  const dash = useAnimatedProps(() => {
    const drawn = ringDrawn(s, r, run.value);
    return { strokeDasharray: [Math.max(drawn, 0.001), Math.max(L - drawn, 0.001)] };
  });
  return <AnimatedPath d={g.d} fill="none" stroke={color.accent} strokeOpacity={g.opacity} strokeWidth={1.2} strokeLinejoin="round" animatedProps={dash} />;
}

/** A letter rising in; at the exit R B I T are pulled into the O, and the O, its shadowless twin taking over, zooms. */
function Letter({ s, i, run, out, onLoad }: Props & { i: number; onLoad?: () => void }) {
  const l = s.letters[i];
  const box = { left: l.left, top: l.top, width: l.width, height: l.height };
  const origin = i === 0 ? [s.o.originX, s.o.originY, 0] : undefined;
  const style = useAnimatedStyle(() => {
    const f = letterFrame(s, i, run.value, out.value);
    return { opacity: f[3], transform: [{ translateX: f[0] }, { translateY: f[1] }, { scale: f[2] }] };
  });
  const shadowed = useAnimatedStyle(() => ({ opacity: 1 - letterFrame(s, i, run.value, out.value)[4] }));
  const zoom = useAnimatedStyle(() => ({ opacity: letterFrame(s, i, run.value, out.value)[4] }));
  const size = { width: l.width, height: l.height };
  return (
    <Animated.View style={[styles.abs, box, { zIndex: 2, transformOrigin: origin }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, i === 0 && shadowed]}>
        <Image source={LETTER_ART[i]} style={size} onLoad={onLoad && (() => onLoad())} />
      </Animated.View>
      {i === 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, zoom]}>
          <Image source={O_ZOOM_ART} style={size} onLoad={onLoad && (() => onLoad())} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

/** A symbol riding its ring, behind the word round the back, nearer and brighter in front. */
function Body({ s, k, run, out }: Props & { k: number }) {
  const b = BODIES[k];
  const half = b.half * b.size;
  const style = useAnimatedStyle(() => {
    const f = bodyFrame(s, k, run.value, out.value);
    return { opacity: f[3], zIndex: f[4], transform: [{ translateX: f[0] - half }, { translateY: f[1] - half }, { scale: f[2] }] };
  });
  return (
    <Animated.View style={[styles.abs, { width: 2 * half, height: 2 * half }, style]}>
      <Image source={BODY_ART[b.art]} style={{ width: 2 * half, height: 2 * half }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Above Home until it removes itself.
  root: { ...StyleSheet.absoluteFill, zIndex: 2000, elevation: 2000 },
  ground: { backgroundColor: color.ground },
  abs: { position: 'absolute', left: 0, top: 0 },
});
