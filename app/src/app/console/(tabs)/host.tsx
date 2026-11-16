// Console's Host tab (Hosts doc, Host profile and settings, Team and roles): the host as people see it, its team, asking
// Orbit to verify it, and its status. Editing the page and asking to verify are Admins'; pausing and archiving are the
// owner's alone (src/modes.ts).
// ponytail: Edit host, Ask and the status rows do nothing yet; they come with the host's edit screens.
import { StyleSheet, Text, View } from 'react-native';

import { Group, Pill, Row } from '../../../account/kit';
import { teams, useHost } from '../../../console/data';
import { TabPage } from '../../../modeKit';
import { runsHost } from '../../../modes';
import { Monogram, Tag, Verified } from '../../../rows';
import { color, font, space } from '../../../theme';

export default function Host() {
  const { team, host } = useHost();
  return (
    <TabPage head="Host" tint={host.bg}>
      <View style={styles.head}>
        <Monogram mark={host} size={56} />
        <View style={styles.lines}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={2}>
              {host.name}
            </Text>
            {host.verified ? <Verified /> : <Tag text="Unverified" />}
          </View>
          <Text style={styles.meta}>{`${host.kind} · ${host.area} · ${host.followers.toLocaleString('en-IN')} followers`}</Text>
        </View>
      </View>
      {team.admin && (
        <View style={styles.edit}>
          <Pill label="Edit host" size="small" />
        </View>
      )}

      <Group title="Team">
        {(teams[team.hostId] ?? []).map((m) => (
          <Row key={m.name + m.role} label={m.you ? `${m.name} (you)` : m.name} value={m.waiting ? `${m.role}, invited` : m.role} />
        ))}
      </Group>

      {team.admin && !host.verified && (
        <Group title="Verification">
          <Row label="Ask Orbit to verify" right={<Pill label="Ask" size="small" />} />
        </Group>
      )}

      {runsHost(team) && (
        <Group title="Status">
          <Row label="Live" />
          <Row label="Pause host" />
          <Row label="Archive host" />
        </Group>
      )}
    </TabPage>
  );
}

const styles = StyleSheet.create({
  head: { marginHorizontal: 20, marginTop: space.small, flexDirection: 'row', alignItems: 'center', gap: 12 },
  lines: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.small, flexWrap: 'wrap' },
  name: { flexShrink: 1, fontFamily: font.headline, fontSize: 20, lineHeight: 26, color: color.text },
  meta: { fontFamily: font.text, fontSize: 14, color: color.secondary },
  edit: { marginHorizontal: 20, marginTop: space.big, flexDirection: 'row' },
});
