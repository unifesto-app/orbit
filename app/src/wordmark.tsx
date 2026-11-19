// The ORBIT wordmark in 3D, the splash's own letters (assets/splash/mark-*.png: the kit's lighter body, raw gloss and
// Night shadow, rendered from web/src/app/brand.tsx), laid out by the kit's letter positions (LETTERS in
// src/splash/motion.ts), so there is one source for the logo. At the foot of Account (owner, 16
// Nov 2026: "add orbit logo at bottom"; 19 Nov: "in bottom orbit wordmark update it", from the flat letters) and over
// the sign-in sheet's title. The splash loads these images first, so they're ready by the time anything shows them.
import { Image, View } from 'react-native';

import { LETTERS, MARK, PAD } from './splash/motion';

const ART = [
  require('../assets/splash/mark-o.png'),
  require('../assets/splash/mark-r.png'),
  require('../assets/splash/mark-b.png'),
  require('../assets/splash/mark-i.png'),
  require('../assets/splash/mark-t.png'),
];

// `width` is the word's, shadows aside: each letter's image runs PAD mark units past its box for its shadow, so the
// word overhangs its box a little on every side without moving anything round it.
export function Wordmark({ width }: { width: number }) {
  const m = width / MARK.w; // pt per mark unit
  return (
    <View style={{ width, height: MARK.h * m }} accessible accessibilityRole="image" accessibilityLabel="Orbit">
      {LETTERS.map((l, i) => (
        <Image
          key={l.name}
          source={ART[i]}
          style={{ position: 'absolute', left: (l.x0 - PAD - MARK.x) * m, top: -PAD * m, width: (l.x1 - l.x0 + 2 * PAD) * m, height: (MARK.h + 2 * PAD) * m }}
          accessibilityIgnoresInvertColors
        />
      ))}
    </View>
  );
}
