// The agenda, from When on the event page (owner, 15 Nov 2026: "When clicked for Agenda ( Modal )", then "Agenda full
// modal"): a full modal like the person sheet, its title over the date and time in India time, then every slot in
// order, its time in a column on the left. It scrolls when there are many. When is tappable only on an event with an
// agenda.
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { events } from '../../mock';
import { NotFound, Sheet } from '../../rows';
import { color, font } from '../../theme';

export default function AgendaSheet() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const e = events.find((x) => x.id === slug);
  if (!e) return <NotFound what="event" />;
  return (
    <Sheet title="Agenda" note={`${e.when} IST`} full>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.slots}>
        {(e.agenda ?? []).map((a) => (
          <View key={`${a.time} ${a.item}`} style={styles.slot}>
            <Text style={styles.time}>{a.time}</Text>
            <Text style={styles.item}>{a.item}</Text>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  slots: { gap: 16 },
  slot: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  time: { width: 96, fontFamily: font.medium, fontSize: 13, color: color.secondary },
  item: { flex: 1, fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
});
