// Orbit Launch's tabs, Events, Money and Host, on the Orbit app's own tab bar (Events take 1, approved 22 Nov 2026): a
// dark glass capsule low on the screen, the open tab under a lighter pill that springs to it, Phosphor filled icons
// beside DM Sans 600 labels (the open tab's in the Sage to Moss gradient), shrinking to the open tab while the page
// scrolls down. Beside it, the round Inbox with its count (owner, 22 Nov 2026: "Inbox", over the chat orb and Scan,
// which only works around check-in), with how many of its messages are unread (GET /me/inbox, read every minute here).
// ponytail: the same bar as Station's (host/src/app/(station)/_layout.tsx) with other tabs and circle; pull both into one
// host tab bar once Station lands. No drag along the bar (the Orbit app's has one).
import { DARK_TINT as DARK, Glass } from '@orbit/mobile/glass';
import { BAR, barAfterScroll, barBottom, SIDE, TabBarScroll, TabBarSmall } from '@orbit/mobile/tabBar';
import { color, font, stoneAt } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, LayoutAnimation, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { badge } from '../../launch/inbox';
import { refreshInbox, useInbox } from '../../launch/inboxStore';
import { useSession } from '../../session';

const PAD = 4;
const GAP = 10;
const BELL = require('../../../assets/tabs/bell.png');
const TABS = [
  { name: 'events', href: '/events', label: 'Events', icon: require('../../../assets/tabs/events.png'), on: require('../../../assets/tabs/events-on.png') },
  { name: 'earnings', href: '/earnings', label: 'Money', icon: require('../../../assets/tabs/money.png'), on: require('../../../assets/tabs/money-on.png') },
  { name: 'team', href: '/team', label: 'Host', icon: require('../../../assets/tabs/team.png'), on: require('../../../assets/tabs/team-on.png') },
] as const;

// Only Launch reaches it: the root layout's Stack.Protected guard sends Station and Crew to /.
export default function LaunchTabs() {
  const insets = useSafeAreaInsets();
  const bottom = barBottom(insets.bottom, Platform.OS === 'ios');
  const [small, onScroll, setSmall] = useShrink();
  const [open, setOpen] = useState(0);
  useEffect(() => setSmall(false), [open, setSmall]); // a tab opens with the bar wide
  const { width } = useWindowDimensions();
  const slot = (width - SIDE - (SIDE + BAR + GAP) - 2 * PAD) / TABS.length;
  const [x] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(x, { toValue: open * slot, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
  }, [open, slot, x]);
  const { unread } = useInbox();
  const count = badge(unread);
  const me = useSession()?.me.id;
  useEffect(() => {
    if (!me) return;
    void refreshInbox(me);
    const every = setInterval(() => void refreshInbox(me), 60_000);
    return () => clearInterval(every);
  }, [me]);
  return (
    <Tabs style={styles.root}>
      <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: bottom + BAR }}>
        <TabBarScroll.Provider value={onScroll}>
          <TabBarSmall.Provider value={small}>
            <TabSlot />
          </TabBarSmall.Provider>
        </TabBarScroll.Provider>
      </SafeAreaInsetsContext.Provider>
      <TabList asChild>
        {/* One style object: TabList's Slot refuses an array on its child. */}
        <Glass tint={DARK} style={StyleSheet.flatten([styles.capsule, { bottom }, small ? styles.small : styles.wide])}>
          {!small && <Animated.View style={[styles.pill, styles.slider, { width: slot, transform: [{ translateX: x }] }]} />}
          {TABS.map((t, i) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton tab={t} index={i} small={small} onGrow={() => setSmall(false)} onOpen={setOpen} />
            </TabTrigger>
          ))}
        </Glass>
      </TabList>
      <Pressable
        onPress={() => router.push('/inbox')}
        accessibilityRole="button"
        accessibilityLabel={count ? `Inbox, ${unread} new` : 'Inbox'}
        style={({ pressed }) => [styles.inbox, { bottom }, pressed && styles.pressed]}
      >
        <Glass tint={DARK} style={styles.ring}>
          <Image source={BELL} style={styles.bell} />
        </Glass>
        {count && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )}
      </Pressable>
    </Tabs>
  );
}

// Small after a scroll down past the first few points, wide again on any scroll up or back at the top (the app's).
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.ground },
  capsule: { position: 'absolute', left: SIDE, height: BAR, borderRadius: BAR / 2, padding: PAD, flexDirection: 'row', overflow: 'hidden' },
  wide: { right: SIDE + BAR + GAP },
  small: { width: BAR },
  hidden: { display: 'none' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: (BAR - 2 * PAD) / 2 },
  pill: { backgroundColor: stoneAt(0.14), borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.24), borderRadius: (BAR - 2 * PAD) / 2 },
  slider: { position: 'absolute', left: PAD, top: PAD, bottom: PAD },
  icon: { width: 20, height: 20 },
  plain: { width: 20, height: 20, tintColor: color.text },
  label: { fontFamily: font.price, fontSize: 14, color: color.text }, // DM Sans 600
  inbox: { position: 'absolute', right: SIDE },
  ring: { width: BAR, height: BAR, borderRadius: BAR / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bell: { width: 22, height: 22, tintColor: color.text },
  // The count on the accent (an element), Charcoal on Sage: Stone on Sage is only 2.3:1. Ringed in the ground colour.
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.ground,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.price, fontSize: 11, lineHeight: 14, color: color.onAccent },
  pressed: { opacity: 0.8 },
});
