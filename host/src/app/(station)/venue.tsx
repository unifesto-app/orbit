// Venue, for Admins (Station take 4, approved 22 Nov 2026: https://claude.ai/artifact/Me5XbAzWHUYi6muYwwSZrP, Take 4),
// laid out as Launch's Host tab with the Orbit app's Account-style cards. From the Play and Hosts flow docs:
// - the venue as people see it: logo, name with the tick, kind, area and followers; Share page and View;
// - What you rent out: a row per kind (how many, the price an hour, off-peak, co-op, games), each edited in a sheet;
//   Orbit sets how bookings start and whether it's booked whole; Add a kind;
// - Hours: each day of the week, open or closed; how long before the start players can cancel; We log walk-ins;
// - At your venue: events asking to be at the venue (Accept or Decline) and Hosted here;
// - Team: Admins (the owner marked) and Desk, invites waiting with their days left, Add Desk or an Admin;
// - Venue page (place, desk phone; name, logo and banner on the web Console) and You.
// Changes that would strand a booking are refused in the sheet, naming the bookings (Play). Desk never comes here.
// Signed in (S5) it's the API's venue and team (state.tsx useLiveVenue); a venue not set up yet shows only how to start.
// ponytail: Share page, View, Account, Help and Sign out open nothing yet, as on Launch's Host tab; they wait for
// sign-in and the web host pages. Launch's Card and Row until a shared host kit holds them.
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space } from '@orbit/mobile/theme';
import { type Href, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Row } from '../../launch/ui';
import { signOut } from '../../session';
import { useVenue } from '../../station/state';
import { Pill, Section } from '../../station/ui';
import { daysLeft, priceLine, span } from '../../station/venue';
import { units } from '../../station/words';

const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CONSOLE = 'https://console.heyorbit.in';

