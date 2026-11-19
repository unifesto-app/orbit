// The app's tabs (owner, 15 Nov 2026: "add Tab Nav", "Home Search"), our own since 19 Nov 2026 (owner, from a reference
// AI app: "can i get same kind of tabs?", "make our own tab, that fits in both ios and android"): a glass capsule low on
// the screen, the open tab under a lighter pill with its icon and label side by side, and the chat orb beside it, the
// same on iOS and Android. The pill follows a finger dragged along the bar and settles on the tab it's let go over
// ("also need move with finger"). expo-router's headless tabs (expo-router/ui) switch the screens; the capsule is the
// TabList. The screens keep clear of it through the bottom safe area, which under the tabs includes the bar (Screens),
// so a screen pads its bottom by insets.bottom. Both hide while the keyboard is up, so Android doesn't lift them over it.
// Icons are Phosphor filled ("use filled instead of duotone"), the PNGs in assets/tabs made by scripts/icons.mjs: the
// open tab's in a Sage to Moss gradient, the others in the text colour ("move other gradiant to active, for other use
// text color"); the labels in DM Sans 600 ("add some font weight").
import { alpha, role } from '@orbit/tokens';
import { router, useIsFocused } from 'expo-router';
import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Keyboard,
  LayoutAnimation,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

// The capsule's and the orb's glass is dark (owner, 19 Nov 2026: "also need glass", "make bg glass, dark"); where there's
// no Liquid Glass it's the fill, dark enough that the page doesn't show through the labels.
import { useChatUsed } from '../../chatUsed';
import { DARK_TINT as DARK, Glass } from '../../glass';
import { BAR, barAfterScroll, barBottom, orbNudge, SIDE, TabBarScroll, TabBarSmall } from '../../tabBar';
import { color, font, stoneAt } from '../../theme';

const PAD = 4; // round the pill inside the capsule
const DISC = BAR - 8; // the orb's art inside its ring; scripts/chat-orb.cjs renders it at 44
const GAP = 10; // between the capsule and the orb

const TABS = [
  { name: 'index', href: '/', label: 'Home', icon: require('../../../assets/tabs/home.png'), on: require('../../../assets/tabs/home-on.png') },
  { name: 'search', href: '/search', label: 'Search', icon: require('../../../assets/tabs/search.png'), on: require('../../../assets/tabs/search-on.png') },
] as const;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottom = barBottom(insets.bottom, Platform.OS === 'ios');
  const keyboard = useKeyboardShown();
  const [small, onScroll, setSmall] = useShrink();
  const [open, setOpen] = useState(0); // the open tab, as its button reports it
  // A tab opens with the bar wide, so its top bar shows whole (Home's city line, Search's chips fold with the bar).
  useEffect(() => setSmall(false), [open, setSmall]);
  const { width } = useWindowDimensions();
  const slot = (width - SIDE - (SIDE + BAR + GAP) - 2 * PAD) / TABS.length; // one tab's width in the wide capsule
  const pill = usePill(slot, open, small);
  return (
    <Tabs style={styles.root}>
      <Screens bottom={bottom + BAR} onScroll={onScroll} small={small} />
      <TabList asChild>
        {/* One style object: TabList's Slot refuses an array on its child. Small, it's a circle round the open tab. */}
        <Glass
          {...pill.panHandlers}
          tint={DARK}
          style={StyleSheet.flatten([styles.capsule, { bottom }, small ? styles.small : styles.wide, keyboard && styles.hidden])}
        >
          {!small && <Animated.View style={[styles.pill, styles.slider, { width: slot, transform: [{ translateX: pill.x }] }]} />}
          {TABS.map((t, i) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton tab={t} index={i} small={small} onGrow={() => setSmall(false)} onOpen={setOpen} />
            </TabTrigger>
          ))}
        </Glass>
      </TabList>
      {!keyboard && <ChatOrb bottom={bottom} />}
      <OrbNudge tab={TABS[open].name} bottom={bottom} hidden={small || keyboard} />
    </Tabs>
  );
}

// The open tab's screen, told the bar's room as part of the bottom safe area, where to send its scroll and whether the
// bar is small (Home's and Search's top bars fold with it).
function Screens({ bottom, onScroll, small }: { bottom: number; onScroll: (y: number) => void; small: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, bottom }}>
      <TabBarScroll.Provider value={onScroll}>
        <TabBarSmall.Provider value={small}>
          <TabSlot />
        </TabBarSmall.Provider>
      </TabBarScroll.Provider>
    </SafeAreaInsetsContext.Provider>
  );
}

