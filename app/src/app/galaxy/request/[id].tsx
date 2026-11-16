// One request in the Requests queue (Galaxy doc, The Requests queue; Galaxy canvas, 16 Nov 2026): the host and who asked,
// what they sent, then a note the host hears with the outcome and the two ways it can go. Queues can see and reply;
// deciding needs the feature that owns the kind (Roles doc), and nobody decides for a host whose team they're on.
// Every decision is a risky action: the note is its reason, logged and emailed to everyone holding that feature.
// ponytail: deciding and replying go back to the queue; the API records them.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Field, Group, Note, Page, Pill, Row } from '../../../account/kit';
import { FEATURE_NAMES, KINDS, requests } from '../../../galaxy/data';
import { ago, due } from '../../../galaxy/due';
import { Choices, StaffNote, emailed, gated, opener } from '../../../galaxy/kit';
import { hosts, now } from '../../../mock';
import { canActOn, hasFeature } from '../../../modes';
import { Monogram, NotFound, Tag } from '../../../rows';
import { useMe } from '../../../session';

export default gated('queues', function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const [note, setNote] = useState('');
  const r = requests.find((x) => x.id === id);
  const host = hosts.find((h) => h.id === r?.hostId);
  if (!r || !host) return <NotFound what="request" />;

  const kind = KINDS[r.kind];
  const decides = hasFeature(me, kind.feature);
  const allowed = canActOn(me, { hostId: host.id });
  const ready = decides && allowed && note.trim().length > 0;
  const line = !allowed
    ? 'You’re on this host’s team, so someone else decides it.'
    : decides
      ? emailed(kind.feature)
      : `Only staff with ${FEATURE_NAMES[kind.feature]} decide this.`;
  return (
    <Page title={kind.title}>
      <Note>{`Asked ${ago(r.askedAt, now)} · ${due(r.askedAt, now).line.toLowerCase()}`}</Note>
      <Group>
        <Row
          lead={<Monogram mark={host} size={40} />}
          label={host.name}
          note={`${host.kind} · ${host.followers.toLocaleString('en-IN')} followers`}
          right={<Tag text={host.verified ? 'Verified' : 'Unverified'} />}
          onPress={opener(me, 'hosts', `/galaxy/host/${host.id}`)}
        />
      </Group>
      <Group title="Asked by">
        <Row label={r.by.name} note={r.by.role} onPress={r.by.accountId ? opener(me, 'people', `/galaxy/person/${r.by.accountId}`) : undefined} />
      </Group>
      {r.sections.map((s) => (
        <Group key={s.title} title={s.title}>
          {s.rows.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </Group>
      ))}
      {r.document && (
        <Group title="To compare">
          <Row label={r.document} right={<Pill label="View" size="small" />} />
        </Group>
      )}

      <View style={styles.field}>
        <Field
          label={decides ? `Note to ${host.name}` : `Reply to ${host.name}`}
          placeholder={decides ? 'They hear this with the outcome' : 'Ask them something'}
          multiline
          value={note}
          onChangeText={setNote}
        />
      </View>
      {!decides && (
        <View style={styles.send}>
          <Pill label="Send" size="small" disabled={!note.trim()} onPress={() => router.back()} />
        </View>
      )}
      <StaffNote>{line}</StaffNote>
      <Choices
        choices={[
          { label: kind.yes, disabled: !ready, onPress: () => router.back() },
          { label: kind.no, disabled: !ready, onPress: () => router.back() },
        ]}
      />
    </Page>
  );
});

const styles = StyleSheet.create({
  field: { marginHorizontal: 20, marginTop: 24 },
  send: { marginHorizontal: 20, marginTop: 8, alignItems: 'flex-end' },
});
