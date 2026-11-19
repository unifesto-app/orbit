// A fact on a page: a small grey label, the value, and a note under it, as the event page's When and Where; with
// `onPress` it opens more, with a chevron. `FactCard` holds facts in an outlined text card with the room every text
// card has (16 inside and between facts, corner 6 + 16; owner, 19 Nov 2026: "remember for cards add proper padding").
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './icons';
import { around, color, font, radius, space } from './theme';

const PAD = 16;

export function Fact({ label, value, note, onPress }: { label?: string; value: string; note?: string; onPress?: () => void }) {
  const lines = (
    <View style={[styles.grow, styles.lines]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Text style={styles.value}>{value}</Text>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {lines}
      <Icon name="chevron" size={16} color={color.secondary} />
    </Pressable>
  ) : (
    lines
  );
}

// No rim, so an outline; it sits under a Section heading, which brings the space above. `flush` drops its side margins,
// for a card inside a sheet, which keeps the page's margin already.
export function FactCard({ flush = false, children }: { flush?: boolean; children: ReactNode }) {
  return <View style={[styles.card, flush && styles.flush]}>{children}</View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  lines: { gap: 2 }, // line spacing between a fact's label, value and note
  row: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  pressed: { opacity: 0.7 },
  label: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  value: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  note: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  card: {
    marginHorizontal: 20,
    padding: PAD,
    gap: PAD,
    borderRadius: around(radius.sm, PAD),
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.card,
  },
  flush: { marginHorizontal: 0 },
});
