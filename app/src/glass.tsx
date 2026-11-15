import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type ViewProps } from 'react-native';

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
  fallback: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
});
