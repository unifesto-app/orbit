// The splash photo's fine dots, one wave at a time: on the mode switcher (src/app/switch.tsx) and on Galaxy's lock
// (owner, 16 Nov 2026: "add space dots from switch screen"). Where they sit and how they move is src/switchMotion.ts.
import { StyleSheet } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { type Star, starLayerOpacity, starLayerTurn } from './switchMotion';

// One wave of dots. Squash, rotate, unsquash about the screen's centre moves every dot along its own ellipse round it.
export function StarLayer({ layer, dots, open, flat }: { layer: number; dots: Star[]; open: SharedValue<number>; flat: number }) {
  const style = useAnimatedStyle(() => ({
    opacity: starLayerOpacity(layer, open.value),
    transform: [{ scaleY: flat }, { rotate: `${starLayerTurn(layer, open.value)}deg` }, { scaleY: 1 / flat }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg style={StyleSheet.absoluteFill}>
        {dots.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#FFFFFF" fillOpacity={s.o} />
        ))}
      </Svg>
    </Animated.View>
  );
}
