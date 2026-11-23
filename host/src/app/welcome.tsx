// Signed in to Orbit Launch and on no host yet (sign-in take, approved 22 Nov 2026: the "no host yet" board): invites
// waiting for this account, read from the API (GET /me/invites) and accepted there (POST /invites/:id/accept); then
// Host on Orbit, the Event Request (Hosts flow, Becoming a host); then which number and email to give a host; and Sign
// out. An accepted Admin role starts once whoever added you confirms it's you, so it shows as waiting until then.
// Pull down to look for new invites. An account set to be deleted says so, with the day.
// ponytail: Start a request opens nothing until the Event Request API is built (owner, 22 Nov 2026: "Event Request API",
// next), so it shows faded. Someone already on a host sees a line saying their events come here next, until Launch's tabs read the API.
import { markOf } from '@orbit/mobile/mark';
import { useLoad } from '@orbit/mobile/load';
import { showPhone } from '@orbit/mobile/signin';
import { color, font, space } from '@orbit/mobile/theme';
import { useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Monogram, Note, Pill, Section, styles as ui } from '../launch/ui';
import { api, refreshMe, signOut, useSession } from '../session';
import { thisApp } from '../variant';

const ICON = require('../../assets/icons/launch.png');
type Invite = { id: string; hostId: string; hostName: string; role: 'admin'; accepted: boolean };
const ROLE = { admin: 'Admin' } as const;
// "Sat 20 Dec", the day an account's deletion is due, in India time.
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const me = session && 'me' in session ? session.me : null;
  const invites = useLoad<Invite[]>(me ? `invites|${me.id}` : null, () => api.authed<Invite[]>('GET', '/me/invites'));
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  const first = me.name?.trim().split(/\s+/)[0];
  const waiting = (invites.data ?? []).filter((i) => !hidden.has(i.id));
  const onTeams = me.teams.length;
  const contacts = [me.phone && showPhone(me.phone), me.email].filter(Boolean).join(' or ');

  async function accept(i: Invite) {
    setBusy(i.id);
    setError(null);
    const r = await api.authed('POST', `/invites/${i.id}/accept`);
    setBusy(null);
    if (!r.ok) return setError(r.error.message);
    invites.reload();
    void refreshMe(); // a started role shows in the account's teams
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.body, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + space.big }]}
      refreshControl={
        <RefreshControl
          refreshing={invites.loading && !!invites.data}
          onRefresh={() => {
            invites.reload();
            void refreshMe();
          }}
          tintColor={color.secondary}
        />
      }
    >
      <View style={styles.brand}>
        <Image source={ICON} style={styles.icon} accessible={false} />
        <Text style={styles.brandName}>{thisApp.name}</Text>
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {first ? `Hi, ${first}` : 'Hi'}
      </Text>
      <Text style={styles.line}>
        {onTeams
          ? `You’re on ${onTeams === 1 ? 'a host' : `${onTeams} hosts`}. Your events come here next.`
          : 'You’re not on a host yet. Accept an invite, or start your own.'}
      </Text>
      {me.deletionDue && <Note>{`Your account is set to be deleted on ${dayOf(me.deletionDue)}. To keep it, open the Orbit app and tap Keep my account.`}</Note>}

      {waiting.length > 0 && (
        <>
          <Section title="Waiting for you" />
          <View style={styles.cards}>
            {waiting.map((i) => (
              <View key={i.id} style={[ui.card, styles.invite]}>
                <View style={styles.inviteHead}>
                  <Monogram host={markOf({ id: i.hostId, name: i.hostName })} size={44} />
                  <View style={styles.inviteLines}>
                    <Text style={styles.inviteName}>{i.hostName}</Text>
                    <Text style={styles.small}>{i.accepted ? `${ROLE[i.role]} · accepted, waiting for them to confirm it’s you` : ROLE[i.role]}</Text>
                  </View>
                </View>
                {!i.accepted && (
                  <View style={styles.pills}>
                    <Pill label={busy === i.id ? 'Accepting…' : 'Accept'} onPress={busy ? undefined : () => accept(i)} />
                    <Pill label="Not now" onPress={() => setHidden((s) => new Set(s).add(i.id))} />
                  </View>
                )}
              </View>
            ))}
          </View>
        </>
      )}
      {invites.error && <Note>{invites.error.message}</Note>}
      {error && <Note>{error}</Note>}

      <Section title="Host on Orbit" />
      <View style={[ui.card, styles.invite]}>
        <Text style={styles.cardLine}>Tell us about you and your first event. Orbit checks it, usually within a day, and you’re live.</Text>
        <View style={[styles.pills, styles.soon]} accessibilityState={{ disabled: true }}>
          <Pill label="Start a request" />
        </View>
      </View>
      {contacts ? <Note>{`Expecting an invite? Ask your host to add ${contacts}.`}</Note> : null}

      <View style={styles.foot}>
        <Pill label="Sign out" onPress={signOut} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  body: { flexGrow: 1 },
  brand: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 10 },
  brandName: { fontFamily: font.title, fontSize: 17, color: color.text },
  title: { marginTop: space.big, marginHorizontal: 20, fontFamily: font.headline, fontSize: 28, lineHeight: 34, letterSpacing: -0.3, color: color.text },
  line: { marginTop: space.small, marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  cards: { gap: space.big },
  invite: { gap: 16 },
  inviteHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inviteLines: { flex: 1, gap: 2 },
  inviteName: { fontFamily: font.title, fontSize: 15, color: color.text },
  small: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  cardLine: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  foot: { marginTop: 'auto', paddingTop: space.big, marginHorizontal: 20, flexDirection: 'row' },
  soon: { opacity: 0.4 },
});
