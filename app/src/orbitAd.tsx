// Orbit's own ad, on Home and Search (owner, 19 Nov 2026: "its orbit ads like card promotion or any other promotion,
// full width, less height banners", "it may be anything", "reduce the height of strip", "add one strip in search",
// "add one in account", "move it after your events"): a
// strip four and a half times as wide as it's tall, on the page's 20 margins, 40 below what's above it. One line each
// for kicker, title and line, in the ad's own colour, its words in Stone or Charcoal to suit it; two tilted crossing
// orbits with a pearl at the right (the kit's orbits, never bullseye rings). Opens its link, if it has one. Not a host's
// boost, so no Promoted. The ads themselves are staff's, from Galaxy's App content (src/content.ts), filled with one of
// the brand's fills by name.
// `symbols` (Account; owner, 19 Nov 2026: "bring symbols and orbit in card in account screen", "dont add animation"):
// the splash's three tilted rings instead, still, with the pearl, spark, star and heart resting on them, smaller and
// dimmer round the back as on the splash (src/splash/motion.ts).
import type { Ad } from '@orbit/contract';
import { palette } from '@orbit/tokens';
import { router } from 'expo-router';
import { Image, type ImageSourcePropType, Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G } from 'react-native-svg';

import { Glass } from './glass';
import { around, color, darkInkOn, font, groundAt, radius, rim, space } from './theme';

// The card corners every Home card nests (its contents' 6, the small gap, then the frosted rim).
const FACE = around(radius.sm, space.small);
const PAD = 16; // a text card's padding
const MAX_TEXT = 1.15; // how far the words grow with the phone's text size: 51pt of lines stay inside 64

// The splash's rings (radius as a share of the scene, tilt back, turn in the plane, opacity), and where each symbol
// rests: its ring, its angle round it (past 180 is round the back), and its size as a share of the strip's height.
const RINGS = [
  { r: 0.62, tilt: 74, turn: -12, opacity: 0.6 },
  { r: 0.5, tilt: 58, turn: 24, opacity: 0.7 },
  { r: 0.78, tilt: 76, turn: -28, opacity: 0.5 },
];
const SYMBOLS: { art: ImageSourcePropType; ring: number; at: number; size: number }[] = [
  { art: require('../assets/splash/sym-heartSmall.png'), ring: 1, at: 160, size: 0.27 },
  { art: require('../assets/splash/sym-pearl.png'), ring: 0, at: 290, size: 0.2 },
  { art: require('../assets/splash/sym-spark.png'), ring: 1, at: 20, size: 0.25 },
  { art: require('../assets/splash/sym-star.png'), ring: 2, at: -20, size: 0.25 },
];
const BACK_SCALE = 0.76; // the splash's: round the back a symbol is this much of its near self
const BACK_OPACITY = 0.55;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The still rings and symbols at the strip's right, `tall` high, centred at (cx, cy). */
function Symbols({ inner, tall, cx, cy, stroke }: { inner: number; tall: number; cx: number; cy: number; stroke: string }) {
  const scene = tall * 0.92;
  const shape = RINGS.map((g) => ({ ...g, rx: g.r * scene, ry: g.r * scene * Math.cos(rad(g.tilt)) }));
  // A point `at` degrees round ring `g`, turned with it; the lower half is the near side.
  const point = (g: (typeof shape)[number], at: number) => {
    const [c, s, turn] = [Math.cos(rad(at)), Math.sin(rad(at)), rad(g.turn)];
    return { x: cx + g.rx * c * Math.cos(turn) - g.ry * s * Math.sin(turn), y: cy + g.rx * c * Math.sin(turn) + g.ry * s * Math.cos(turn), near: s >= 0 };
  };
  return (
    <>
      <Svg style={StyleSheet.absoluteFill} width={inner} height={tall} pointerEvents="none">
        {shape.map((g) => (
          <G key={g.turn} rotation={g.turn} origin={`${cx}, ${cy}`}>
            <Ellipse cx={cx} cy={cy} rx={g.rx} ry={g.ry} stroke={stroke} strokeOpacity={g.opacity} strokeWidth={1.2} fill="none" />
          </G>
        ))}
      </Svg>
      {SYMBOLS.map((b, i) => {
        const p = point(shape[b.ring]!, b.at);
        const size = b.size * tall * (p.near ? 1 : BACK_SCALE);
        return (
          <Image
            key={i}
            source={b.art}
            accessible={false}
            style={{ position: 'absolute', left: p.x - size / 2, top: p.y - size / 2, width: size, height: size, opacity: p.near ? 1 : BACK_OPACITY }}
          />
        );
      })}
    </>
  );
}

// `style` changes its place (Account spaces it 24, as its untitled groups).
export function OrbitAdStrip({
  ad,
  width,
  style,
  symbols = false,
}: {
  ad: Ad;
  width: number;
  style?: StyleProp<ViewStyle>;
  symbols?: boolean;
}) {
  const inner = width - 2 * rim;
  // Never shorter than its three lines at their largest (MAX_TEXT), so a small phone or bigger text doesn't clip them.
  // An image strip (owner, 19 Nov 2026: "Ad strips image uplaod also instead of text") is exactly 4.5:1, its upload's
  // shape, with no words to fit.
  const tall = ad.image ? inner / 4.5 : Math.max(Math.round(inner / 4.5), 64);
  const bg = palette[ad.colour]; // under an image too, while it loads
  const dark = darkInkOn(bg);
  const ink = dark ? groundAt(1) : color.text;
  const rx = tall * 0.8; // the orbits' half-width, kept inside the strip with the pearl
  const cx = inner - tall * 0.95;
  const cy = tall / 2;
  return (
    <Pressable
      disabled={!ad.href}
      onPress={() => ad.href && router.push(ad.href)}
      accessibilityRole={ad.href ? 'button' : ad.image ? 'image' : undefined}
      accessibilityLabel={ad.image ? ad.title : [ad.kicker, ad.title, ad.line].join('. ')}
      style={({ pressed }) => [styles.place, style, pressed && styles.pressed]}>
      <Glass style={[styles.rim, { width }]}>
        <View style={[styles.strip, { height: tall, backgroundColor: bg }]}>
          {ad.image ? (
            <Image source={{ uri: ad.image }} resizeMode="cover" accessible={false} style={StyleSheet.absoluteFill} />
          ) : symbols ? (
            // Sage rings, as the splash draws them, on a dark strip; the ad's own ink on a light one.
            <Symbols inner={inner} tall={tall} cx={cx} cy={cy} stroke={dark ? ink : color.accent} />
          ) : (
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
          )}
          {!ad.image && (
            <View style={styles.text}>
              <Text style={[styles.kicker, { color: ink }]} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT}>{ad.kicker}</Text>
              <Text style={[styles.title, { color: ink }]} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT}>{ad.title}</Text>
              <Text style={[styles.line, { color: ink }]} numberOfLines={1} maxFontSizeMultiplier={MAX_TEXT}>{ad.line}</Text>
            </View>
          )}
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
