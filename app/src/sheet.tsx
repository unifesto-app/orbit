// What the sign-in sheet (src/app/login.tsx) and the confirm-it's-you sheet (src/app/account/verify.tsx) share: the
// glass frame with its scene, title and X, the WhatsApp number, two-answer questions, and the Continue with Google or
// Apple pills (confirm-it's-you only now: sign-in's ways in are rows in a card). The 6-digit code is Account's (Code in
// src/account/kit.tsx).
import { type ComponentRef, type ReactNode, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Ellipse, G, Path } from 'react-native-svg';

import { Field, Pill, styles as kit } from './account/kit';
import { Glass } from './glass';
import { OrbitSays } from './orbitSays';
import { CloseButton, GlassFill, Glow } from './rows';
import { readPhone } from './signin';
import { BACK_OPACITY, BACK_SCALE, MARK, RINGS } from './splash/motion';
import { color, font, space } from './theme';
import { Wordmark } from './wordmark';

// The sheet's scene (sign-in Take 1 "In orbit", owner, 25 Nov 2026: "Build Take 1"): the splash's 3D word in its three
// tilted rings, with the star, pearl, spark and heart at rest on them, two on the near side below the word and two
// round the back above it, smaller and dimmer as on the splash. Still: nothing moves. Full size on a sheet's first step
// (`big`), 0.6 after it, so a code or a number still clears the keyboard. Drawn on a 390-wide box, centred.
const SCENE = 390;
const AT_REST = [
  { art: require('../assets/splash/sym-star.png'), ring: 2, at: 150, size: 40 },
  { art: require('../assets/splash/sym-pearl.png'), ring: 2, at: -20, size: 40 },
  { art: require('../assets/splash/sym-spark.png'), ring: 1, at: 60, size: 40 },
  { art: require('../assets/splash/sym-heartSmall.png'), ring: 1, at: 240, size: 36 },
];
const rad = (deg: number) => (deg * Math.PI) / 180;
function Scene({ big }: { big: boolean }) {
  const s = big ? 1 : 0.6;
  const height = Math.round(170 * s);
  const [cx, cy] = [SCENE / 2, 84 * s];
  const wordW = 180 * s;
  const wordH = (MARK.h * wordW) / MARK.w;
  const rings = RINGS.map((g) => {
    const rx = g.r * SCENE * 0.42 * s; // the splash's ring sizes, brought in round the word
    return { ...g, rx, ry: rx * Math.cos(rad(g.tilt)) };
  });
  return (
    <View style={[styles.scene, { height }]}>
      <Svg style={StyleSheet.absoluteFill} width={SCENE} height={height} pointerEvents="none">
        {rings.map((g) => (
          <G key={g.turn} rotation={g.turn} origin={`${cx}, ${cy}`}>
            <Ellipse cx={cx} cy={cy} rx={g.rx} ry={g.ry} stroke={color.accent} strokeOpacity={g.opacity} strokeWidth={1} fill="none" />
          </G>
        ))}
      </Svg>
      <View style={[styles.sceneWord, { left: cx - wordW / 2, top: cy - wordH / 2 }]}>
        <Wordmark width={wordW} />
      </View>
      {AT_REST.map((b) => {
        const g = rings[b.ring]!;
        const [c, sin, turn] = [Math.cos(rad(b.at)), Math.sin(rad(b.at)), rad(g.turn)];
        const near = sin > 0; // the lower half of a ring is its near side, in front of the word
        const size = b.size * s * (near ? 1 : BACK_SCALE);
        const x = cx + g.rx * c * Math.cos(turn) - g.ry * sin * Math.sin(turn);
        const y = cy + g.rx * c * Math.sin(turn) + g.ry * sin * Math.cos(turn);
        return (
          <Image
            key={b.at}
            source={b.art}
            accessible={false}
            style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, zIndex: near ? 3 : 1, opacity: near ? 1 : BACK_OPACITY }}
          />
        );
      })}
    </View>
  );
}

