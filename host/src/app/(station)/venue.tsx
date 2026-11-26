// Venue, for Admins (Station take 4, approved 22 Nov 2026: https://claude.ai/artifact/Me5XbAzWHUYi6muYwwSZrP, Take 4),
// laid out as Launch's Host tab with the Orbit app's Account-style cards. From the Play and Hosts flow docs:
// - the venue as people see it: logo, name with the tick, kind and area;
// - What you rent out: a row per kind (how many, the price an hour, off-peak, co-op, games), each edited in a sheet;
//   Orbit sets how bookings start and whether it's booked whole; Add a kind;
// - Hours: each day of the week, open or closed; how long before the start players can cancel; We log walk-ins;
// - Team: Admins (the owner marked) and Desk, invites waiting with their days left, Add Desk or an Admin;
// - Venue page (place, desk phone; name, logo and banner on the web Console), Status (launch/status.tsx, as on Launch's
//   Host tab: the owner pauses or archives here, and archiving is what lets an owner delete their account) and You.
// Changes that would strand a booking are refused in the sheet, naming the bookings (Play). Desk never comes here.
// It's the API's venue and team (state.tsx useLiveVenue); a venue not set up yet shows only how to start.
// ponytail: no followers count: it waits for the follows API.
// ponytail: no Share page or View, as on Launch's Host tab: they wait for the web host pages. Account opens the shared
// Account screen (account.tsx), Help opens Help and support (help.tsx). Launch's Card and Row until a shared host kit holds them.
import type { HostPage } from '@orbit/contract';
import { useLoad } from '@orbit/mobile/load';
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space } from '@orbit/mobile/theme';
import { type Href, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Row } from '../../launch/ui';
import { HostStatus } from '../../launch/status';
import { api, signOut } from '../../session';
import { useVenue } from '../../station/state';
import { Pill, Section } from '../../station/ui';
import { daysLeft, LOST_SEAT, priceLine, span } from '../../station/venue';
import { units } from '../../station/words';

const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CONSOLE = 'https://console.heyorbit.in';

