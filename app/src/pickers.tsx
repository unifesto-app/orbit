// The booking screens' controls (src/app/book/[slug].tsx, src/app/slot/[venue].tsx): a glass chip, its pick marked with
// an accent dot as every chip's is (never accent text), and a − and + stepper for how many. Buttons are glass, never
// squared: chips are pills and the stepper's buttons circles.
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Glass } from './glass';
import { color, font, space } from './theme';

export function Chip({ label, picked = false, disabled = false, onPress }: { label: string; picked?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: picked, disabled }}
      style={disabled && styles.off}>
      <Glass style={styles.chip}>
        {picked && <View style={styles.dot} />}
        <Text style={styles.chipText}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

// `label` names what's counted, for screen readers ("Solo tickets", "Hours").
export function Stepper({ value, min = 0, max, label, onChange }: { value: number; min?: number; max: number; label: string; onChange: (n: number) => void }) {
  return (
    <View style={styles.stepper} accessible accessibilityLabel={`${label}: ${value}`}>
      <Pressable onPress={() => onChange(value - 1)} disabled={value <= min} accessibilityRole="button" accessibilityLabel={`Fewer ${label.toLowerCase()}`} hitSlop={6}>
        <Glass style={[styles.round, value <= min && styles.off]}>
          <Text style={styles.sign}>−</Text>
        </Glass>
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable onPress={() => onChange(value + 1)} disabled={value >= max} accessibilityRole="button" accessibilityLabel={`More ${label.toLowerCase()}`} hitSlop={6}>
        <Glass style={[styles.round, value >= max && styles.off]}>
          <Text style={styles.sign}>+</Text>
        </Glass>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontFamily: font.medium, fontSize: 14, color: color.text },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  off: { opacity: 0.35 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  round: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sign: { fontFamily: font.title, fontSize: 18, lineHeight: 22, color: color.text },
  value: { minWidth: 20, textAlign: 'center', fontFamily: font.title, fontSize: 15, color: color.text },
});
