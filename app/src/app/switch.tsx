// The mode switcher (owner, 16 Nov 2026: "when home is clicked in tab nav open a modal with Home Console Galaxy", then
// "need animated screen instead of just switching in modal"): a whole screen fading in over the app from re-tapping the
// first tab of any mode (retap in src/modeKit.tsx): frosted glass, darkened. Home is the attendee app;
// Console is host management, or "Host an event" for someone on no team, which opens the Event Request that Orbit staff
// approve first (account/host, src/requests.ts); Galaxy is for staff
// with at least one feature (src/modes.ts; Roles doc).
// Cards made as Search's Explore cards ("make them small and replace the icons same as explore, even card should be
// same as explore cards"): a drawing seated on the top rim, the face in its colour glowing up from the bottom, the name
// inside. On an orbit ("like in an orbit sliding b/w them, center will be the current one so the switched one comes
// center", "make the orbit attached perfectly", "hide the orbit back of other two"): the current mode in front at the
// centre, the others round the back, smaller and higher, on a faint ring through every card's centre. On opening the
// others come out from behind the current card ("into should be same coming out from back of current one"), and the
// splash photo's fine dots gather across the page in waves, each wave sweeping in round the centre along ellipses
// shaped like the cards' orbit ("out should be accumulating the space dots same as splash screen photo", "the
// accumulate should be in orbit path only", "why dots on orbit. should spread across page").
// Picking one turns the orbit slowly ("make the animation slow") until it's at the centre; then, as the splash's O does
// ("animation should be like launch and zoom out the card same as o zooms out in splash"), the others are pulled into
// it and it zooms out past the screen while the dots rush out and the backdrop lifts off the new mode, which has
// been put underneath. The motion is src/switchMotion.ts. With Reduce Motion on, it just fades to the new mode.
// Home always stays at the bottom of the stack: a mode sits on top of it, so back from a mode lands on Home.
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, type SharedValue, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Glass } from '../glass';
import { type Mode, type Third, modesFor } from '../modes';
import { SeatCard } from '../rows';
import { useMe } from '../session';
import { EXIT, OPEN_END, SLIDE, STEP, type Star, backdropOpacity, cardFrame, dustFrame, ringOpacity, starLayerOpacity, starLayerTurn, starLayers } from '../switchMotion';
import { color, font, space } from '../theme';
import { Wordmark } from '../wordmark';

// Made as Explore's are (owner: "create home console and galaxy svgs", "also for host event, use same process"): Canva AI
// line art, picked one by one ("for home use home", "for galaxy planet + orbit only", "for console - gear", "gear and
// wrench", "for host an event star ( 4 edged ) resembles plus"), on pages 12 to 15 of the Canva design "Orbit Explore
// elements", then cut out and tinted in the card's colour by scripts/explore-art.cjs.
const ART = {
  home: require('../../assets/modes/home.png'),
  console: require('../../assets/modes/console.png'),
  host: require('../../assets/modes/host.png'),
  galaxy: require('../../assets/modes/galaxy.png'),
  checkin: require('../../assets/modes/checkin.png'),
  saved: require('../../assets/modes/saved.png'),
};
// Each drawing fills its square to a different height (the planet is wide and short, 480 × 288), so they're scaled to
// cover about the same area, as Explore's ART_SCALE does (owner: "adjust the size of svgs, maintain same size galaxy
// looks small"). The square root of each one's area, against the gear and wrench's.
const ART_SCALE: Partial<Record<string, number>> = { galaxy: 1.25, home: 1.08, checkin: 1.2 };

// `route` is the root stack's screen the mode is.
type Item = { key: string; label: string; art: ImageSourcePropType; tint: string; route: string };

// The third card, which fits the person (src/modes.ts): Galaxy for staff, Check-in for hosts, Saved for everyone else
// (owner, 16 Nov 2026: "Host approved", "use Checkin", "General users - Saved events ( svg - love heart )", "use red for
// saved"): Saved in the app's love red, a saved event's heart. Host an event is yellow (Explore's comedy yellow; owner:
// "change the color of host an event to yellow"), so the two never sit side by side in red.
const THIRD: Record<Third, Item> = {
  galaxy: { key: 'galaxy', label: 'Galaxy', art: ART.galaxy, tint: '#7598FF', route: 'galaxy' },
  checkin: { key: 'checkin', label: 'Check-in', art: ART.checkin, tint: '#E8590C', route: 'checkin' },
  saved: { key: 'saved', label: 'Saved', art: ART.saved, tint: color.love, route: 'account/saved' },
};

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

