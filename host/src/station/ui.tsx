// Orbit Station's parts, drawn as the Orbit app draws its own (Today take 1, approved 22 Nov 2026): the page head like
// the event page's (the venue's logo and name on top, the title, a grey line), frosted pills and circles for buttons,
// chips, and the short sheet on the glass with its X.
import { Glass } from '@orbit/mobile/glass';
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { color, font, groundAt, space, stoneAt } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Venue } from './day';

/** The top of a tab: the venue on top, the title, its line, and your circle (You: your venues and Sign out). */
export function Head({ venue, title, line }: { venue: Venue; title: string; line: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
      <View style={styles.grow}>
        <View style={styles.hostline}>
          <View style={[styles.logo, { backgroundColor: venue.bg }]}>
            <Text style={[styles.initials, { color: venue.fg }]}>{venue.initials}</Text>
          </View>
          <Text style={styles.venue}>{venue.name}</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.line}>{line}</Text>
      </View>
      <Pressable onPress={() => router.push('/you')} accessibilityRole="button" accessibilityLabel="You" hitSlop={4} style={styles.me}>
        <Text style={styles.meText}>A</Text>
      </Pressable>
    </View>
  );
}

/** A section's heading, 40 below what's above it, with an optional grey word at the right ("Next two hours"). */
export function Section({ title, aside }: { title: string; aside?: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2} accessibilityRole="header">
        {title}
      </Text>
      {aside && <Text style={styles.aside}>{aside}</Text>}
    </View>
  );
}

/** A frosted pill with its label: Check in, Block, a sheet's main button (`wide`). */
export function Pill({ label, onPress, disabled, wide, spoken }: { label: string; onPress: () => void; disabled?: boolean; wide?: boolean; spoken?: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={spoken} accessibilityState={{ disabled }} hitSlop={4} style={({ pressed }) => [disabled && styles.off, pressed && styles.pressed]}>
      <Glass style={wide ? styles.wide : styles.pill}>
        <Text style={wide ? styles.wideText : styles.pillText}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

/** A frosted 36pt circle with − or +. */
export function Round({ label, glyph, onPress, disabled }: { label: string; glyph: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} hitSlop={4} style={({ pressed }) => [disabled && styles.off, pressed && styles.pressed]}>
      <Glass style={styles.round}>
        <Text style={styles.glyph}>{glyph}</Text>
      </Glass>
    </Pressable>
  );
}

/** − n + */
export function Stepper({ n, min, max, onChange, label }: { n: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <View style={styles.stepper}>
      <Round glyph="−" label={`Fewer ${label}`} disabled={n <= min} onPress={() => onChange(n - 1)} />
      <Text style={styles.count}>{n}</Text>
      <Round glyph="+" label={`More ${label}`} disabled={n >= max} onPress={() => onChange(n + 1)} />
    </View>
  );
}

/** One of a row of choices; the picked one lighter. */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} hitSlop={4} style={[styles.chip, on && styles.chipOn]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

/** Orbit's bubble inside a sheet, which already has the page's margins. */
export function SheetSays(props: Omit<ComponentProps<typeof OrbitSays>, 'top'>) {
  return (
    <View style={styles.sheetSays}>
      <OrbitSays top={0} {...props} />
    </View>
  );
}

/**
 * A short sheet on the glass: the title and its line, the X, then what's in it, which scrolls clear of the keyboard and
 * lets a drag put the keyboard away (a number pad has no return key).
 */
export function Sheet({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.sheetScroll}
      bounces={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.big) }]}
    >
      <Glass style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={styles.sheetHead}>
        <View style={styles.grow}>
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {title}
          </Text>
          {note && <Text style={styles.sheetNote}>{note}</Text>}
        </View>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
          <Glass style={styles.x}>
            <Image source={require('../../assets/tabs/close.png')} style={styles.xMark} />
          </Glass>
        </Pressable>
      </View>
      {children}
    </ScrollView>
  );
}

export function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/today');
}

export const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  head: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  hostline: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  logo: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: font.headline, fontSize: 11 },
  venue: { fontFamily: font.medium, fontSize: 14, color: color.text },
  title: { marginTop: 10, fontFamily: font.headline, fontSize: 30, lineHeight: 36, letterSpacing: -0.3, color: color.text },
  line: { marginTop: 2, fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary },
  me: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' },
  meText: { fontFamily: font.headline, fontSize: 15, color: color.text },
  pill: { height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center', overflow: 'hidden' },
  pillText: { fontFamily: font.title, fontSize: 14, color: color.text },
  wide: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  wideText: { fontFamily: font.title, fontSize: 16, color: color.text },
  off: { opacity: 0.38 },
  pressed: { opacity: 0.7 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  glyph: { fontFamily: font.title, fontSize: 19, lineHeight: 22, color: color.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  count: { minWidth: 18, textAlign: 'center', fontFamily: font.title, fontSize: 15, color: color.text, fontVariant: ['tabular-nums'] },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.24) },
  chipOn: { backgroundColor: stoneAt(0.16), borderColor: stoneAt(0.5) },
  chipText: { fontFamily: font.medium, fontSize: 14, color: color.text },
  sheetSays: { marginHorizontal: -20 },
  sheetScroll: { flexGrow: 0 },
  sheet: { paddingTop: space.big, paddingHorizontal: 20, gap: 18, overflow: 'hidden' },
  shade: { backgroundColor: groundAt(0.55) },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetTitle: { fontFamily: font.headline, fontSize: 20, lineHeight: 26, color: color.text },
  sheetNote: { marginTop: 2, fontFamily: font.medium, fontSize: 14, color: color.secondary },
  x: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  xMark: { width: 12, height: 12, tintColor: color.text },
  label: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, color: color.secondary },
  section: { marginTop: 40, marginBottom: 12, marginHorizontal: 20, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  h2: { fontFamily: font.headline, fontSize: 18, lineHeight: 24, color: color.text },
  aside: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  input: { height: 44, borderRadius: 22, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.24), backgroundColor: stoneAt(0.08), color: color.text, fontFamily: font.text, fontSize: 15 },
  field: { gap: space.small },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  frow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 36 },
});
