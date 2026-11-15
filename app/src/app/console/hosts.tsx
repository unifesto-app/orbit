// The Console's host switcher: every host the viewer is on, with their role there, the one showing marked by the dot.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Group, Row } from '../../account/kit';
import { useHost } from '../../console/data';
import { hosts } from '../../mock';
import { me, roleOn } from '../../modes';
import { Sheet } from '../../rows';
import { color, space } from '../../theme';

export default function Hosts() {
  const { team: current, pick } = useHost();
  return (
    <Sheet title="Your hosts">
      <View style={styles.list}>
        <Group>
          {me.teams.map((t) => {
            const role = t.owner ? 'Owner' : t.admin ? 'Admin' : roleOn(t, Object.keys(t.events)[0] ?? '');
            return (
              <Row
                key={t.hostId}
                label={hosts.find((h) => h.id === t.hostId)?.name ?? t.hostId}
                value={role ?? undefined}
                right={t.hostId === current.hostId ? <View style={styles.dot} accessibilityLabel="Showing" /> : undefined}
                onPress={() => {
                  pick(t.hostId);
                  router.back();
                }}
              />
            );
          })}
        </Group>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: -20, marginTop: -space.big },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent },
});
