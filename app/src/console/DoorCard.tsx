// An event's door on its day (Event day doc): how many are in, with Scan and Find someone, one tap from the card. On
// Console's home and on Check-in, the hosts' third card in the switcher.
// ponytail: Scan and Find someone do nothing yet; the scanner needs expo-camera, so a native rebuild.
import { StyleSheet, Text, View } from 'react-native';

import { Group, Pill } from '../account/kit';
import { color, font, space } from '../theme';

export function DoorCard({ title, heading, when, checkedIn, booked }: { title: string; heading: string; when: string; checkedIn: number; booked: number }) {
  return (
    <Group title={heading}>
      <View style={styles.door}>
        <View style={styles.lines}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.when}>{when}</Text>
        </View>
        <Text style={styles.count}>{`In ${checkedIn} of ${booked}`}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${booked ? (100 * checkedIn) / booked : 0}%` }]} />
        </View>
        <View style={styles.actions}>
          <Pill label="Scan" />
          <Pill label="Find someone" />
        </View>
      </View>
    </Group>
  );
}

const styles = StyleSheet.create({
  door: { gap: space.small },
  lines: { gap: 2 },
  title: { fontFamily: font.title, fontSize: 17, lineHeight: 22, color: color.text },
  when: { fontFamily: font.text, fontSize: 14, color: color.secondary },
  count: { marginTop: space.small, fontFamily: font.headline, fontSize: 28, lineHeight: 34, color: color.text },
  // The share let in, in the accent: an element, never text.
  track: { height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: color.accent },
  actions: { marginTop: space.small, flexDirection: 'row', gap: space.small },
});
