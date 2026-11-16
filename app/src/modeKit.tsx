// What Console and Galaxy share (src/modes.ts): the re-tap that opens the mode sheet, the tab bar's look, and a tab's
// page, a scroll under a pinned header like Home's.
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarGlass } from './glass';
import { Glow } from './rows';
import type { Mode } from './modes';
import { color, font, space } from './theme';

// Tapping the tab you're already on opens the mode sheet, /switch (owner, 16 Nov 2026: "when home is clicked in tab nav
// open a modal with Home Console Galaxy"). A repeat tap reaches JS as `tabPress`, sent before the tab is selected, so the
// tab is already focused only on a repeat. Its trigger also needs disableScrollToTop, so a re-tap does just this.
export const retap =
  (from: Mode) =>
  ({ navigation }: { navigation: { isFocused: () => boolean } }) => ({
    tabPress: () => {
      if (navigation.isFocused()) router.push({ pathname: '/switch', params: { from } });
    },
  });

// The tab bar as on Home and Search (src/app/(tabs)/_layout.tsx): white when selected, never the accent.
export const TAB_BAR = {
  tintColor: color.text,
  iconColor: { default: color.secondary, selected: color.text },
  labelStyle: { default: { color: color.secondary }, selected: { color: color.text } },
  backgroundColor: color.ground,
  indicatorColor: 'rgba(255, 255, 255, 0.14)',
  minimizeBehavior: 'onScrollDown',
} as const;

const HEADER = 44; // as Home's

// A tab's page: `head` pinned at the top (a title, or the host switcher), with glass fading in behind it as the page
// scrolls, and `right` at its end. The tab's own trigger turns off iOS's automatic insets, so the page pads itself.
// `tint` glows from the top in the mode's colour (Galaxy's; a proposal on the Galaxy canvas, 16 Nov 2026, not yet
// accepted by the owner: drop the prop to take it away).
export function TabPage({ head, right, tint, children }: { head: ReactNode; right?: ReactNode; tint?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [scrollY] = useState(() => new Animated.Value(0));
  const top = insets.top + 4;
  return (
    <View style={styles.screen}>
      {tint && <Glow tint={tint} />}
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: top + HEADER, paddingBottom: (Platform.OS === 'ios' ? insets.bottom : 0) + 32 }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}>
        {children}
      </Animated.ScrollView>
      <View style={[styles.bar, { paddingTop: top }]}>
        <BarGlass scrollY={scrollY} />
        <View style={styles.header}>
          {typeof head === 'string' ? (
            <Text style={styles.title} accessibilityRole="header">
              {head}
            </Text>
          ) : (
            head
          )}
          {right}
        </View>
      </View>
    </View>
  );
}

// One grey line where a list would be (Account's rule: titles only, empty states a single short line).
export function Empty({ children }: { children: string }) {
  return <Text style={styles.empty}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 12, pointerEvents: 'box-none' },
  header: { height: HEADER, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.small },
  title: { fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text },
  empty: { marginHorizontal: 20, marginTop: space.big, fontFamily: font.text, fontSize: 15, color: color.secondary },
});
