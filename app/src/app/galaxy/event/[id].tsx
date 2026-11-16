// An event as staff see it (Galaxy doc, Events; Galaxy canvas, 16 Nov 2026), for the Hosts and events feature: the 4:3
// poster full width at the top as on its public page, its marks, host, sales, the Discover spotlight, reports, history,
// and what staff can do. Never its attendees, and staff never edit it. Taking it down, restoring it, cancelling it (only
// for a suspended host) and the spotlight are all risky.
// ponytail: every event shows Live until the API says otherwise; Restore shows once one is taken down.
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Group, Note, Page, Row, Toggle } from '../../../account/kit';
import { eventFiles, reports } from '../../../galaxy/data';
import { StaffNote, askReason, gated, opener } from '../../../galaxy/kit';
import { Media } from '../../../media';
import { events, hosts } from '../../../mock';
import { canActOn } from '../../../modes';
import { Monogram, NotFound, TOP, Tag } from '../../../rows';
import { useMe } from '../../../session';
import { color, font, space } from '../../../theme';

const CORNER = 14; // the carousel's bottom corners, as on the public event page

export default gated('hosts', function EventPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const me = useMe();
  const e = events.find((x) => x.id === id);
  const host = hosts.find((h) => h.id === e?.hostId);
  if (!e || !host) return <NotFound what="event" />;

  const file = eventFiles[e.id];
  const rep = reports.find((r) => r.eventId === e.id);
  const acts = canActOn(me, { hostId: host.id });
  const who = `${host.name}’s Admins see this`;
  const tags = [file?.status ?? 'Live', rep && `${rep.reports.length} open report${rep.reports.length === 1 ? '' : 's'}`].filter((t): t is string => !!t);
  const media = e.wide ? { source: e.wide.source, ratio: '4:3' as const } : e.poster;
  return (
    <Page>
      <View style={[styles.poster, { marginTop: -(insets.top + TOP) }]}>
        <Media media={media} frame="4:3" label={`Poster for ${e.title}`} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {e.title}
      </Text>
      <Note>{`${e.when} · ${e.area}`}</Note>
      <View style={styles.tags}>
        {tags.map((t) => (
          <Tag key={t} text={t} />
        ))}
      </View>

      <Group>
        <Row
          lead={<Monogram mark={host} size={40} />}
          label={host.name}
          note={host.kind}
          right={<Tag text={host.verified ? 'Verified' : 'Unverified'} />}
          onPress={() => router.push(`/galaxy/host/${host.id}`)}
        />
      </Group>
      {file && (
        <Group title="Sales">
          {file.sales.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </Group>
      )}
      <Group title="Discover">
        <Row
          label="Spotlight"
          value={acts ? undefined : 'Off'}
          right={
            acts ? (
              <Toggle
                label="Spotlight"
                value={false}
                onChange={() =>
                  askReason({ title: `Put ${e.title} in the spotlight?`, line: 'It leads Discover until it ends or you clear it.', action: 'Spotlight it', who: 'Only staff see this', feature: 'hosts' })
                }
              />
            ) : undefined
          }
        />
      </Group>
      {rep && (
        <Group title="Reports">
          <Row label={[...new Set(rep.reports.map((r) => r.reason))].join(', ')} value="Open" onPress={opener(me, 'queues', `/galaxy/report/${rep.id}`)} />
        </Group>
      )}
      {file && file.history.length > 0 && (
        <Group title="History">
          {file.history.map(([what, when]) => (
            <Row key={what} label={what} value={when} />
          ))}
        </Group>
      )}

      {acts ? (
        <Group title="Actions">
          <Row
            label="Take down"
            onPress={() =>
              askReason({
                title: `Take down ${e.title}?`,
                line: 'Sales stop and it leaves Discover and search. Everyone who booked keeps their ticket and is told.',
                action: 'Take down',
                who,
                feature: 'hosts',
              })
            }
          />
          <View style={styles.off} accessibilityState={{ disabled: true }}>
            <Row label="Cancel with full refunds" note="Only when the host is suspended" />
          </View>
        </Group>
      ) : (
        <StaffNote>You’re on this host’s team, so someone else acts on it.</StaffNote>
      )}
    </Page>
  );
});

const styles = StyleSheet.create({
  poster: { borderBottomLeftRadius: CORNER, borderBottomRightRadius: CORNER, overflow: 'hidden' },
  title: { marginHorizontal: 20, marginTop: space.big, fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text },
  tags: { marginHorizontal: 20, marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  off: { opacity: 0.4 },
});