// The sheet, made as Account's panel is (owner, 17 Nov 2026: "feels generic. bring app screens kind
// ui"): the accent glowing from the top under the glass (no space dots since 19 Nov 2026), the scene over the title,
// centred, the X pinned at its top right. A gap
// at its top on iOS, full screen on Android clear of the status bar (as Sheet in rows.tsx), then the API's message when
// it said no. It scrolls, so the keyboard never covers a field or the Continue under it on a small phone.
export function Frame({
  title,
  note,
  error,
  big = false,
  children,
}: {
  title: string;
  note?: string;
  error?: string | null;
  big?: boolean; // the full scene, on the first step
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // The API's message shows under the title: scrolled down to a button (keyboard up on a small phone), go back up to it.
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (error) scroller.current?.scrollTo({ y: 0 });
  }, [error]);
  const top = Platform.OS === 'ios' ? space.big : insets.top + space.small;
  return (
    <View style={styles.screen}>
      <Glow />
      <GlassFill />
      {/* Before the page, so a screen reader reaches Close first; zIndex keeps it over the scroll. */}
      <View style={[styles.close, { top }]}>
        <CloseButton />
      </View>
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: insets.bottom + space.big }]}>
        <View>
          <Scene big={big} />
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {note && <Text style={styles.note}>{note}</Text>}
          </View>
        </View>
        {/* The API's message, said by Orbit in its bubble (the detail pages' Take 6, owner, 19 Nov 2026). */}
        {error && (
          <View accessibilityLiveRegion="polite">
            <OrbitSays top={0} text={error} />
          </View>
        )}
        {children}
      </ScrollView>
    </View>
  );
}

// Continue with Google or Apple: a frosted pill like every button, the company's mark beside a white label.
export function With({ label, mark, onPress, disabled = false }: { label: string; mark: ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Continue with ${label}`}
      accessibilityState={{ disabled }}
      style={[kit.grow, disabled && { opacity: 0.5 }]}
    >
      <Glass style={styles.way}>
        {mark}
        <Text style={styles.wayText}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

// Google's four-colour G, which its sign-in buttons must show.
export function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48" accessible={false}>
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

// Anyone who came in by email, Google or Apple adds a WhatsApp number: every account has a verified phone (decision 2).
export function Phone({ busy, onPhone }: { busy: boolean; onPhone: (e164: string) => void }) {
  const [text, setText] = useState('');
  const read = readPhone(text);
  const phone = read && read !== 'abroad' ? read : null;
  const go = () => phone && onPhone(phone);
  return (
    <View style={styles.body}>
      <View style={styles.block}>
        <Field
          label="WhatsApp number"
          prefix="+91"
          value={text}
          onChangeText={(t) => setText(t.replace(/^\s*\+91\s*/, ''))} // autofill brings its own +91; the field shows one already
          placeholder="98765 43210"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoFocus
        />
        {read === 'abroad' && <Text style={styles.line}>Orbit takes Indian (+91) numbers only.</Text>}
      </View>
      <Pill label="Send code on WhatsApp" size="wide" disabled={!phone || busy} onPress={go} />
    </View>
  );
}

// A question with two answers ("Yes, sign in" or "Not me, start fresh", "Add a passkey" or "Not now"), Orbit asking as
// Home's asks do (the detail pages' Take 6, owner, 19 Nov 2026): `say` in Orbit's bubble, the answers yours to tap. They
// were a wide pill and a grey one. While the tapped one is going (`busy`), it shows as your bubble with Orbit's "One
// moment…" and the answers go, so nothing else can be tapped; if it fails they come back (with the API's message).
// `ask` is the question itself, at the top of the bubble, when the sheet's title is something else (Take 1: after
// signing in the title says you're in, and Orbit asks).
export function Choice({
  yes,
  no,
  ask,
  say,
  busy,
  onYes,
  onNo,
  children,
}: {
  yes: string;
  no: string;
  ask?: string;
  say: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
  children?: ReactNode;
}) {
  const [tapped, setTapped] = useState<string>();
  const pick = (label: string, run: () => void) => () => {
    if (busy) return;
    setTapped(label);
    run();
  };
  const going = busy && tapped;
  return (
    <View style={styles.body}>
      {children}
      <OrbitSays
        top={0}
        title={ask}
        text={say}
        then={going ? { mine: tapped, reply: 'One moment…' } : undefined}
        answers={going ? [] : [{ label: yes, onPress: pick(yes, onYes) }, { label: no, onPress: pick(no, onNo) }]}
      />
    </View>
  );
}

const WAY = 50; // as tall as the wide pills

export const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: space.big },
  scene: { width: SCENE, alignSelf: 'center', marginBottom: space.small },
  sceneWord: { position: 'absolute', zIndex: 2 },
  head: { marginHorizontal: 20, alignItems: 'center' },
  close: { position: 'absolute', right: 20, zIndex: 4 },
  title: { fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text, textAlign: 'center' },
  note: { marginTop: 2, fontFamily: font.medium, fontSize: 14, color: color.secondary, textAlign: 'center' },
  body: { gap: space.small + 4 },
  block: { marginHorizontal: 20, gap: 6 },
  line: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  link: { color: color.text, textDecorationLine: 'underline' },
  pair: { marginHorizontal: 20, flexDirection: 'row', justifyContent: 'center', gap: space.small },
  way: { height: WAY, borderCurve: 'continuous', borderRadius: WAY / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.small },
  wayText: { fontFamily: font.title, fontSize: 14, color: color.text },
});