export default function VenueTab() {
  const { venue: v, setup: s, load, said: told, tell, role, now, seat, changeSetup, archiveKind } = useVenue();
  const hostId = role === 'admin' ? seat?.hostId : undefined;
  const page = useLoad<HostPage>(hostId ? `host|${hostId}` : null, () => api.authed<HostPage>('GET', `/hosts/${hostId}`));
  const [said, setSaid] = useState<string | null>(null); // the walk-ins switch's or a Restore's refusal
  const [busy, setBusy] = useState(false);
  const [walkIns, setWalkIns] = useState<boolean | null>(null); // the switch's new value while it's sent
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  // One sheet per tap: a quick second tap doesn't push another.
  const last = useRef(0);
  const open = (href: Href) => {
    if (Date.now() - last.current < 800) return;
    last.current = Date.now();
    router.push(href);
  };
  if (role !== 'admin' || !load) return null; // settings are an Admin's
  const today = new Date(now + 330 * 60_000).getUTCDay(); // today's India calendar day
  const write = (run: () => Promise<string | null>) => {
    setBusy(true);
    setSaid(null);
    tell(null);
    return run().then((line) => (setBusy(false), setSaid(line), line));
  };
  const toConsole = () => Linking.openURL(CONSOLE).catch(() => {});
  const refresh = (
    <RefreshControl
      refreshing={false}
      onRefresh={() => {
        load.reload();
        page.reload();
      }}
      tintColor={color.secondary}
    />
  );
  // The host's status and the owner's moves (no "Not yet" here: the API names what's still open when it refuses).
  const status = page.data && hostId && (
    <>
      <Section title="Status" />
      <HostStatus id={hostId} status={page.data.status} owner={page.data.owner} wait={false} onDone={page.reload} />
    </>
  );
  const trouble = !load.error ? null : load.status === 0 ? 'Can’t reach Orbit. Pull to try again.' : load.status === 404 ? LOST_SEAT : load.error.message;
  // Before the venue lands, or a venue not set up yet: the name and what to do.
  if (!s)
    return (
      <ScrollView style={styles.page} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }} refreshControl={refresh}>
        <View style={styles.head}>
          <Text style={styles.name} accessibilityRole="header">
            {v.name}
          </Text>
        </View>
        {load.notSetUp ? (
          <>
            <OrbitSays text="Set up your venue: where it is, the desk phone and your hours. Then add what you rent out. Nobody can book till then." />
            <View style={styles.after}>
              <Pill label="Set up the venue" onPress={() => open({ pathname: '/setup', params: { what: 'first' } })} />
            </View>
          </>
        ) : (
          <OrbitSays text={trouble ?? 'Getting your venue…'} />
        )}
        {status}
        <Section title="You" />
        <Card>
          <Row label="Account" value="Sign-in, delete" onPress={() => router.push('/account')} />
          <Row label="Open the web Console" external onPress={toConsole} />
          <Row label="Sign out" onPress={signOut} />
        </Card>
      </ScrollView>
    );
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={refresh}
    >
      <View style={styles.head}>
        <View style={styles.top}>
          <View style={[styles.logo, { backgroundColor: v.bg }]}>
            <Text style={[styles.initials, { color: v.fg }]}>{v.initials}</Text>
          </View>
          <View style={styles.grow}>
            <View style={styles.nameRow}>
              <Text style={styles.name} accessibilityRole="header">
                {v.name}
              </Text>
              <View style={styles.tick} accessible accessibilityLabel="Verified">
                <Text style={styles.tickMark}>✓</Text>
              </View>
            </View>
            <Text style={styles.line}>
              {s.kind} · {v.area}
            </Text>
          </View>
        </View>
      </View>
      {trouble && <OrbitSays text={trouble} />}
      {told && <OrbitSays text={told} />}

      <Section title="What you rent out" aside="New prices, new bookings" />
      <Card>
        {v.types.map((t) => (
          <Row key={t.id} label={t.name} note={priceLine(t)} value={units(t, t.count)} onPress={() => open({ pathname: '/setup', params: { what: 'kind', type: t.id } })} />
        ))}
      </Card>
      <View style={styles.after}>
        <Pill label="Add a kind" onPress={() => open({ pathname: '/setup', params: { what: 'kind' } })} />
      </View>
      {!!s.archived?.length && (
        <Card style={styles.gap}>
          {s.archived.map((t) => (
            <Row key={t.id} label={t.name} note="Archived · nobody can book it" right={<Pill label="Restore" spoken={`Restore ${t.name}`} disabled={busy} onPress={() => void write(() => archiveKind(t.id, false))} />} />
          ))}
        </Card>
      )}

      <Section title="Hours" />
      <Card>
        {WEEK.map((d) => (
          <Row key={d} label={DAY_NAMES[d]} note={d === today ? 'Today' : undefined} value={span(s.week[d])} onPress={() => open({ pathname: '/setup', params: { what: 'day', dow: String(d) } })} />
        ))}
      </Card>
      <Card style={styles.gap}>
        <Row label="Players can cancel" value={`Up to ${s.cutoff / 60} hour${s.cutoff === 60 ? '' : 's'} before`} onPress={() => open({ pathname: '/setup', params: { what: 'cutoff' } })} />
        <Row
          label="We log walk-ins"
          note="Shows “4 free now” on Orbit"
          right={
            <Switch
              value={walkIns ?? s.logWalkIns}
              disabled={busy}
              onValueChange={(on) => {
                setWalkIns(on); // shown at once, back as it was on a refusal
                void write(() => changeSetup((x) => ({ ...x, logWalkIns: on }))).then(() => setWalkIns(null));
              }}
              trackColor={{ true: color.accent, false: color.track }}
              thumbColor={color.text}
              accessibilityLabel="We log walk-ins"
            />
          }
        />
      </Card>
      {said && <OrbitSays text={said} />}
      <Text style={styles.note}>{s.logWalkIns ? 'On: people see how many are free right now, so put every walk-in in on Today.' : 'Off: people see your hours and prices, never a free count.'}</Text>

      {/* ponytail: no "At your venue" (events asking to be here, Accept or Decline) or "Hosted here": they wait for the
          event-venue links API. */}

      <Section title="Team" />
      <Card>
        {s.team.map((m) => (
          <Row
            key={m.id}
            label={m.you ? 'You' : m.name}
            note={m.role === 'Desk' ? 'The counter: walk-ins, blocks, no-shows' : undefined}
            value={m.owner ? 'Owner' : m.role}
            onPress={m.you || m.owner ? undefined : () => open({ pathname: '/setup', params: { what: 'member', name: m.id } })}
          />
        ))}
        {s.invites
          .filter((x) => x.sent === undefined || daysLeft(x.sent, now) > 0) // an invite ends by itself after 14 days (the API leaves lapsed ones out)
          .map((x) => {
            const left = x.sent === undefined ? 0 : daysLeft(x.sent, now);
            return (
              <Row
                key={x.id}
                label={x.contact}
                note={x.accepted ? `Accepted by ${x.acceptedBy ?? 'them'} · ${x.byYou ? 'confirm it’s them' : 'waiting for a confirm'}` : x.sent === undefined ? 'Waiting' : `Waiting · ${left} day${left === 1 ? '' : 's'} left`}
                value={x.role}
                onPress={() => open({ pathname: '/setup', params: { what: 'invite', contact: x.id } })}
              />
            );
          })}
      </Card>
      <View style={styles.after}>
        <Pill label="Add Desk" onPress={() => open({ pathname: '/setup', params: { what: 'add', role: 'Desk' } })} />
        <Pill label="Add an Admin" onPress={() => open({ pathname: '/setup', params: { what: 'add', role: 'Admin' } })} />
      </View>
      <Text style={styles.note}>Desk works the counter and never sees money, prices or settings. Admins run everything here.</Text>

      <Section title="Venue page" />
      <Card>
        <Row label="Place" value={s.address} onPress={() => open({ pathname: '/setup', params: { what: 'field', key: 'address' } })} />
        <Row label="Desk phone" value={s.deskPhone} onPress={() => open({ pathname: '/setup', params: { what: 'field', key: 'deskPhone' } })} />
        <Row label="Name, logo and banner" value="Web Console" external onPress={toConsole} />
      </Card>
      {status}

      <Section title="You" />
      <Card>
        <Row label="Account" value="Sign-in, delete" onPress={() => router.push('/account')} />
        <Row label="Help and support" onPress={() => router.push('/help')} />
        <Row label="Open the web Console" external onPress={toConsole} />
        <Row label="Sign out" onPress={signOut} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  head: { marginHorizontal: 20, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 56, height: 56, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: font.headline, fontSize: 18 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text },
  tick: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' },
  tickMark: { fontFamily: font.headline, fontSize: 11, lineHeight: 13, color: color.ground },
  line: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  after: { marginTop: 12, marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  gap: { marginTop: 12 },
  note: { marginTop: 10, marginHorizontal: 20, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
