// Host, Orbit Launch's third tab (route `team`). Host take 1, approved 22 Nov 2026
// (https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg), from the Hosts flow doc (Becoming a host, Host profile and
// settings, Team and roles):
// - the host as people see it: logo, name with the verified tick or Unverified, kind and city, followers; Edit host,
//   Share page and View;
// - Get verified, while it isn't: what the tick brings, and Ask Orbit to verify (Admins);
// - Finish your page: only what's missing (logo, banner, about), each gone once done;
// - Admins, the owner marked, and Admin roles still waiting; Add an Admin, by phone or email. A tap on another Admin
//   removes them, on an invite withdraws it (or confirms it, once accepted, for whoever sent it);
// - Status: live, paused, suspended or archived; Pause and Archive for the owner alone;
// - You: your account (sign-in, security, Delete account), help, the web Console, and Sign out.
// From GET /hosts/:id (HostPage) and GET /hosts/:id/team; POST /hosts/:id/team invites, DELETE …/team/:seat removes or
// withdraws, POST …/team/:seat/confirm confirms (plan F31, L3).
// ponytail: Event teams (Event leads and Crew per event) stay hidden until the Crew slice (H3.3). Edit host, Get
// verified, Finish your page and the status moves open nothing yet; host pages on the web aren't built, so Share page
// and View wait for them. An invite's age shows once the team route sends when it went.
import { HOST_KINDS, type HostEvents, type HostPage, type Me } from '@orbit/contract';
import { markOf } from '@orbit/mobile/mark';
import { useLoad } from '@orbit/mobile/load';
import { showPhone } from '@orbit/mobile/signin';
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Host as HostOf, useHost } from '../../launch/host';
import { useInvites } from '../../launch/invites';
import { spokenContact, statusMoves, statusNote } from '../../launch/team';
import { Card, Field, Glow, HostHead, Monogram, Note, PERSON_INDENT, Person, Pill, Row, Section, Tag, Verified, styles as ui } from '../../launch/ui';
import { api, refreshMe, signOut, useSession } from '../../session';

// GET /hosts/:id/team, as api/src/roles/routes.ts sends it.
type Member = { id: string; userId: string | null; name: string | null; role: 'admin' | 'crew'; owner: boolean };
type Invite = { id: string; contact: string; accepted: boolean; acceptedBy: string | null; addedBy: string };
type TeamList = { members: Member[]; invites: Invite[] };

const STATUS = { live: 'Live', paused: 'Paused', suspended: 'Suspended by Orbit', archived: 'Archived' } as const;
const followers = (n: number) => `${n.toLocaleString('en-IN')} follower${n === 1 ? '' : 's'}`;
const kindOf = (k: string) => HOST_KINDS[k as keyof typeof HOST_KINDS] ?? k;
const shownContact = (c: string) => (/^\+91\d{10}$/.test(c) ? showPhone(c) : c);

export default function Host() {
  const host = useHost();
  const me = useSession()?.me;
  // Keyed by host: switching host starts the tab afresh (no half-typed invite or error from the last one).
  return host && me ? <HostTab key={host.id} host={host} me={me} /> : null;
}

