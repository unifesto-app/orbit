// Signed in to Orbit Launch and on no host yet, or to Play Partner on no venue's team (no Host on Orbit there) (sign-in take, approved 22 Nov 2026: the "no host yet" board): invites
// waiting for this account, read from the API (GET /me/invites) and accepted there (POST /invites/:id/accept); then
// Host on Orbit, the Event Request (Hosts flow, Becoming a host); then which number and email to give a host; and Sign
// out. An accepted Admin role starts once whoever added you confirms it's you, so it shows as waiting until then.
// Pull down to look for new invites. An account set to be deleted says so, with the day.
// Host on Orbit follows the latest Event Request (GET /me/event-request; take 1, approved 26 Nov 2026): Start a request,
// or the request waiting (See request, Withdraw), Orbit's note on changes asked (Edit request) or a decline (Start a new
// request). Approved, the account is read again and the Admin redirect below takes over. Someone on a host's team but
// not its Admin is told Event Partner is for Admins; an Admin goes to the tabs.
// Play Partner (X9) shows the same request card, as List your venue: a Venue request with no event. Approved, the new
// Admin seat on the Venue opens Today, which sends a venue not set up yet to setup. Another kind's approved request
// (sent from Event Partner) makes no seat here, so it reads as no request.
import { markOf } from '@orbit/mobile/mark';
import { showPhone } from '@orbit/mobile/signin';
import { color, font, space } from '@orbit/mobile/theme';
import type { EventRequest } from '@orbit/contract';
import { useLoad } from '@orbit/mobile/load';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Image, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InboxButton } from '../inboxButton';
import { adminHosts, mustPick } from '../launch/host';
import { useInvites } from '../launch/invites';
import { dayLabel, istDate } from '../launch/money';
import { errorText, sentLabel, welcomeState } from '../launch/request';
import { Monogram, Note, Pill, Section, Tag, styles as ui } from '../launch/ui';
import { api, kept, refreshMe, REQUEST_DRAFT, signOut, useSession } from '../session';
import { seats } from '../station/seats';
import { isStation, thisApp } from '../variant';