export default function VenueTab() {
  const { venue: v, setup: s, load, role, now, hours, changeSetup } = useVenue();
  const [said, setSaid] = useState<string | null>(null); // the walk-ins switch's refusal
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  // One sheet per tap: a quick second tap doesn't push another.
  const last = useRef(0);
  const open = (href: Href) => {
    if (Date.now() - last.current < 800) return;
    last.current = Date.now();
    router.push(href);
  };
  if (role !== 'admin') return null; // settings are an Admin's
  const today = new Date(hours.day + 330 * 60_000).getUTCDay();
  const toConsole = () => Linking.openURL(CONSOLE).catch(() => {});
  const refresh = load && <RefreshControl refreshing={false} onRefresh={load.reload} tintColor={color.secondary} />;
  const trouble = !load?.error ? null : load.status === 0 ? 'Can’t reach Orbit. Pull to try again.' : load.error.message;
  // Signed in, before the venue lands, or a venue not set up yet: the name and what to do.
  if (!s)
    return (
      <ScrollView style={styles.page} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }} refreshControl={refresh || undefined}>
        <View style={styles.head}>
          <Text style={styles.name} accessibilityRole="header">
            {v.name}
          </Text>
        </View>
        {load?.notSetUp ? (
          <>
            <OrbitSays text="Set up your venue: where it is, the desk phone and your hours. Then add what you rent out. Nobody can book till then." />
            <View style={styles.after}>
              <Pill label="Set up the venue" onPress={() => open({ pathname: '/setup', params: { what: 'first' } })} />
            </View>
          </>
        ) : (
          <OrbitSays text={trouble ?? 'Getting your venue…'} />
        )}
        <Section title="You" />
        <Card>
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
      refreshControl={refresh || undefined}
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
              {s.followers !== undefined && ` · ${s.followers.toLocaleString('en-IN')} followers`}
            </Text>
          </View>
        </View>
        <View style={styles.pills}>
          <Pill label="Share page" onPress={() => {}} />
          <Pill label="View ↗" spoken="View the venue page" onPress={() => {}} />
        </View>
      </View>
      {trouble && <OrbitSays text={trouble} />}

      <Section title="What you rent out" aside="New prices, new bookings" />
      <Card>
        {v.types.map((t) => (
          <Row key={t.id} label={t.name} note={priceLine(t)} value={units(t, t.count)} onPress={() => open({ pathname: '/setup', params: { what: 'kind', type: t.id } })} />
        ))}
      </Card>
      <View style={styles.after}>
        <Pill label="Add a kind" onPress={() => open({ pathname: '/setup', params: { what: 'kind' } })} />
      </View>

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
              value={s.logWalkIns}
              disabled={busy}
              onValueChange={(on) => {
                setBusy(true);
                setSaid(null);
                void changeSetup((x) => ({ ...x, logWalkIns: on })).then((line) => (setBusy(false), setSaid(line)));
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

      <Section title="At your venue" />
      {s.asks.length > 0 ? (
        <>
          <Card>
            {s.asks.map((a) => (
              <View key={a.id} style={styles.ask}>
                <Row label={a.title} note={`By ${a.by} · ${a.when}${a.series ? ' · one yes covers the series' : ''}`} />
                <View style={styles.pills}>
                  <Pill
                    label="Accept"
                    spoken={`Accept ${a.title}`}
                    onPress={() => changeSetup((x) => ({ ...x, asks: x.asks.filter((y) => y.id !== a.id), hosted: x.hosted.some((y) => y.id === a.id) ? x.hosted : [...x.hosted, a] }))}
                  />
                  <Pill label="Decline" spoken={`Decline ${a.title}`} onPress={() => changeSetup((x) => ({ ...x, asks: x.asks.filter((y) => y.id !== a.id) }))} />
                </View>
              </View>
            ))}
          </Card>
          <Text style={styles.note}>Nothing shows till you accept. A link gives no role or money; either side can end it, and after a sale its ticket holders hear.</Text>
        </>
      ) : (
        <Text style={styles.note}>When an event at your place asks to be at your venue, it shows here for you to accept.</Text>
      )}
      {s.hosted.length > 0 && (
        <>
          <Section title="Hosted here" />
          <Card>
            {s.hosted.map((a) => (
              <Row key={a.id} label={a.title} note={`By ${a.by} · ${a.when}`} />
            ))}
          </Card>
        </>
      )}

      <Section title="Team" />
      <Card>
        {s.team.map((m, i) => (
          <Row
            key={m.id ?? `${m.name}${i}`}
            label={m.you ? 'You' : m.name}
            note={m.role === 'Desk' ? 'The counter: scan, walk-ins, blocks, no-shows' : undefined}
            value={m.owner ? 'Owner' : m.role}
            onPress={m.you || m.owner ? undefined : () => open({ pathname: '/setup', params: { what: 'member', name: m.id ?? m.name } })}
          />
        ))}
        {s.invites
          .filter((x) => x.sent === undefined || daysLeft(x.sent, now) > 0) // an invite ends by itself after 14 days (the API leaves lapsed ones out)
          .map((x) => {
            const left = x.sent === undefined ? 0 : daysLeft(x.sent, now);
            return (
              <Row
                key={x.id ?? x.contact}
                label={x.contact}
                note={x.accepted ? `Accepted by ${x.acceptedBy ?? 'them'} · confirm it’s them` : x.sent === undefined ? 'Waiting' : `Waiting · ${left} day${left === 1 ? '' : 's'} left`}
                value={x.role}
                onPress={() => open({ pathname: '/setup', params: { what: 'invite', contact: x.id ?? x.contact } })}
              />
            );
          })}
      </Card>
      <View style={styles.after}>
        <Pill label="Add Desk" onPress={() => open({ pathname: '/setup', params: { what: 'add', role: 'Desk' } })} />
        <Pill label="Add an Admin" onPress={() => open({ pathname: '/setup', params: { what: 'add', role: 'Admin' } })} />
      </View>
      <Text style={styles.note}>Desk works the counter and never sees money, prices or settings. Admins run everything here, the bank account too.</Text>

      <Section title="Venue page" />
      <Card>
        <Row label="Place" value={s.address} onPress={() => open({ pathname: '/setup', params: { what: 'field', key: 'address' } })} />
        <Row label="Desk phone" value={s.deskPhone} onPress={() => open({ pathname: '/setup', params: { what: 'field', key: 'deskPhone' } })} />
        <Row label="Name, logo and banner" value="Web Console" external onPress={toConsole} />
      </Card>

      <Section title="You" />
      <Card>
        <Row label="Account" value="Sign-in, security, delete" />
        <Row label="Help and support" />
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
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  after: { marginTop: 12, marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  gap: { marginTop: 12 },
  note: { marginTop: 10, marginHorizontal: 20, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  ask: { gap: space.small },
});