export default function Switch() {
  const { from = 'home' } = useLocalSearchParams<{ from?: Mode }>();
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const modes = modesFor(useMe()); // signed out: Home, Host an event and Saved, each asking to sign in where it needs to
  const items: Item[] = [
    { key: 'home', label: 'Home', art: ART.home, tint: color.accent, route: '(tabs)' },
    modes.console === 'open'
      ? { key: 'console', label: 'Console', art: ART.console, tint: '#099268', route: 'console' }
      : { key: 'host', label: 'Host an event', art: ART.host, tint: '#FCC419', route: 'account/host' },
    THIRD[modes.third],
  ];
  const start = Math.max(0, items.findIndex((it) => it.key === from));

  const open = useSharedValue(0);
  const turn = useSharedValue(start);
  const picked = useSharedValue(-1);
  const out = useSharedValue(0);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    open.value = withTiming(OPEN_END, { duration: OPEN_END * 1000, easing: Easing.linear });
  }, [open]);

  // The front card, as big as lets the side cards (at 70%, their centres 95% of a card out) stay on screen.
  const card = Math.min(140, Math.floor((width / 2 - 12) / 1.3));
  const orbit = (card * 0.95) / Math.sin(STEP);
  // How much higher the back of the orbit sits than the front: tilted enough that the ring shows above the front card
  // and runs through every card's centre, so the cards sit on it.
  const lift = Math.round(card * 0.85);
  const tall = card / 2 + 2 + ((card - 4) * 3) / 4 + 4; // SeatCard's height at this width
  // The orbit's path in its box: every card's centre rides this ellipse. Its centre is the screen's, which the dots'
  // orbits share, squashed alike (`flat`, height over width).
  const cx = width / 2;
  const cy = lift / 2 + tall / 2;
  const flat = lift / 2 / orbit;
  const [stars] = useState(() => starLayers(width, height));

  // The new mode goes in under this screen, with Home kept at the bottom, so the exit reveals it; then this screen goes.
  const putUnder = (route: string) => {
    const state = navigation.getState();
    if (!state) return;
    const base = state.routes[0]; // Home's tabs, always at the bottom (the root's anchor)
    const self = state.routes[state.index];
    const routes = route === base.name ? [base, self] : [base, { name: route }, self];
    // expo-router 58 takes only a complete state (stale: false, key, routeNames, routeKeySeq): the current one with
    // these routes, where it mints the new mode's key itself. A partial one is ignored with a warning.
    navigation.reset({ ...state, index: routes.length - 1, routes } as never);
  };
  const close = () => router.back();
  const launch = (i: number) => {
    putUnder(items[i].route);
    picked.value = i;
    out.value = withTiming(EXIT, { duration: EXIT * 1000, easing: Easing.linear }, (ok) => {
      if (ok) scheduleOnRN(close);
    });
  };
  const pick = (i: number) => {
    if (moving) return;
    if (i === start) return close(); // already here
    setMoving(true);
    if (reduced) {
      putUnder(items[i].route);
      return close();
    }
    // The short way round: on three places a step of two is one step back.
    const n = items.length;
    let d = (((i - start) % n) + n) % n;
    if (d > n / 2) d -= n;
    turn.value = withTiming(start + d, { duration: SLIDE * 1000, easing: Easing.inOut(Easing.poly(4)) }, (ok) => {
      if (ok) scheduleOnRN(launch, i);
    });
  };

  const backdrop = useAnimatedStyle(() => ({ opacity: backdropOpacity(out.value) }));
  const dustStyle = useAnimatedStyle(() => {
    const [o, s] = dustFrame(out.value);
    return { opacity: o, transform: [{ scale: s }] };
  });
  const ring = useAnimatedProps(() => ({ strokeOpacity: ringOpacity(out.value) }));

  return (
    <View style={styles.screen}>
      {/* Faded as one, never the glass itself. */}
      <Animated.View style={[StyleSheet.absoluteFill, backdrop]} pointerEvents="none">
        <Glass style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.shade]} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, dustStyle]} pointerEvents="none">
        {stars.map((layer, k) => (
          <StarLayer key={k} layer={k} dots={layer} open={open} flat={flat} />
        ))}
      </Animated.View>
      {/* No close button (owner: "no need of a close button"): a tap anywhere off the cards, or on the centre one, goes
          back where you were; so does Android's back. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => !moving && close()} accessibilityLabel="Close" />
      <View style={styles.middle} pointerEvents="box-none">
        <View style={{ width, height: tall + lift }} pointerEvents="box-none">
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <AnimatedEllipse
              cx={cx}
              cy={cy}
              rx={orbit}
              ry={lift / 2}
              stroke="#FFFFFF"
              strokeWidth={1}
              fill="none"
              opacity={0.16}
              animatedProps={ring}
            />
          </Svg>
          {items.map((it, i) => (
            <OrbitCard
              key={it.key}
              index={i}
              turn={turn}
              picked={picked}
              out={out}
              open={open}
              start={start}
              width={card}
              orbit={orbit}
              lift={lift}
              item={it}
              current={i === start}
              onPress={() => pick(i)}
            />
          ))}
        </View>
      </View>
      {/* "Switch" at the top centre in Explore's script (owner: "add top center Switch with same font as explore"): Sacramento
          has one thin weight, so as on Search a second copy 0.8pt lower, each with a crisp shadow, thickens it. */}
      <Animated.View style={[styles.head, { top: insets.top + space.big }, backdrop]} pointerEvents="none">
        <Text style={styles.script} accessibilityRole="header">
          Switch
        </Text>
        <Text style={[styles.script, styles.scriptCopy]} accessible={false} importantForAccessibility="no">
          Switch
        </Text>
      </Animated.View>
      {/* The ORBIT wordmark at the foot (owner: "add orbit logo at bottom"), as at the foot of Account. */}
      <Animated.View style={[styles.foot, { bottom: insets.bottom + space.big }, backdrop]} pointerEvents="none">
        <Wordmark width={120} />
      </Animated.View>
    </View>
  );
}

