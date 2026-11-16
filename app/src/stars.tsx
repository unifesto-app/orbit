// The splash photo's fine dots, one wave at a time: on the mode switcher (src/app/switch.tsx) and on Galaxy's lock
// (owner, 16 Nov 2026: "add space dots from switch screen"), and on Account's glass panel. Where they sit and how they
// move is src/switchMotion.ts. Each dot is a plain round view, not an SVG circle (owner, 17 Nov 2026: "Draw dots as
// Views"): an SVG keeps a bitmap the size of its whole box, six layers of them about 70 MB a screen, while a round
// view is a layer the GPU draws with nothing kept.
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { type Star, starLayerOpacity, starLayerTurn } from './switchMotion';

// One wave of dots. Squash, rotate, unsquash about the screen's centre moves every dot along its own ellipse round it.
export function StarLayer({ layer, dots, open, flat }: { layer: number; dots: Star[]; open: SharedValue<number>; flat: number }) {
  const style = useAnimatedStyle(() => ({
    opacity: starLayerOpacity(layer, open.value),
    transform: [{ scaleY: flat }, { rotate: `${starLayerTurn(layer, open.value)}deg` }, { scaleY: 1 / flat }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      {dots.map((s, i) => (
        <View
          key={i}
          style={[styles.dot, { left: s.x - s.r, top: s.y - s.r, width: 2 * s.r, height: 2 * s.r, borderRadius: s.r, backgroundColor: `rgba(255, 255, 255, ${s.o})` }]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ dot: { position: 'absolute' } });
