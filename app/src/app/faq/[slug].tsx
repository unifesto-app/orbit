// An event's FAQ (owner, 15 Nov 2026: "add Event FAQ & Terms & Conditions Modals"; the Discover doc lists FAQ among the
// details): a full modal on the glass, each question with its answer under it. Opened from the event page, which shows
// the row only when the event has one.
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { events } from '../../mock';
import { NotFound, Sheet } from '../../rows';
import { color, font, space } from '../../theme';

export default function FaqSheet() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const e = events.find((x) => x.id === slug);
  if (!e) return <NotFound what="event" />;
  return (
    <Sheet title="FAQ" note={e.title} full>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {(e.faq ?? []).map((f) => (
          <View key={f.q} style={styles.item}>
            <Text style={styles.q}>{f.q}</Text>
            <Text style={styles.a}>{f.a}</Text>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.big },
  item: { gap: 4 },
  q: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  a: { fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
});
