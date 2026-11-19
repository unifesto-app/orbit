// An event's FAQ (owner, 15 Nov 2026: "add Event FAQ & Terms & Conditions Modals"; the Discover doc lists FAQ among the
// details): a full modal on the glass. Opened from the event page, which shows the row only when the event has one.
// Since 19 Nov 2026 (owner approved Take 3 of the detail pages mockup) it reads as a conversation: each question in your
// bubble, the host's answer under it in theirs with the host's logo at its foot. The chat's bubbles, as Orbit's on Home
// (src/orbitSays.tsx), but from the host.
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { events, hosts } from '../../mock';
import { HostSays, NotFound, Sheet } from '../../rows';
import { color, font, space, stoneAt } from '../../theme';

export default function FaqSheet() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const e = events.find((x) => x.id === slug);
  const host = e && hosts.find((h) => h.id === e.hostId);
  if (!e || !host) return <NotFound what="event" />;
  return (
    <Sheet title="FAQ" note={`${e.title} · answered by ${host.name}`} full>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {(e.faq ?? []).map((f) => (
          <View key={f.q} style={styles.pair}>
            <View style={[styles.bubble, styles.mine]}>
              <Text style={styles.text}>{f.q}</Text>
            </View>
            <HostSays host={host} text={f.a} />
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.big },
  pair: { gap: space.small },
  // Yours: 20 round with the 6 tail corner on your side, lighter than the host's (src/orbitSays.tsx).
  bubble: { maxWidth: '80%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6, backgroundColor: stoneAt(0.14), borderColor: stoneAt(0.24) },
  text: { fontFamily: font.text, fontSize: 16, lineHeight: 22, color: color.text },
});
