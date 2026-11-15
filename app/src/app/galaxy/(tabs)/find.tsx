// Galaxy's Find (Galaxy doc, People and Hosts, events, requests and reports): one box for people, hosts and events.
// With the API it also finds by phone, email, ticket code or Razorpay payment id, and logs every staff search by phone or
// email, as it logs each person's page opened and each contact shown (Galaxy decision 7). Person pages show contacts
// masked behind Show, and never a ticket link or QR.
// ponytail: matches names in the mock only, from 2 letters; the result rows don't open the staff pages yet.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Group, Row } from '../../../account/kit';
import { Empty, TabPage } from '../../../modeKit';
import { events, hosts, people } from '../../../mock';
import { hasFeature } from '../../../modes';
import { SearchBox } from '../../../rows';
import { useMe } from '../../../session';
import { space } from '../../../theme';

export default function Find() {
  const [query, setQuery] = useState('');
  const me = useMe();
  // People need the People feature; hosts and events need Hosts and events (Roles doc).
  const [seesPeople, seesHosts] = [hasFeature(me, 'people'), hasFeature(me, 'hosts')];
  const q = query.trim().toLowerCase();
  const hit = (name: string) => q.length >= 2 && name.toLowerCase().includes(q);
  const found = {
    people: seesPeople ? people.filter((p) => hit(p.name)) : [],
    hosts: seesHosts ? hosts.filter((h) => hit(h.name)) : [],
    events: seesHosts ? events.filter((e) => hit(e.title)) : [],
  };
  const none = !found.people.length && !found.hosts.length && !found.events.length;
  return (
    <TabPage head="Find">
      <View style={styles.box}>
        <SearchBox value={query} onChangeText={setQuery} placeholder="People, hosts, events" autoCapitalize="none" />
      </View>
      {q.length >= 2 && none && <Empty>No matches.</Empty>}
      {found.people.length > 0 && (
        <Group title="People">
          {found.people.map((p) => (
            <Row key={p.id} label={p.name} />
          ))}
        </Group>
      )}
      {found.hosts.length > 0 && (
        <Group title="Hosts">
          {found.hosts.map((h) => (
            <Row key={h.id} label={h.name} value={h.verified ? 'Verified' : 'Unverified'} />
          ))}
        </Group>
      )}
      {found.events.length > 0 && (
        <Group title="Events">
          {found.events.map((e) => (
            <Row key={e.id} label={e.title} value={e.when.split(' · ')[0]} />
          ))}
        </Group>
      )}
    </TabPage>
  );
}

const styles = StyleSheet.create({
  box: { marginHorizontal: 20, marginTop: space.small },
});