const ICON = {
  launch: require('../../assets/icons/launch.png'),
  station: require('../../assets/icons/station.png'),
  crew: require('../../assets/icons/crew.png'),
}[thisApp.word]; // static requires, for Metro
const ROLE = { admin: 'Admin', crew: isStation ? 'Desk' : 'Crew' } as const;
// "Sat 20 Dec", the day an account's deletion is due, in India time.
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const me = session?.me ?? null;
  const { invites, busy, error, accept } = useInvites();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const request = useLoad<EventRequest | null>(me ? `request|${me.id}` : null, () => api.authed('GET', '/me/event-request'));
  const [said, setSaid] = useState<string | null>(null); // a refused withdraw
  const [withdrawing, setWithdrawing] = useState(false);
  const r = request.data;
  const state = welcomeState(isStation && r?.status === 'approved' && r.host.kind !== 'venue' ? null : r);
  const approved = useRef(false);
  approved.current = state === 'approved';
  // Back from the form (sent, or left mid-way): read the request again, showing no card until it's in, so a request
  // just sent never shows as what it was. Not on the first focus, which the load covers. Approved, the account too.
  const [stale, setStale] = useState(false);
  useEffect(() => setStale(false), [request.data, request.error]); // each answer, good or not, is a new object
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) {
        setStale(true);
        setSaid(null);
        request.reload();
        if (approved.current) void refreshMe();
      }
      seen.current = true;
    }, [request.reload]),
  );
  useEffect(() => {
    if (state === 'approved') void refreshMe(); // the new Admin seat, so the redirect to Events takes over
  }, [state, r?.id]);
  // The card shows only on an answer read this visit; while loading or after a failure, only the error (pull retries).
  const loaded = !request.loading && !request.error && !stale;

  function withdraw() {
    Alert.alert('Withdraw your request?', 'Orbit stops checking it. You can send a new one later.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setWithdrawing(true);
          setSaid(null);
          const out = await api.authed('DELETE', '/me/event-request');
          setWithdrawing(false);
          if (out.ok) kept.set(REQUEST_DRAFT, null); // an edit in progress goes with it
          else {
            const why = errorText(out.error);
            setSaid(why);
            if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(why);
          }
          request.reload();
        },
      },
    ]);
  }
  if (!me) return null;
  if (isStation && seats(me).length) return <Redirect href="/today" />; // an accepted seat opens Today
  if (!isStation && adminHosts(me).length) return <Redirect href={mustPick(me) ? '/pick' : '/events'} />; // an Admin opens Events

  const first = me.name?.trim().split(/\s+/)[0];
  const waiting = (invites.data ?? []).filter((i) => !hidden.has(i.id));
  const onTeams = me.teams.length;
  const contacts = [me.phone && showPhone(me.phone), me.email].filter(Boolean).join(' or ');

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.body, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + space.big }]}
      refreshControl={
        <RefreshControl
          refreshing={invites.loading && !!invites.data}
          onRefresh={() => {
            invites.reload();
            setSaid(null);
            request.reload();
            void refreshMe();
          }}
          tintColor={color.secondary}
        />
      }
    >
      <View style={styles.brand}>
        <Image source={ICON} style={styles.icon} accessible={false} />
        <Text style={styles.brandName}>{thisApp.name}</Text>
        <InboxButton style={styles.inbox} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {first ? `Hi, ${first}` : 'Hi'}
      </Text>
      <Text style={styles.line}>
        {state === 'waiting'
          ? 'Your request is with Orbit. We’ll tell you as soon as it’s checked.'
          : state === 'changes'
          ? 'Orbit asked for a change before your host goes live.'
          : isStation
          ? 'You’re not on a venue’s team yet. Accept an invite from a venue’s Admin, or list your own.'
          : onTeams
          ? `You’re on ${onTeams === 1 ? 'a host’s team' : `${onTeams} hosts’ teams`}, but not as an Admin. Event Partner is for Admins.`
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

      {loaded && state === 'approved' && (
        <>
          <Section title="Your request" />
          <View style={[ui.card, styles.invite]}>
            <Text style={styles.cardLine}>{`Approved. Opening your ${isStation ? 'venue' : 'host'}…`}</Text>
          </View>
        </>
      )}
      {loaded && state !== 'approved' && (r && (state === 'waiting' || state === 'changes' || state === 'declined') ? (
        <>
          <Section title={state === 'declined' ? 'Your last request' : 'Your request'} />
          <View style={[ui.card, styles.invite]}>
            <View style={styles.cardHead}>
              <Text style={[styles.inviteName, styles.shrink]} numberOfLines={1}>
                {r.host.name}
              </Text>
              <Tag text={state === 'waiting' ? 'Checking' : state === 'changes' ? 'Changes asked' : 'Not approved'} live={state === 'waiting'} />
            </View>
            {state === 'waiting' ? (
              <Text style={styles.cardLine}>{`${r.event ? `${r.event.title} · ${dayLabel(istDate(Date.parse(r.event.startsAt)))}\n` : ''}${sentLabel(r.updatedAt, Date.now())}`}</Text>
            ) : (
              r.note ? <Text style={styles.quote}>{r.note}</Text> : null
            )}
            <View style={styles.pills}>
              {state === 'waiting' && <Pill label="See request" onPress={() => router.push('/request?mode=see')} />}
              {state === 'changes' && <Pill label="Edit request" onPress={() => router.push('/request?mode=edit')} />}
              {state === 'declined' && <Pill label="Start a new request" onPress={() => router.push('/request')} />}
              {state !== 'declined' && (
                <Pill label={withdrawing ? 'Withdrawing…' : 'Withdraw'} onPress={withdrawing ? undefined : withdraw} />
              )}
            </View>
          </View>
        </>
      ) : (
        <>
          <Section title={isStation ? 'List your venue' : 'Host on Orbit'} />
          <View style={[ui.card, styles.invite]}>
            <Text style={styles.cardLine}>
              {isStation
                ? 'Tell us about your venue. Orbit checks it, usually within a day, then you set up its hours and stations here.'
                : 'Tell us about you and your first event. Orbit checks it, usually within a day, and you’re live.'}
            </Text>
            <View style={styles.pills}>
              <Pill label="Start a request" onPress={() => router.push('/request')} />
            </View>
          </View>
        </>
      ))}
      {request.error && <Note live>{request.error.message}</Note>}
      {said && <Note live>{said}</Note>}
      {contacts ? <Note>{`Expecting an invite? Ask ${isStation ? 'the venue' : 'your host'} to add ${contacts}.`}</Note> : null}

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
  inbox: { marginLeft: 'auto' }, // the round Inbox, as beside the tabs: a seat just ended still has its message
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
  shrink: { flexShrink: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  quote: { borderLeftWidth: 2, borderLeftColor: color.accent, paddingLeft: 12, fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.text }, // Orbit's own words; the Sage edge is an element

  foot: { marginTop: 'auto', paddingTop: space.big, marginHorizontal: 20, flexDirection: 'row' },
});
