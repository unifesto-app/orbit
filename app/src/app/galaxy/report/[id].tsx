// One content report (Galaxy doc, Content reports; Galaxy canvas, 16 Nov 2026): the event and its host, what each person
// reported, then acting on it (taking the event down or suspending the host, both risky and Hosts and events only), and a
// note the reporters hear when it's resolved or dismissed. Nothing is hidden until someone acts.
// ponytail: Resolve and Dismiss go back to the queue; the API records them.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Field, Group, Note, Page, Row } from '../../../account/kit';
import { reports } from '../../../galaxy/data';
import { due } from '../../../galaxy/due';
import { Choices, StaffNote, askReason, gated, opener } from '../../../galaxy/kit';
import { events, hosts, now } from '../../../mock';
import { canActOn, hasFeature } from '../../../modes';
import { Monogram, NotFound, Poster, Section, Tag } from '../../../rows';
import { useMe } from '../../../session';
import { color, font } from '../../../theme';

export default gated('queues', function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const [note, setNote] = useState('');
  const rep = reports.find((r) => r.id === id);
  const e = events.find((x) => x.id === rep?.eventId);
  const host = hosts.find((h) => h.id === e?.hostId);
  if (!rep || !e || !host) return <NotFound what="report" />;

  // Nobody handles a report about a host whose team they're on (Roles doc), not even resolving it.
  const own = !canActOn(me, { hostId: host.id });
  const acts = hasFeature(me, 'hosts') && !own;
  const n = rep.reports.length;
  return (
    <Page title={e.title}>
      <Note>{`${rep.byOrbit ? 'Raised by Orbit' : rep.ticket ? 'Ticket problem' : 'Content report'} · ${due(rep.askedAt, now).line.toLowerCase()}`}</Note>
      <Group>
        <Row
          lead={<Poster media={e.poster} width={60} label={e.title} />}
          label={e.title}
          note={`${e.when} · ${e.area}`}
          onPress={opener(me, 'hosts', `/galaxy/event/${e.id}`)}
        />
        <Row
          lead={<Monogram mark={host} size={40} />}
          label={host.name}
          note={host.kind}
          right={<Tag text={host.verified ? 'Verified' : 'Unverified'} />}
          onPress={opener(me, 'hosts', `/galaxy/host/${host.id}`)}
        />
      </Group>

      <Group title={n === 1 ? '1 report' : `${n} reports`}>
        {rep.reports.map((r, i) => (
          <View key={i} style={styles.report}>
            <Text style={styles.reason}>{r.reason}</Text>
            <Text style={styles.from}>{`${r.from} · ${r.ago}`}</Text>
            <Text style={styles.text}>{r.text}</Text>
          </View>
        ))}
      </Group>

      {/* A ticket problem (charged twice, say) is about a payment, not the listing: nothing to take down. */}
      {!rep.ticket && <Section title="Act on it" />}
      {!rep.ticket && (
      <Choices
        choices={[
          {
            label: 'Take down event',
            disabled: !acts,
            onPress: () =>
              askReason({
                title: `Take down ${e.title}?`,
                line: 'Sales stop and it leaves Discover and search. Everyone who booked keeps their ticket and is told.',
                action: 'Take down',
                who: `${host.name}’s Admins see this`,
                feature: 'hosts',
              }),
          },
          {
            label: 'Suspend host',
            disabled: !acts,
            onPress: () =>
              askReason({
                title: `Suspend ${host.name}?`,
                line: 'They can’t publish, sell or ask for a payout until it’s lifted. Sold tickets still check in.',
                action: 'Suspend',
                who: `${host.name}’s Admins see this`,
                feature: 'hosts',
              }),
          },
        ]}
      />
      )}

      <View style={styles.field}>
        <Field
          label={rep.byOrbit ? 'Note' : n === 1 ? `Note to ${rep.reports[0].from}` : `Note to the ${n} who reported`}
          placeholder={rep.byOrbit ? 'Kept with the report' : 'They hear this when you resolve or dismiss'}
          multiline
          value={note}
          onChangeText={setNote}
        />
      </View>
      <Choices
        choices={[
          { label: 'Resolve', disabled: own || !note.trim(), onPress: () => router.back() },
          { label: 'Dismiss', disabled: own || !note.trim(), onPress: () => router.back() },
        ]}
      />
      {own && <StaffNote>You’re on this host’s team, so someone else handles it.</StaffNote>}
    </Page>
  );
});

const styles = StyleSheet.create({
  report: { gap: 2 },
  reason: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  from: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  text: { marginTop: 4, fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.text },
  field: { marginHorizontal: 20, marginTop: 24 },
});
