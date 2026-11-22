// Host, Orbit Launch's third tab (route `team`). Host take 1, approved 22 Nov 2026
// (https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg), from the Hosts flow doc (Becoming a host, Host profile and
// settings, Team and roles):
// - the host as people see it: logo, name with the verified tick or Unverified, kind and city, followers; Edit host,
//   Share page and View;
// - Get verified, while it isn't: what the tick brings, and Ask Orbit to verify (Admins);
// - Finish your page: only what's missing (logo, banner, about), each gone once done;
// - Admins, the owner marked, and Admin roles still waiting with their 14 days; Add an Admin. Event leads and Crew are
//   added on each event, so Event teams lists each coming event's team and opens it;
// - Status: live, paused, suspended or archived; Pause and Archive for the owner alone;
// - You: your account (sign-in, security, Delete account), help, the web Console, and Sign out.
// ponytail: Admins' view, from the mock. Every row and button opens nothing yet except the web Console; host pages on the
// web aren't built, so Share page and View wait for them. Sign out leaves the dev demo for Sign in.
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space } from '@orbit/mobile/theme';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { adminInvites, admins, drafts, endsAt, eventTeams, events, host, invites, now, page, sales } from '../../launch/data';
import { dayWord, startsToday } from '../../launch/day';
import { inviteLine, mustWait, spokenContact, statusMoves, statusNote, teamLine } from '../../launch/team';
import { signOut } from '../../session';
import { Card, Glow, HostHead, Monogram, Note, PERSON_INDENT, Person, Pill, Row, Section, Tag, Verified, styles as ui } from '../../launch/ui';

const STATUS = { live: 'Live', paused: 'Paused', suspended: 'Suspended by Orbit', archived: 'Archived' } as const;
const date = (when: string) => when.split(' · ')[0]; // "Fri 20 Nov"
const followers = (n: number) => `${n.toLocaleString('en-IN')} follower${n === 1 ? '' : 's'}`;

export default function Host() {
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const you = admins.find((a) => a.you);
  const owner = !!you?.owner;
  // Events not yet ended, soonest first, then drafts: whose teams can still change.
  const coming = events.filter((e) => Date.parse(endsAt(e)) >= now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const shown = page.status === 'live' || page.status === 'paused'; // a suspended or archived host is off Orbit
  const publicPage = page.visibility === 'public';
  const wait = mustWait(sales, now);
  const moves = statusMoves(page.status, owner, wait);
  const statusLine = statusNote(page.status, owner, wait);
  const missing = [
    !page.banner && { label: 'Add a banner', note: '4:3, across the top of your page' },
    !page.logo && { label: 'Add your logo', note: 'Square; your initials show till then' },
    !page.about && { label: 'Say what you do', note: 'A few lines about you' },
  ].filter((m) => !!m);

  return (
    <View style={styles.page}>
      <Glow tint={host.bg} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }} onScroll={onScroll} scrollEventThrottle={16}>
        <HostHead host={host} />

        <View style={[ui.card, styles.pageCard]}>
          <View style={styles.headRow}>
            <Monogram host={host} size={64} />
            <View style={styles.headLines}>
              {/* The tick stays beside the name, which wraps to two lines before it gives way. */}
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={2}>
                  {host.name}
                </Text>
                {page.verified ? <Verified /> : <Tag text="Unverified" />}
              </View>
              <Text style={styles.meta}>{`${page.kind} · ${page.city}`}</Text>
              <Text style={styles.meta}>{publicPage ? followers(page.followers) : 'Private: no public page'}</Text>
            </View>
          </View>
          <View style={styles.pills}>
            <Pill label="Edit host" />
            {publicPage && shown && <Pill label="Share page" />}
            {publicPage && shown && <Pill label="View ↗" />}
          </View>
        </View>

        {!page.verified && shown && (
          <>
            <Section title="Get verified" />
            <View style={[ui.card, styles.verify]}>
              <Text style={styles.verifyText}>
                Orbit checks you’re who you say. You get the tick, a place first in host lists, and a push to your city for each new event.
              </Text>
              <View style={styles.pills}>
                <Pill label="Ask Orbit to verify" />
              </View>
            </View>
          </>
        )}

        {missing.length > 0 && (
          <>
            <Section title="Finish your page" />
            <Card>
              {missing.map((m) => (
                <Row key={m.label} label={m.label} note={m.note} onPress={() => {}} />
              ))}
            </Card>
          </>
        )}

        <Section title="Admins" />
        <Card indent={PERSON_INDENT}>
          {admins.map((a) =>
            a.you ? (
              <Row
                key={a.id}
                lead={<Person initials={a.initials} you />}
                label={`${a.name} (you)`}
                value={a.owner ? 'Owner' : 'Admin'}
                spoken={`${a.name}, you, ${a.owner ? 'Owner' : 'Admin'}`}
              />
            ) : (
              <Row
                key={a.id}
                lead={<Person initials={a.initials} />}
                label={a.name}
                value={a.owner ? 'Owner' : 'Admin'}
                spoken={`${a.name}, ${a.owner ? 'Owner' : 'Admin'}`}
                onPress={() => {}}
              />
            ),
          )}
          {adminInvites.map((i) => (
            <Row
              key={i.id}
              lead={<Person waiting />}
              label={i.contact}
              note={inviteLine(i.sentAt, now)}
              value="Admin"
              spoken={`${spokenContact(i.contact)}, invited as Admin. ${inviteLine(i.sentAt, now)}`}
              onPress={() => {}}
            />
          ))}
        </Card>
        <View style={styles.add}>
          <Pill label="Add an Admin" dark />
        </View>
        <Note>Admins run everything here, the bank account too. Event leads and Crew are added on each event.</Note>

        {coming.length + drafts.length > 0 && (
          <>
            <Section title="Event teams" />
            <Card>
              {coming.map((e) => (
                <Row
                  key={e.id}
                  label={`${e.title} · ${startsToday(e.startsAt, now) ? dayWord(e.startsAt, now).toLowerCase() : date(e.when)}`}
                  note={teamLine(eventTeams[e.id], invites.filter((i) => i.eventId === e.id).length)}
                  onPress={() => {}}
                />
              ))}
              {drafts.map((d) => (
                <Row key={d.id} label={d.name} note="Draft · no team yet" onPress={() => {}} />
              ))}
            </Card>
          </>
        )}

        <Section title="Status" />
        <Card>
          <Row label={STATUS[page.status]} dot={page.status === 'live'} value={page.status === 'live' ? (publicPage ? 'Public page' : 'Link only') : undefined} />
          {moves.map((m) => (
            <Row key={m.label} label={m.label} value={m.value} onPress={m.open ? () => {} : undefined} />
          ))}
        </Card>
        {statusLine && <Note>{statusLine}</Note>}

        <Section title="You" />
        <Card>
          <Row label="Account" value="Sign-in, security, delete" onPress={() => {}} />
          <Row label="Help and support" onPress={() => {}} />
          <Row label="Open the web Console" external onPress={() => Linking.openURL('https://console.heyorbit.in').catch(() => {})} />
          <Row label="Sign out" plain onPress={signOut} />
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  pageCard: { marginTop: space.big, gap: 16 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headLines: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: font.headline, fontSize: 20, lineHeight: 26, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  verify: { gap: 16 },
  verifyText: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary },
  add: { marginTop: 16, marginHorizontal: 20, flexDirection: 'row' },
});
