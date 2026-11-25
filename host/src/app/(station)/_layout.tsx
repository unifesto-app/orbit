// Orbit Station's tabs, Today, Money and Venue, on the Orbit app's own tab bar (owner, 22 Nov 2026: "the tab items same
// as orbit app pls"; app/src/app/(tabs)/_layout.tsx): a dark glass capsule low on the screen, the open tab under a
// lighter pill that springs to it, Phosphor filled icons beside DM Sans 600 labels (the open tab's in the Sage to Moss
// gradient), shrinking to the open tab while the page scrolls down. Beside it, the round Scan button ("scan is good, no
// orb needed"). Desk has no money, prices or settings (Roles by use case), so it gets Today alone and a Scan pill.
// ponytail: no drag along the bar (the app's has one); add it if the owner misses it.
import { DARK_TINT as DARK, Glass } from '@orbit/mobile/glass';
import { BAR, barAfterScroll, barBottom, SIDE, TabBarScroll, TabBarSmall } from '@orbit/mobile/tabBar';
import { color, font, stoneAt } from '@orbit/mobile/theme';
import { Redirect, router, usePathname } from 'expo-router';
import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, LayoutAnimation, Platform, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '../../session';
import { useStation } from '../../station/state';
import { isStation } from '../../variant';

const PAD = 4;
const GAP = 10;
const SCAN = require('../../../assets/tabs/scan.png');
const TABS = [
  { name: 'today', href: '/today', label: 'Today', icon: require('../../../assets/tabs/today.png'), on: require('../../../assets/tabs/today-on.png') },
  { name: 'money', href: '/money', label: 'Money', icon: require('../../../assets/tabs/money.png'), on: require('../../../assets/tabs/money-on.png') },
  { name: 'venue', href: '/venue', label: 'Venue', icon: require('../../../assets/tabs/venue.png'), on: require('../../../assets/tabs/venue-on.png') },
] as const;

export default function StationTabs() {
  const session = useSession();
  if (!isStation || !session) return <Redirect href="/" />;
  return <Bar />;
}

function Bar() {
  const { role, seats } = useStation();
  const desk = role === 'desk';
  const path = usePathname();
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
  if (seats?.length === 0) return <Redirect href="/" />; // signed in on no venue: the invites screen
  if (desk && (path === '/money' || path === '/venue')) return <Redirect href="/today" />;
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
        {/* One style object: TabList's Slot refuses an array on its child. Desk keeps the triggers, hidden. */}
        <Glass tint={DARK} style={StyleSheet.flatten([styles.capsule, { bottom }, small ? styles.small : styles.wide, desk && styles.hidden])}>
          {!small && <Animated.View style={[styles.pill, styles.slider, { width: slot, transform: [{ translateX: x }] }]} />}
          {TABS.map((t, i) => (
            <TabTrigger key={t.name} name={t.name} href={t.href} asChild>
              <TabButton tab={t} index={i} small={small} onGrow={() => setSmall(false)} onOpen={setOpen} />
            </TabTrigger>
          ))}
        </Glass>
      </TabList>
      {desk ? (
        <Pressable onPress={() => router.push('/scan')} accessibilityRole="button" style={({ pressed }) => [styles.deskScan, { bottom }, pressed && styles.pressed]}>
          <Glass tint={DARK} style={styles.deskFace}>
            <Image source={SCAN} style={styles.plain} />
            <Text style={styles.label}>Scan a ticket</Text>
          </Glass>
        </Pressable>
      ) : (
        <Pressable onPress={() => router.push('/scan')} accessibilityRole="button" accessibilityLabel="Scan a ticket" style={({ pressed }) => [styles.scan, { bottom }, pressed && styles.pressed]}>
          <Glass tint={DARK} style={styles.ring}>
            <Image source={SCAN} style={styles.scanMark} />
          </Glass>
        </Pressable>
      )}
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
  scan: { position: 'absolute', right: SIDE },
  ring: { width: BAR, height: BAR, borderRadius: BAR / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  scanMark: { width: 24, height: 24, tintColor: color.text },
  deskScan: { position: 'absolute', alignSelf: 'center' },
  deskFace: { height: BAR, paddingLeft: 18, paddingRight: 24, borderRadius: BAR / 2, flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden' },
  pressed: { opacity: 0.8 },
});
