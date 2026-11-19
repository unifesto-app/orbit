// An event's Terms & Conditions (owner, 15 Nov 2026: "add Event FAQ & Terms & Conditions Modals"): a full modal on the
// glass, the host's own terms for the event first, then the ones every event has (defaultTerms in src/mock.ts).
// Since 19 Nov 2026 (owner approved Take 3 of the detail pages mockup) each set is an outlined card under a small label.
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { FactCard } from '../../fact';
import { defaultTerms, events, hosts } from '../../mock';
import { NotFound, Sheet } from '../../rows';
import { color, font, space } from '../../theme';

export default function TermsSheet() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const e = events.find((x) => x.id === slug);
  const host = e && hosts.find((h) => h.id === e.hostId);
  if (!e || !host) return <NotFound what="event" />;
  const sets = [
    ...(e.terms?.length ? [{ label: `From ${host.name}`, lines: e.terms }] : []),
    { label: 'On every Orbit event', lines: defaultTerms },
  ];
  return (
    <Sheet title="Terms & Conditions" note={e.title} full>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {sets.map((set) => (
          <FactCard key={set.label} flush>
            <Text style={styles.label}>{set.label}</Text>
            {set.lines.map((line) => (
              <Text key={line} style={styles.line}>
                {line}
              </Text>
            ))}
          </FactCard>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.big },
  label: { fontFamily: font.medium, fontSize: 12, color: color.secondary }, // a fact's label (src/fact.tsx)
  line: { fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.text },
});
