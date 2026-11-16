// Orbit's staff (Roles doc; Galaxy canvas, 16 Nov 2026), for the Staff feature: anyone waiting to be confirmed, then
// everyone with access and their features. An add counts once another holder of Staff confirms it, never the one who
// added it nor the person; the platform owner's own adds land after 24 hours instead, with a cancel. The platform owner
// can't be removed or suspended.
// ponytail: Add, a staff member's own page and its feature switches are the next slice; Confirm and Cancel change this
// screen only.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Group, Page, Pill, Row } from '../../account/kit';
import { FEATURE_NAMES, type StaffMember, staff as all } from '../../galaxy/data';
import { gated } from '../../galaxy/kit';
import { useMe } from '../../session';
import { color, font, space } from '../../theme';

const features = (s: StaffMember) => (s.owner ? 'Platform owner · every feature' : s.features.map((f) => FEATURE_NAMES[f]).join(', '));

export default gated('staff', function Staff() {
  const me = useMe();
  const [staff, setStaff] = useState(all);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const waiting = staff.filter((s) => s.waiting);
  const mine = (s: StaffMember) => s.waiting?.addedBy === me.id;
  const name = (id: string) => (id === me.id ? 'you' : (all.find((s) => s.id === id)?.name ?? 'someone'));
  return (
    <Page>
      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header">
          Staff
        </Text>
        <Pill label="Add" size="small" />
      </View>

      {waiting.length > 0 && (
        <Group title="Waiting">
          {waiting.map((s) => (
            <Row
              key={s.id}
              label={s.name}
              note={[features(s), `added by ${name(s.waiting!.addedBy)}`, s.waiting!.lands && `lands ${s.waiting!.lands}`].filter(Boolean).join(' · ')}
              right={
                mine(s) ? (
                  <Pill label="Cancel" size="small" onPress={() => setStaff((list) => list.filter((x) => x.id !== s.id))} />
                ) : s.id === me.id ? undefined : confirmed.includes(s.id) ? (
                  <Pill label="Confirmed" size="small" muted />
                ) : (
                  <Pill label="Confirm" size="small" onPress={() => setConfirmed((c) => [...c, s.id])} />
                )
              }
            />
          ))}
        </Group>
      )}
      <Group title="Staff">
        {staff
          .filter((s) => !s.waiting)
          .map((s) => (
            <Row key={s.id} label={s.name} note={features(s)} value={s.id === me.id ? 'You' : undefined} />
          ))}
      </Group>
    </Page>
  );
});

const styles = StyleSheet.create({
  titleRow: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.small },
  title: { fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text },
});
