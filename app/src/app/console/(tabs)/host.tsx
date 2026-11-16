// Console's Host tab (Hosts doc, Host profile and settings, Team and roles): the host as people see it, its team, asking
// Orbit to verify it, and its status. Editing the page and asking to verify are Admins'; pausing, archiving and
// restoring are the owner's alone (src/modes.ts). The host is GET /hosts/:id (Console's layout) and the team
// GET /hosts/:id/team; the owner's status moves go straight to the API, which refuses a pause or archive while events
// with bookings or open money remain.
// ponytail: Edit host, Ask, inviting and confirming have no screens yet; they come with the host's edit screens.
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Group, Pill, Row } from '../../../account/kit';
import { useHost } from '../../../console/data';
import { type StatusAction, hostsApi, ownerMoves } from '../../../hosts';
import { useLoad } from '../../../load';
import { TabPage } from '../../../modeKit';
import { runsHost } from '../../../modes';
import { Monogram, Tag, Verified } from '../../../rows';
import { api, useMe } from '../../../session';
import { color, font, space } from '../../../theme';

const STATUS = { live: 'Live', paused: 'Paused', archived: 'Archived', suspended: 'Suspended by Orbit' } as const;
// What each move says before it runs, and its button.
const MOVES: Record<StatusAction, { row: string; title: string; line: string; button: string }> = {
  pause: { row: 'Pause host', title: 'Pause', line: 'Its page comes down and nothing sells until you resume it. Your team still sees everything.', button: 'Pause' },
  resume: { row: 'Resume host', title: 'Resume', line: 'Its page is back and it can sell again.', button: 'Resume' },
  archive: { row: 'Archive host', title: 'Archive', line: 'It closes to everyone but you, its owner. You can restore it later.', button: 'Archive' },
  restore: { row: 'Restore host', title: 'Restore', line: 'It goes live again.', button: 'Restore' },
};

export default function Host() {
  const me = useMe();
  const { team, host, reload } = useHost();
  const list = useLoad(`${host.id}|${me.id}`, () => hostsApi(api).team(host.id));
  const followers = `${host.followers.toLocaleString('en-IN')} follower${host.followers === 1 ? '' : 's'}`;

  const move = (action: StatusAction) =>
    Alert.alert(`${MOVES[action].title} ${host.name}?`, MOVES[action].line, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: MOVES[action].button,
        style: action === 'archive' ? 'destructive' : 'default',
        onPress: async () => {
          const r = await hostsApi(api).move(host.id, action);
          if (!r.ok) Alert.alert(`Couldn’t ${action}`, r.error.message);
          reload();
        },
      },
    ]);

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
          <Text style={styles.meta}>{`${host.kind} · ${host.area} · ${followers}`}</Text>
        </View>
      </View>
      {team.admin && (
        <View style={styles.edit}>
          <Pill label="Edit host" size="small" />
        </View>
      )}

      <Group title="Team">
        {(list.data?.members ?? []).map((m) => (
          <Row key={m.id} label={m.userId === me.id ? `${m.name ?? 'You'} (you)` : (m.name ?? 'Someone')} value={m.owner ? 'Owner' : 'Admin'} />
        ))}
        {/* Admins see invites still waiting, and whether each was accepted, so the adder can check it's the right person. */}
        {(list.data?.invites ?? []).map((i) => (
          <Row key={i.id} label={i.acceptedBy ?? i.contact} value={i.accepted ? 'Admin, accepted' : 'Admin, invited'} />
        ))}
        {list.error && <Row label={list.error.message} />}
      </Group>

      {team.admin && !host.verified && (
        <Group title="Verification">
          <Row label="Ask Orbit to verify" right={<Pill label="Ask" size="small" />} />
        </Group>
      )}

      {/* Everyone on the team sees where the host stands; only the owner moves it. */}
      <Group title="Status">
        <Row label={STATUS[host.status]} value={host.status === 'suspended' ? (host.suspendReason ?? undefined) : undefined} />
        {runsHost(team) && ownerMoves[host.status].map((a) => <Row key={a} label={MOVES[a].row} onPress={() => move(a)} />)}
      </Group>
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