function HostTab({ host, me }: { host: HostOf; me: Me }) {
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const id = host.id;
  const page = useLoad<HostPage>(`host|${id}`, () => api.authed<HostPage>('GET', `/hosts/${id}`));
  const team = useLoad<TeamList>(`team|${id}`, () => api.authed<TeamList>('GET', `/hosts/${id}/team`));
  const events = useLoad<HostEvents>(`events|${id}`, () => api.authed<HostEvents>('GET', `/hosts/${id}/events`));
  const mine = useInvites(); // invites to this account, from any host
  const [adding, setAdding] = useState(false);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = mine.invites.data ?? [];

  const p = page.data;
  const admins = (team.data?.members ?? []).filter((m) => m.role === 'admin');
  const invites = team.data?.invites ?? [];
  const owner = !!p?.owner;
  const shown = p?.status === 'live' || p?.status === 'paused'; // a suspended or archived host is off Orbit
  const publicPage = p?.visibility === 'public';
  // Pausing or archiving waits while an event coming up has bookings (open refunds join this with the money API).
  const wait = (events.data?.upcoming ?? []).some((e) => e.sold > 0);
  const moves = p ? statusMoves(p.status, owner, wait) : [];
  const statusLine = p ? statusNote(p.status, owner, wait) : undefined;
  const missing = p
    ? [
        !p.banner && { label: 'Add a banner', note: '4:3, across the top of your page' },
        !p.logo && { label: 'Add your logo', note: 'Square; your initials show till then' },
        !p.about && { label: 'Say what you do', note: 'A few lines about you' },
      ].filter((m) => !!m)
    : [];
  const loadError = page.error ?? team.error;

  // A write to the team, then the team read again; what went wrong shows under Admins.
  async function write(run: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>) {
    setBusy(true);
    setError(null);
    const r = await run();
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    team.reload();
    return r.ok;
  }
  const end = (seat: string) => write(() => api.authed('DELETE', `/hosts/${host.id}/team/${seat}`));
  const invite = async () => {
    if (await write(() => api.authed('POST', `/hosts/${host.id}/team`, { to: to.trim() }))) {
      setTo('');
      setAdding(false);
    }
  };
  const remove = (m: Member) =>
    Alert.alert(`Remove ${m.name ?? 'this Admin'}?`, 'They stop being an Admin of this host.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void end(m.id) },
    ]);
  const answer = (i: Invite) =>
    Alert.alert(shownContact(i.contact), i.accepted ? `Accepted by ${i.acceptedBy ?? 'someone'}. Confirm it’s them to make them an Admin.` : 'Waiting for them to accept.', [
      { text: 'Cancel', style: 'cancel' },
      ...(i.accepted && i.addedBy === me.id ? [{ text: 'Confirm', onPress: () => void write(() => api.authed('POST', `/hosts/${host.id}/team/${i.id}/confirm`)) }] : []),
      { text: 'Withdraw invite', style: 'destructive' as const, onPress: () => void end(i.id) },
    ]);
  const reload = () => {
    page.reload();
    team.reload();
    events.reload();
    mine.invites.reload();
    void refreshMe(); // an Admin seat added or ended elsewhere
  };

  return (
    <View style={styles.page}>
      <Glow tint={host.bg} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={(page.loading && !!page.data) || (team.loading && !!team.data)} onRefresh={reload} tintColor={color.secondary} />}
      >
        <HostHead host={host} />
        {loadError && <Note>{loadError.message}</Note>}

        {p && (
          <View style={[ui.card, styles.pageCard]}>
            <View style={styles.headRow}>
              <Monogram host={host} size={64} />
              <View style={styles.headLines}>
                {/* The tick stays beside the name, which wraps to two lines before it gives way. */}
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={2}>
                    {p.name}
                  </Text>
                  {p.verified ? <Verified /> : <Tag text="Unverified" />}
                </View>
                <Text style={styles.meta}>{`${kindOf(p.kind)} · ${p.city}`}</Text>
                <Text style={styles.meta}>{publicPage ? followers(p.followers) : 'Private: no public page'}</Text>
              </View>
            </View>
            <View style={styles.pills}>
              <Pill label="Edit host" />
              {publicPage && shown && <Pill label="Share page" />}
              {publicPage && shown && <Pill label="View ↗" />}
            </View>
          </View>
        )}

        {p && !p.verified && shown && (
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

        {team.data && (
          <>
            <Section title="Admins" />
            <Card indent={PERSON_INDENT}>
              {admins.map((a) => {
                const name = a.name ?? 'No name yet';
                const initials = a.name ? markOf({ id: a.userId ?? a.id, name: a.name }).initials : undefined;
                const role = a.owner ? 'Owner' : 'Admin';
                return a.userId === me.id ? (
                  <Row key={a.id} lead={<Person initials={initials} you />} label={`${name} (you)`} value={role} spoken={`${name}, you, ${role}`} />
                ) : (
                  <Row
                    key={a.id}
                    lead={<Person initials={initials} />}
                    label={name}
                    value={role}
                    spoken={`${name}, ${role}`}
                    onPress={a.owner || busy ? undefined : () => remove(a)}
                  />
                );
              })}
              {invites.map((i) => {
                const note = i.accepted ? `Accepted by ${i.acceptedBy ?? 'someone'} · confirm it’s them` : 'Invited · not accepted yet';
                return (
                  <Row
                    key={i.id}
                    lead={<Person waiting />}
                    label={shownContact(i.contact)}
                    note={note}
                    spoken={`${spokenContact(shownContact(i.contact))}. ${note}`}
                    onPress={busy ? undefined : () => answer(i)}
                  />
                );
              })}
            </Card>
            {adding ? (
              <View style={styles.adding}>
                <Field
                  label="Their phone or email"
                  value={to}
                  onChangeText={setTo}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoFocus
                  onSubmitEditing={() => void (to.trim() && !busy && invite())}
                />
                <View style={styles.pills}>
                  <Pill label={busy ? 'Sending…' : 'Send invite'} dark onPress={to.trim() && !busy ? () => void invite() : undefined} />
                  <Pill label="Cancel" onPress={() => setAdding(false)} />
                </View>
              </View>
            ) : (
              <View style={styles.add}>
                <Pill label="Add an Admin" dark onPress={() => setAdding(true)} />
              </View>
            )}
            {error && <Note>{error}</Note>}
            <Note>Admins run everything here, the bank account too.</Note>
          </>
        )}

        {waiting.length > 0 && (
          <>
            <Section title="Invites" />
            <Card indent={44 + 12}>
              {waiting.map((i) => (
                <Row
                  key={i.id}
                  lead={<Monogram host={markOf({ id: i.hostId, name: i.hostName })} size={44} />}
                  label={i.hostName}
                  note={i.accepted ? `${i.role === 'admin' ? 'Admin' : 'Crew'} · accepted, waiting for them to confirm it’s you` : i.role === 'admin' ? 'Admin' : 'Crew'}
                  right={i.accepted ? undefined : <Pill label={mine.busy === i.id ? 'Accepting…' : 'Accept'} onPress={mine.busy ? undefined : () => void mine.accept(i)} />}
                />
              ))}
            </Card>
            {mine.error && <Note>{mine.error}</Note>}
          </>
        )}

        {p && (
          <>
            <Section title="Status" />
            <Card>
              <Row label={STATUS[p.status]} dot={p.status === 'live'} value={p.status === 'live' ? (publicPage ? 'Public page' : 'Link only') : undefined} />
              {moves.map((m) => (
                <Row key={m.label} label={m.label} value={m.value} onPress={m.open ? () => {} : undefined} />
              ))}
            </Card>
            {statusLine && <Note>{statusLine}</Note>}
          </>
        )}

        <Section title="You" />
        <Card>
          <Row label="Account" value="Sign-in, security, delete" onPress={() => {}} />
          <Row label="Help and support" onPress={() => router.push('/help')} />
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
  adding: { marginTop: 16, marginHorizontal: 20, gap: 12 },
});
