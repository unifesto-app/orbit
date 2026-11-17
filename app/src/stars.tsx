// The splash photo's fine dots, one wave at a time: on the mode switcher (src/app/switch.tsx) and on Galaxy's lock
// (owner, 16 Nov 2026: "add space dots from switch screen"), and on Account's glass panel. Where they sit and how they
// move is src/switchMotion.ts. Each dot is a plain round view, not an SVG circle (owner, 17 Nov 2026: "Draw dots as
// Views"): an SVG keeps a bitmap the size of its whole box, six layers of them about 70 MB a screen, while a round
// view is a layer the GPU draws with nothing kept. A view's box snaps to whole pixels, which would make dots of one size
// come out a speck or a block, so each is a DOT-point circle scaled to its size: a scale isn't snapped.
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { type Star, starLayerOpacity, starLayerTurn } from './switchMotion';
import { stoneAt } from './theme';

const DOT = 8; // whole pixels at every common screen scale (1.5x to 3.5x), so its edges snap together and it stays round

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
          style={[styles.dot, { left: s.x - DOT / 2, top: s.y - DOT / 2, backgroundColor: stoneAt(s.o), transform: [{ scale: (2 * s.r) / DOT }] }]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2 } });