// The pill: it springs to the open tab, and a sideways drag on the bar carries it under the finger; let go, it settles
// on the nearest tab and opens it. A tap still goes to the tab under it; only a drag of more than 6pt moves the pill.
function usePill(slot: number, open: number, small: boolean) {
  const [x] = useState(() => new Animated.Value(open * slot));
  const settle = useCallback(
    (i: number) => Animated.spring(x, { toValue: i * slot, useNativeDriver: true, speed: 18, bounciness: 6 }).start(),
    [slot, x],
  );
  useEffect(() => settle(open), [open, settle]);
  const panHandlers = useMemo(() => {
    // From the open tab, under the finger, never past the first or last tab.
    const under = (dx: number) => Math.min(Math.max(open * slot + dx, 0), slot * (TABS.length - 1));
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !small && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => x.stopAnimation(),
      onPanResponderMove: (_, g) => x.setValue(under(g.dx)),
      onPanResponderRelease: (_, g) => {
        const i = Math.round(under(g.dx) / slot);
        settle(i);
        if (i !== open) router.navigate(TABS[i].href);
      },
      onPanResponderTerminate: () => settle(open),
    }).panHandlers;
  }, [open, slot, small, settle, x]);
  return { x, panHandlers };
}

// Small after a scroll down past the first few points, wide again on any scroll up or back at the top, the change
// animated by LayoutAnimation (the capsule's width, the labels and the other tab going).
function useShrink() {
  const [small, setSmallNow] = useState(false);
  const now = useRef(false);
  const lastY = useRef(0);
  const setSmall = useCallback((next: boolean) => {
    if (now.current === next) return;
    now.current = next;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSmallNow(next);
  }, []);
  const onScroll = useCallback(
    (y: number) => {
      const next = barAfterScroll(y, y - lastY.current);
      lastY.current = y;
      if (next !== null) setSmall(next);
    },
    [setSmall],
  );
  return [small, onScroll, setSmall] as const;
}

type TabButtonProps = Omit<TabTriggerSlotProps, 'ref'> & {
  tab: (typeof TABS)[number];
  index: number;
  small: boolean;
  onGrow: () => void;
  onOpen: (index: number) => void;
};

// Small, only the open tab shows, as its icon on the pill; tapping it opens the bar out again.
function TabButton({ tab, index, small, onGrow, onOpen, isFocused, onPress, ...props }: TabButtonProps) {
  useEffect(() => {
    if (isFocused) onOpen(index);
  }, [isFocused, index, onOpen]);
  return (
    <Pressable
      {...props}
      onPress={small ? onGrow : onPress}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isFocused }}
      style={[styles.tab, small && (isFocused ? styles.pill : styles.hidden)]}
    >
      <Image source={isFocused ? tab.on : tab.icon} style={isFocused ? styles.icon : styles.plain} />
      {!small && <Text style={styles.label}>{tab.label}</Text>}
    </Pressable>
  );
}

// The chat orb (owner, 19 Nov 2026: "a separate circle on right side"): a glass ring like the capsule round a gradient
// disc with the splash's orbits (scripts/chat-orb.cjs). It opens the chat, not built yet.
function ChatOrb({ bottom }: { bottom: number }) {
  return (
    <Pressable
      onPress={() => router.push('/chat')}
      accessibilityRole="button"
      accessibilityLabel="Chat"
      style={({ pressed }) => [styles.orb, { bottom }, pressed && { opacity: 0.8 }]}
    >
      <Glass style={styles.ring} tint={DARK}>
        <Image source={require('../../../assets/orb.png')} style={styles.disc} />
      </Glass>
    </Pressable>
  );
}

