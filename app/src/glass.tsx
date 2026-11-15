import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type ViewProps } from 'react-native';

import { around, color, radius, space } from './theme';

// Real Liquid Glass needs iOS 26 (and the API, which some iOS 26 betas lack).
const GLASS = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

// Orbit's one glass (owner, 15 Nov 2026): frosted, first on View ticket ("implement frosted glass for view ticket"),
// then "to entire app". The native take on the Frosted Glass preset of liquid-glass.ybouane.com (blur, no darkening).
// Every button and floating control uses it, with a white label. Without iOS 26 glass, or with Reduce Transparency
// on, a light translucent fill.
export function Glass({ style, children, ...rest }: ViewProps) {
  const reduceTransparency = useAccessibility('reduceTransparencyChanged');
  return GLASS && !reduceTransparency ? (
    <GlassView glassEffectStyle="regular" colorScheme="dark" style={style} {...rest}>
      {children}
    </GlassView>
  ) : (
    <View style={[styles.fallback, style]} {...rest}>
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

// A system accessibility switch, kept current while the screen is open.
export function useAccessibility(event: keyof typeof settings) {
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
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
});
