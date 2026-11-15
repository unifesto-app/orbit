// An event's Terms & Conditions (owner, 15 Nov 2026: "add Event FAQ & Terms & Conditions Modals"): a full modal on the
// glass, the host's own terms for the event first, then the ones every event has (defaultTerms in src/mock.ts).
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { defaultTerms, events } from '../../mock';
import { NotFound, Sheet } from '../../rows';
import { color, font } from '../../theme';

export default function TermsSheet() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const e = events.find((x) => x.id === slug);
  if (!e) return <NotFound what="event" />;
  return (
    <Sheet title="Terms & Conditions" note={e.title} full>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {[...(e.terms ?? []), ...defaultTerms].map((line) => (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
  line: { fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
});