// A bubble over the orb asking people to try the chat (owner, 19 Nov 2026: "add bubble at tab for ai button to make it
// use with a message. dont use same for all", then "make the bubble show every time chat isn't open"). Its line is
// orbNudge's (src/tabBar.ts), for the tab, the hour and the day, drawn afresh each time the tabs come into view (the app
// opening, a tab switch, back from the chat or any page). It stays up while the tabs are in view, out of the way while
// the bar is small or the keyboard is up; a tap opens the chat. Once the chat has been used it's gone for good ("make
// the bubble disappear after chat is used once", src/chatUsed.ts). On the bar's dark glass with a rim, two glass dots
// leading down to the orb ("add rim and glass to bubble", "and point to orb"). Styled as Orbit's own chat bubble, its tail corner by
// the orb.
const NUDGE_DELAY_MS = 1200;
const NUDGE_ROUND = 18;
// Light, so it stands out on the dark app, with Charcoal words, as the chat's Send (owner, 19 Nov 2026: "to make it
// better visibility, any backshade for it. or make the tint lighter"); a soft Night shadow parts it from posters.
const LIGHT = stoneAt(0.85);
function OrbNudge({ tab, bottom, hidden }: { tab: string; bottom: number; hidden: boolean }) {
  const inView = useIsFocused(); // false while the chat, or any page, is over the tabs
  const used = useChatUsed();
  const [text, setText] = useState<string | null>(null);
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!inView || used) return;
    const show = setTimeout(() => {
      setText(orbNudge(tab, new Date(), Math.random()));
      Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    }, NUDGE_DELAY_MS);
    return () => {
      clearTimeout(show);
      fade.setValue(0);
      setText(null);
    };
  }, [tab, inView, used, fade]);
  if (!text || hidden || used) return null;
  return (
    <Animated.View
      style={[styles.nudge, { bottom: bottom + BAR + 2, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}
      accessibilityLiveRegion="polite"
    >
      <Pressable onPress={() => router.push('/chat')} accessibilityRole="button" accessibilityHint="Opens the chat" style={[styles.shade, { borderRadius: NUDGE_ROUND }]}>
        <Glass tint={LIGHT} style={styles.nudgeBubble}>
          <Text style={styles.nudgeText}>{text}</Text>
          <View style={[styles.rim, styles.rimLight, { borderRadius: NUDGE_ROUND }]} pointerEvents="none" />
        </Glass>
      </Pressable>
      {/* Two glass dots, smaller toward the orb, pointing the bubble at it, centred over it. */}
      {[9, 5].map((d) => (
        <View key={d} style={[styles.shade, { borderRadius: d / 2, marginRight: BAR / 2 - d / 2 }]}>
          <Glass tint={LIGHT} style={[styles.nudgeDot, { width: d, height: d, borderRadius: d / 2 }]}>
            <View style={[styles.rim, styles.rimLight, { borderRadius: d / 2 }]} pointerEvents="none" />
          </Glass>
        </View>
      ))}
    </Animated.View>
  );
}

function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const subs = [
      Keyboard.addListener('keyboardDidShow', () => setShown(true)),
      Keyboard.addListener('keyboardDidHide', () => setShown(false)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return shown;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ground },
  capsule: {
    position: 'absolute',
    left: SIDE,
    height: BAR,
    borderRadius: BAR / 2,
    padding: PAD,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  wide: { right: SIDE + BAR + GAP },
  small: { width: BAR },
  hidden: { display: 'none' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: (BAR - 2 * PAD) / 2 },
  pill: { backgroundColor: stoneAt(0.14), borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.24), borderRadius: (BAR - 2 * PAD) / 2 },
  slider: { position: 'absolute', left: PAD, top: PAD, bottom: PAD },
  icon: { width: 20, height: 20 },
  plain: { width: 20, height: 20, tintColor: color.text },
  label: { fontFamily: font.price, fontSize: 14, color: color.text }, // DM Sans 600
  orb: { position: 'absolute', right: SIDE },
  nudge: {
    position: 'absolute',
    right: SIDE,
    maxWidth: 240,
    alignItems: 'flex-end',
    gap: 3,
  },
  // The soft Night shadow, on each glass shape. boxShadow follows the rounded corners and draws only outside them, so
  // see-through glass needs no solid fill (a plain shadow on a see-through view is redrawn pixel by pixel, and React
  // Native warns). Its blur is twice the old shadowRadius 14: iOS halves it.
  shade: { boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 28, color: alpha(role.shadow, 0.7) }] },
  nudgeBubble: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: NUDGE_ROUND },
  nudgeDot: { overflow: 'hidden' },
  // The glass's rim: Liquid Glass draws no border of its own.
  rim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.28) },
  nudgeText: { fontFamily: font.medium, fontSize: 14, lineHeight: 19, color: color.ground },
  rimLight: { borderColor: color.text }, // a bright edge on the light glass
  ring: { width: BAR, height: BAR, borderRadius: BAR / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  disc: { width: DISC, height: DISC, borderRadius: DISC / 2 },
});