// One wave of dots. Squash, rotate, unsquash about the screen's centre moves every dot along its own ellipse round it.
function StarLayer({ layer, dots, open, flat }: { layer: number; dots: Star[]; open: SharedValue<number>; flat: number }) {
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

function OrbitCard({
  index,
  turn,
  picked,
  out,
  open,
  start,
  width,
  orbit,
  lift,
  item,
  current,
  onPress,
}: {
  index: number;
  turn: SharedValue<number>;
  picked: SharedValue<number>;
  out: SharedValue<number>;
  open: SharedValue<number>;
  start: number;
  width: number;
  orbit: number;
  lift: number;
  item: Item;
  current: boolean;
  onPress: () => void;
}) {
  const style = useAnimatedStyle(() => {
    const [x, y, s, o, z] = cardFrame(index, turn.value, picked.value, out.value, orbit, lift, open.value, start);
    // On the orbit a card is never faded, so the ring is hidden behind every card; only the exit fades them.
    return { zIndex: z, opacity: o, transform: [{ translateX: x }, { translateY: y }, { scale: s }] };
  });
  const size = Math.round(width * 0.62); // Explore's drawing size
  return (
    <Animated.View style={[styles.slot, { top: lift, width, marginLeft: -width / 2 }, style]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: current }}>
        <SeatCard
          width={width}
          size={size}
          tint={item.tint}
          dome={false}
          seat={<Image source={item.art} style={{ width: size, height: size, transform: [{ scale: ART_SCALE[item.key] ?? 1 }] }} />}>
          <View style={styles.text}>
            {/* Shrinks further than Explore's names, so "Host an event" fits. */}
            <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {item.label}
            </Text>
          </View>
        </SeatCard>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  shade: { backgroundColor: `${color.ground}B3` }, // the ground at 70% over the glass
  middle: { ...StyleSheet.absoluteFill, justifyContent: 'center' },
  foot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  head: { position: 'absolute', left: 0, right: 0 },
  // As Search's Explore title. No lineHeight: anything under Sacramento's natural height clips its capitals.
  script: {
    fontFamily: font.script,
    fontSize: 44,
    color: color.text,
    textAlign: 'center',
    textShadowColor: color.text,
    textShadowOffset: { width: 0.8, height: 0 },
    textShadowRadius: 0.1, // Android draws no shadow at 0
  },
  scriptCopy: { position: 'absolute', top: 0.8, left: 0, right: 0 },
  slot: { position: 'absolute', left: '50%' },
  // As Explore's: the name centred in the face below the drawing.
  text: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space.small },
  name: { fontFamily: font.title, fontSize: 16, color: color.text, textAlign: 'center' },
});
