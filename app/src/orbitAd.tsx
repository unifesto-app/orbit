// Orbit's own ad, on Home and Search (owner, 19 Nov 2026: "its orbit ads like card promotion or any other promotion,
// full width, less height banners", "it may be anything", "reduce the height of strip", "add one strip in search",
// "add one in account", "move it after your events"): a
// strip four and a half times as wide as it's tall, on the page's 20 margins, 40 below what's above it. One line each
// for kicker, title and line, in the ad's own colour, its words in Stone or Charcoal to suit it; two tilted crossing
// orbits with a pearl at the right (the kit's orbits, never bullseye rings). Opens its link, if it has one. Not a host's
// boost, so no Promoted. The ads themselves are `orbitAds` in src/mock.ts.
import { router } from 'expo-router';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G } from 'react-native-svg';

import { Glass } from './glass';
import type { OrbitAd } from './mock';
import { around, color, darkInkOn, font, groundAt, radius, rim, space } from './theme';

// The card corners every Home card nests (its contents' 6, the small gap, then the frosted rim).
const FACE = around(radius.sm, space.small);
const PAD = 16; // a text card's padding

// `style` changes its place (Account spaces it 24, as its untitled groups).
export function OrbitAdStrip({ ad, width, style }: { ad: OrbitAd; width: number; style?: StyleProp<ViewStyle> }) {
  const inner = width - 2 * rim;
  const tall = Math.round(inner / 4.5);
  const ink = darkInkOn(ad.bg) ? groundAt(1) : color.text;
  const rx = tall * 0.8; // the orbits' half-width, kept inside the strip with the pearl
  const cx = inner - tall * 0.95;
  const cy = tall / 2;
  return (
    <Pressable
      disabled={!ad.href}
      onPress={() => ad.href && router.push(ad.href)}
      accessibilityRole={ad.href ? 'button' : undefined}
      accessibilityLabel={`${ad.kicker}. ${ad.title}. ${ad.line}`}
      style={({ pressed }) => [styles.place, style, pressed && styles.pressed]}>
      <Glass style={[styles.rim, { width }]}>
        <View style={[styles.strip, { height: tall, backgroundColor: ad.bg }]}>
          <Svg style={StyleSheet.absoluteFill} width={inner} height={tall} pointerEvents="none">
            {[-22, 26].map((turn) => (
              <G key={turn} rotation={turn} origin={`${cx}, ${cy}`}>
                <Ellipse cx={cx} cy={cy} rx={rx} ry={tall * 0.22} stroke={ink} strokeOpacity={0.24} strokeWidth={1.5} fill="none" />
              </G>
            ))}
            <G rotation={-22} origin={`${cx}, ${cy}`}>
              <Circle cx={cx + rx} cy={cy} r={4} fill={ink} fillOpacity={0.6} />
            </G>
          </Svg>
          <View style={styles.text}>
            <Text style={[styles.kicker, { color: ink }]} numberOfLines={1}>{ad.kicker}</Text>
            <Text style={[styles.title, { color: ink }]} numberOfLines={1}>{ad.title}</Text>
            <Text style={[styles.line, { color: ink }]} numberOfLines={1}>{ad.line}</Text>
          </View>
        </View>
      </Glass>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  place: { marginTop: 40, marginHorizontal: 20 },
  pressed: { opacity: 0.7 },
  rim: { padding: rim, borderRadius: around(FACE, rim) },
  // The words keep clear of the orbits on the right.
  strip: { borderRadius: FACE, overflow: 'hidden', paddingHorizontal: PAD, justifyContent: 'center' },
  text: { maxWidth: '64%', gap: 1 },
  kicker: { fontFamily: font.medium, fontSize: 11, lineHeight: 14, opacity: 0.75 },
  title: { fontFamily: font.title, fontSize: 16, lineHeight: 20 },
  line: { fontFamily: font.text, fontSize: 12, lineHeight: 15, opacity: 0.8 },
});
