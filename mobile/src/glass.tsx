import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type ViewProps } from 'react-native';

import { around, color, groundAt, radius, space, stoneAt } from './theme';

// The tab bar's dark glass, as `tint` (owner, 19 Nov 2026: "make bg glass, dark"). Since the Capsule take ("Both", 19
// Nov) it is also on Home's and Search's floating controls: the location, the profile, the carousel pill, the search
// box and chips, See all and the row stars. Buttons inside cards stay frosted.
export const DARK_TINT = groundAt(0.7);

// Real Liquid Glass needs iOS 26 (and the API, which some iOS 26 betas lack).
const GLASS = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

// Orbit's one glass (owner, 15 Nov 2026): frosted, first on View ticket ("implement frosted glass for view ticket"),
// then "to entire app". The native take on the Frosted Glass preset of liquid-glass.ybouane.com (blur, no darkening).
// Every button and floating control uses it, with a white label. Without iOS 26 glass, or with Reduce Transparency
// on, a light translucent fill. `tint` colours the glass, or is the fill without it (the tab bar's dark glass).
export function Glass({ style, children, tint, ...rest }: ViewProps & { tint?: string }) {
  const reduceTransparency = useAccessibility('reduceTransparencyChanged');
  return GLASS && !reduceTransparency ? (
    <GlassView glassEffectStyle="regular" colorScheme="dark" tintColor={tint} style={style} {...rest}>
      {children}
    </GlassView>
  ) : (
    <View style={[styles.fallback, tint !== undefined && { backgroundColor: tint }, style]} {...rest}>
      {children}
    </View>
  );
}

// Glass behind a pinned top bar once the page scrolls under it, on Search and Home (owner, 15 Nov 2026: "while
// scrolling add the glass bg", "round the bottom and dark it", "apply the same in home"). It fades in over the first
// 16pt of scroll, darkened by the page's ground at half, with its bottom corners round (the carousel's, 6 + 8). Native
// glass rounds every corner alike, so the shape runs BAR_CORNER up past the top of the screen, where its top corners
// can't be seen. Faded on a wrapper, never on the glass itself. Put it first inside the bar, which it fills.
const BAR_CORNER = around(radius.md, space.small);
export function BarGlass({ scrollY }: { scrollY: Animated.Value }) {
  const [opacity] = useState(() => scrollY.interpolate({ inputRange: [0, 16], outputRange: [0, 1], extrapolate: 'clamp' }));
  return (
    <Animated.View style={[styles.bar, { opacity }]}>
      <Glass style={styles.barFace} />
      <View style={styles.barShade} />
    </Animated.View>
  );
}

const settings = {
  reduceMotionChanged: () => AccessibilityInfo.isReduceMotionEnabled(),
  reduceTransparencyChanged: () => AccessibilityInfo.isReduceTransparencyEnabled(),
  screenReaderChanged: () => AccessibilityInfo.isScreenReaderEnabled(),
};

type Setting = keyof typeof settings;

// Orbit's own Reduce switches (the Orbit app's Appearance, owner 27 Nov 2026): on, Orbit acts as if the phone's were
// on. Either one on turns it on. The app saves them (app/src/glass.tsx); the host apps never set them.
const forced: Record<Setting, boolean> = { reduceMotionChanged: false, reduceTransparencyChanged: false, screenReaderChanged: false };
const listeners = new Set<() => void>();
export function forceAccessibility(event: Setting, on: boolean) {
  forced[event] = on;
  for (const fn of listeners) fn();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useForcedAccessibility = (event: Setting) => useSyncExternalStore(subscribe, () => forced[event]);

/** The setting as Orbit follows it: the phone's, or Orbit's own switch. */
export function useAccessibility(event: Setting) {
  const forcedOn = useForcedAccessibility(event);
  return usePhoneAccessibility(event) || forcedOn;
}

// A system accessibility switch, kept current while the screen is open.
export function usePhoneAccessibility(event: Setting) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    settings[event]().then(setOn);
    const sub = AccessibilityInfo.addEventListener(event, setOn);
    return () => sub.remove();
  }, [event]);
  return on;
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: -BAR_CORNER, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
  barFace: { flex: 1, borderRadius: BAR_CORNER },
  barShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: BAR_CORNER, backgroundColor: `${color.ground}80` },
  fallback: {
    backgroundColor: stoneAt(0.14),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: stoneAt(0.24),
  },
});
