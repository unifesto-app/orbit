// Galaxy's Find (Galaxy doc, People and Hosts, events; Galaxy canvas, 16 Nov 2026): one box for people, hosts and events,
// narrowed by chip. People match by name, phone or email; events by their title or their host's name. Contacts show
// masked; a person's page has Show. With the API every search by phone or email is logged (Galaxy decision 7), though
// the screen doesn't say so (owner, 16 Nov 2026: "remove text searches by phone or email are logged"), and it finds
// ticket codes and Razorpay payment ids too.
// Hosts also come from the API (GET /galaxy/hosts: by name, or a host's exact link), listed above the mock's.
// ponytail: people and events match the mock only, from 2 letters; each letter typed asks the API again, and only the
// latest answer is drawn.
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chips, Group, Row } from '../../../account/kit';
import { maskPhone } from '../../../account/rules';
import { accounts, reports } from '../../../galaxy/data';
import { gated } from '../../../galaxy/kit';
import { hostsApi, markOf } from '../../../hosts';
import { useLoad } from '../../../load';
import { Empty, TabPage } from '../../../modeKit';
import { events, hosts } from '../../../mock';
import { canActOn, hasFeature } from '../../../modes';
import { Monogram, SearchBox, Tag } from '../../../rows';
import { api, useMe } from '../../../session';
import { color, space } from '../../../theme';

const hostOf = (id: string) => hosts.find((h) => h.id === id);

export default gated(['people', 'hosts'], function Find() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'All' | 'People' | 'Hosts' | 'Events'>('All');
  const me = useMe();
  // People need the People feature; hosts and events need Hosts and events (Roles doc).
  const [seesPeople, seesHosts] = [hasFeature(me, 'people'), hasFeature(me, 'hosts')];
  const kinds = (['All', 'People', 'Hosts', 'Events'] as const).filter((k) => k === 'All' || (k === 'People' ? seesPeople : seesHosts));
  const shows = (k: 'People' | 'Hosts' | 'Events') => kind === 'All' || kind === k;

  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const hit = (...texts: (string | undefined)[]) => q.length >= 2 && texts.some((t) => t?.toLowerCase().includes(q));
  const found = {
    people: seesPeople && shows('People') ? accounts.filter((a) => hit(a.name, a.email) || (digits.length >= 4 && a.phone.includes(digits))) : [],
    hosts: seesHosts && shows('Hosts') ? hosts.filter((h) => hit(h.name)) : [],
    events: seesHosts && shows('Events') ? events.filter((e) => hit(e.title, hostOf(e.hostId)?.name)) : [],
  };
  const live = useLoad(seesHosts && shows('Hosts') && q.length >= 2 ? `${q}|${me.id}` : null, () => hostsApi(api).find(q));
  const real = live.data ?? [];
  const none = !found.people.length && !found.hosts.length && !found.events.length && !real.length && !live.loading;
  return (
    <TabPage head="Find" tint={color.galaxy}>
      <View style={styles.box}>
        <SearchBox value={query} onChangeText={setQuery} placeholder="Name, phone, email, ticket or payment" autoCapitalize="none" />
      </View>
      {kinds.length > 2 && (
        <View style={styles.chips}>
          <Chips options={kinds} value={kind} onChange={setKind} />
        </View>
      )}
      {q.length >= 2 && none && <Empty>No matches.</Empty>}
      {found.people.length > 0 && (
        <Group title="People">
          {found.people.map((a) => (
            <Row
              key={a.id}
              label={a.name}
              note={`${maskPhone(a.phone)} · Since ${a.since}`}
              right={a.id === me.id ? <Tag text="You" /> : a.suspended ? <Tag text="Suspended" /> : undefined}
              onPress={() => router.push(`/galaxy/person/${a.id}`)}
            />
          ))}
        </Group>
      )}
      {live.error && <Empty>{live.error.message}</Empty>}
      {(real.length > 0 || found.hosts.length > 0) && (
        <Group title="Hosts">
          {real.map((h) => (
            <Row
              key={h.id}
              lead={<Monogram mark={markOf(h)} size={32} />}
              label={h.name}
              note={canActOn(me, { hostId: h.id }) ? `${h.city}${h.status === 'live' ? '' : ` · ${h.status[0]!.toUpperCase()}${h.status.slice(1)}`}` : `Your team · ${h.city}`}
              right={<Tag text={h.verified ? 'Verified' : 'Unverified'} />}
              onPress={() => router.push(`/galaxy/host/${h.id}`)}
            />
          ))}
          {found.hosts.map((h) => (
            <Row
              key={h.id}
              lead={<Monogram mark={h} size={32} />}
              label={h.name}
              note={canActOn(me, { hostId: h.id }) ? `${h.kind} · ${h.area}` : `Your team · ${h.kind}`}
              right={<Tag text={h.verified ? 'Verified' : 'Unverified'} />}
              onPress={() => router.push(`/galaxy/host/${h.id}`)}
            />
          ))}
        </Group>
      )}
      {found.events.length > 0 && (
        <Group title="Events">
          {found.events.map((e) => (
            <Row
              key={e.id}
              label={e.title}
              note={`${hostOf(e.hostId)?.name ?? ''} · ${e.when.split(' · ')[0]}`}
              right={reports.some((r) => r.eventId === e.id) ? <Tag text="Reported" /> : undefined}
              onPress={() => router.push(`/galaxy/event/${e.id}`)}
            />
          ))}
        </Group>
      )}
    </TabPage>
  );
});

const styles = StyleSheet.create({
  box: { marginHorizontal: 20, marginTop: space.small },
  chips: { marginHorizontal: 20, marginTop: 16 },
});
