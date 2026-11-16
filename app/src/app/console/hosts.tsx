// The Console's host switcher: every host the viewer is on, with their role there, the one showing marked by the dot.
// The teams are the account's own (GET /me); each host's name comes from GET /hosts/:id.
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Group, Row } from '../../account/kit';
import { useHost } from '../../console/data';
import { hostsApi } from '../../hosts';
import { useLoad } from '../../load';
import { roleOn } from '../../modes';
import { Sheet } from '../../rows';
import { api, useMe } from '../../session';
import { color, space } from '../../theme';

export default function Hosts() {
  const me = useMe();
  const { team: current, host, pick } = useHost();
  const names = useLoad(`${me.id}|${me.teams.map((t) => t.hostId).join()}`, async () => {
    const pages = await Promise.all(me.teams.map((t) => hostsApi(api).page(t.hostId)));
    return { ok: true as const, data: new Map(pages.flatMap((r) => (r.ok ? [[r.data.id, r.data.name] as const] : []))) };
  });
  return (
    <Sheet title="Your hosts">
      <View style={styles.list}>
        <Group>
          {me.teams.map((t) => {
            const role = t.owner ? 'Owner' : t.admin ? 'Admin' : roleOn(t, Object.keys(t.events)[0] ?? '');
            return (
              <Row
                key={t.hostId}
                label={names.data?.get(t.hostId) ?? (t.hostId === host.id ? host.name : '…')}
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
