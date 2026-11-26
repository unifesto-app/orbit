// Today, the venue's day at the counter (Today take 1, approved 22 Nov 2026: https://claude.ai/artifact/Me5XbAzWHUYi6muYwwSZrP).
// From the Play doc's At the desk and the host apps plan:
// - Orbit speaks up 15 minutes after a booking starts with nobody checked in: Release it (the booker is told, no
//   refund) or Wait. Release is a tap, never automatic.
// - Next up: bookings starting in the next two hours, soonest first, each with where it stands, and Check in by hand.
// - One card per kind of station: the day as a bar a step (half hour for gaming, hour for pitches and courts), filled
//   from the bottom with booked, walk-ins, blocked and free; the line is now; tap a bar to read that time. Walk-ins
//   (+ and −) and Block on each card.
// The words name the things (PCs, pitches, courts), never "stations": Station is the app's name.
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space, stoneAt } from '@orbit/mobile/theme';
import { router, useFocusEffect } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { AppState, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Claim, type Door, type StationType, type Venue, MIN, atDoor, dayLabel, door, hourWord, steps, taken, timeLabel } from '../../station/day';
import { PushAsk } from '../../push';
import { blank } from '../../station/live';
import { useStation, useToday } from '../../station/state';
import { LOST_SEAT, notSetUp } from '../../station/venue';
import { Head, Pill, Round, Section } from '../../station/ui';
import { first, range, units, what } from '../../station/words';

const HATCH = require('../../../assets/tabs/hatch.png');
const SOON = 2 * 60 * MIN; // Next up looks this far ahead

// The day is the API's: fetched again every 30 seconds while Today is open, when the app comes back to the front, and on
// a pull.
// ponytail: the loading, empty and can't-reach states are placeholders until the owner's design take.
export default function Today() {
  const { today, load, seat } = useStation();
  const { reload } = load;
  useFocusEffect(
    useCallback(() => {
      reload(); // back on Today: fresh at once (useLoad drops an answer still on its way)
      const tick = setInterval(reload, 30_000);
      const front = AppState.addEventListener('change', (s) => s === 'active' && reload());
      return () => {
        clearInterval(tick);
        front.remove();
      };
    }, [reload]),
  );
  // The pull's spinner stays until the fetch settles: each answer is a new day or a new error (not the clock's tick).
  const [pulling, setPulling] = useState(false);
  useEffect(() => setPulling(false), [load.data, load.error]);
  const refresh = <RefreshControl refreshing={pulling} onRefresh={() => (setPulling(true), reload())} tintColor={color.secondary} />;
  const trouble = !load.error
    ? null
    : load.status === 0
      ? 'Can’t reach Orbit. Pull to try again.'
      : notSetUp(load)
        ? 'This venue isn’t set up yet. Its Admin sets it up in Venue.'
        : load.status === 404
          ? LOST_SEAT
          : load.error.message;
  if (!today) return <Waiting venue={blank(seat!)} line={trouble ?? 'Getting today’s day…'} refresh={refresh} />;
  // Keyed by venue and opening, so a Wait, a row kept after Check in or a picked bar never carries over to another day.
  return <Day key={`${today.venue.id}:${today.hours.day}`} trouble={trouble} refresh={refresh} />;
}

// Before the first day lands: the head and one line.
function Waiting({ venue, line, refresh }: { venue: Venue; line: string; refresh?: ReactElement }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: insets.bottom + space.big }} refreshControl={refresh}>
      <Head venue={venue} title="Today" line="" />
      <OrbitSays text={line} />
    </ScrollView>
  );
}

function Day({ trouble, refresh }: { trouble: string | null; refresh?: ReactElement }) {
  const { venue: v, claims, now, hours: h, release, closed, said } = useToday();
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const [waited, setWaited] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set()); // checked in or released here: their rows stay to say so
  const touch = (id: string) => setTouched((s) => new Set(s).add(id));
  const late = h.state === 'open' ? claims.find((c) => atDoor(c) && door(c, now) === 'noShow' && !waited.has(c.id) && v.types.some((t) => t.id === c.type)) : undefined;
  const when = closed ? 'closed today' : h.state === 'before' ? `opens at ${hourWord(v.open[0])}` : h.state === 'open' ? `open till ${hourWord(v.open[1])}` : `closed at ${hourWord(v.open[1])}`;
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: insets.bottom + space.big }} onScroll={onScroll} scrollEventThrottle={16} refreshControl={refresh}>
      <Head venue={v} title="Today" line={`${dayLabel(h.day)} · ${when}`} />
      <PushAsk />
      {/* The last good day stays on screen under what went wrong. */}
      {trouble && <OrbitSays text={trouble} />}
      {/* Signed in, why the API refused the last tap here (a 409's line), until the next one. */}
      {said && <OrbitSays text={said} />}
      {closed ? <OrbitSays text="Closed today. Nothing to run at the counter." /> : v.types.length === 0 && <OrbitSays text="No stations set up yet. An Admin adds them in Venue." />}
      {late && <NoShow venue={v} claim={late} now={now} onWait={() => setWaited((s) => new Set(s).add(late.id))} onRelease={() => {
            release(late.id);
            touch(late.id);
          }} />}
      {!closed && v.types.length > 0 && (
        <>
          <NextUp touched={touched} onTouch={touch} />
          <Section title="The day" />
          <View style={styles.legend}>
            {(['booking', 'walkin', 'block', 'free'] as const).map((k) => (
              <View key={k} style={styles.key}>
                <Cell kind={k} style={styles.swatch} />
                <Text style={styles.keyText}>{{ booking: 'Booked', walkin: 'Walk-in', block: 'Blocked', free: 'Free' }[k]}</Text>
              </View>
            ))}
          </View>
          <View style={styles.cards}>
            {v.types.map((t) => (
              <TypeCard key={`${v.id}:${t.id}`} t={t} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function NoShow({ venue: v, claim: c, now, onWait, onRelease }: { venue: Venue; claim: Claim; now: number; onWait: () => void; onRelease: () => void }) {
  const t = v.types.find((x) => x.id === c.type);
  if (!t) return null;
  const mins = Math.round((now - c.start) / MIN);
  const it = c.count > 1 ? `the ${units(t, c.count)} are` : `the ${t.unit[0]} is`;
  return (
    <OrbitSays
      title={`${first(c.who)} hasn’t come`}
      text={`${c.who} booked ${what(v, c)} from ${timeLabel(c.start)}, ${mins} minutes ago. Release it and ${it} free again; ${first(c.who)} is told, with no refund.`}
      // A second Release while the first is on its way is dropped by the state's send.
      answers={[
        { label: 'Wait', onPress: onWait },
        { label: 'Release', onPress: onRelease },
      ]}
    />
  );
}

function NextUp({ touched, onTouch }: { touched: ReadonlySet<string>; onTouch: (id: string) => void }) {
  const { venue: v, claims, now, hours: h, checkIn, busy } = useToday();
  const from = Math.max(now, h.opens);
  const rows = claims.filter(
    (c) =>
      atDoor(c) &&
      (touched.has(c.id) ||
        (['soon', 'open', 'late', 'noShow'].includes(door(c, now)) && c.start <= from + SOON) ||
        (door(c, now) === 'here' && (c.in ?? 0) < c.count)), // part of a group in: the rest are still due
  );
  return (
    <>
      <Section title="Next up" aside="Next two hours" />
      {rows.length === 0 ? (
        <OrbitSays top={0} text={h.state === 'after' ? 'That’s the day done.' : 'Nobody’s due in the next two hours.'} />
      ) : (
        <View style={styles.rows}>
          {rows.map((c, i) => {
            const d = door(c, now);
            const mins = Math.round((now - c.start) / MIN);
            const lines: Record<Door, [object, string]> = {
              soon: [styles.dotSoon, `Check-in opens at ${timeLabel(c.start - 15 * MIN)}`],
              open: [styles.dot, 'Check-in open'],
              late: [styles.dotLate, `${mins} min late`],
              noShow: [styles.dotLate, `${mins} min late · can be released`],
              here: [styles.dot, (c.in ?? 0) < c.count ? `${c.in ?? 0} of ${c.count} in · since ${timeLabel(c.checkedIn ?? now)}` : `Here · checked in ${timeLabel(c.checkedIn ?? now)}`],
              ended: [styles.dot, 'Played'],
              missed: [styles.dotLate, 'Never came'],
              released: [styles.dotLate, 'Released'],
            };
            const [dot, line] = lines[d];
            return (
              <View key={c.id} style={[styles.row, i > 0 && styles.rule]}>
                <View style={styles.grow}>
                  <Text style={styles.name}>{c.who}</Text>
                  <Text style={styles.meta}>
                    {what(v, c)} · {range(c.start, c.end)}
                  </Text>
                  <View style={styles.sline}>
                    <View style={dot} />
                    <Text style={styles.meta}>{line}</Text>
                  </View>
                </View>
                {['open', 'late', 'noShow'].includes(d) && <Pill label={busy.has(`claim:${c.id}`) ? 'Checking in…' : 'Check in'} disabled={busy.has(`claim:${c.id}`)} onPress={() => {
                      checkIn(c.id);
                      onTouch(c.id);
                    }} />}
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}

function Cell({ kind, style }: { kind: 'booking' | 'walkin' | 'block' | 'free'; style?: object }) {
  return <View style={[styles.cell, styles[kind], style]}>{kind === 'block' && <Image source={HATCH} resizeMode="repeat" style={StyleSheet.absoluteFill} />}</View>;
}

function TypeCard({ t }: { t: StationType }) {
  const { venue: v, claims, now, hours: h, freeOne, busy } = useToday();
  const [sel, setSel] = useState<number>();
  const [width, setWidth] = useState(0);
  const at = steps(v, t, h.day);
  const step = t.step * MIN;
  const span = at.length * step;
  const open = h.state === 'open';
  const here = taken(claims, t, now);
  const readAt = sel ?? (open ? now : at[0]);
  const r = taken(claims, t, readAt);
  const parts = [r.booking && `${r.booking} booked`, r.walkin && `${r.walkin} walk-in${r.walkin > 1 ? 's' : ''}`, r.block && `${r.block} blocked`, `${r.free} free`].filter(Boolean).join(' · ');
  const head = !open ? units(t, t.count) : t.count === 1 ? (here.free ? 'Free now' : here.block ? 'Blocked now' : 'In use now') : `${here.free} of ${units(t, t.count)} free now`;
  const ticks = [];
  for (let hr = v.open[0]; hr < v.open[1]; hr += 3) ticks.push(hr);
  return (
    <View style={styles.card}>
      <View style={styles.chead}>
        <Text style={styles.ctitle}>{t.name}</Text>
        <Text style={styles.cnow}>{head}</Text>
      </View>
      <View style={styles.strip} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {at.map((s) => {
          const n = taken(claims, t, s <= now && now < s + step ? now : s); // the step we're in reads as it is now
          // One cell a station while they fit the 64pt strip; more than 16, each kind as its share of the bar.
          const parts = (['booking', 'walkin', 'block', 'free'] as const).map((k) => [k, n[k]] as const).filter(([, c]) => c > 0);
          const cells = t.count > 16 ? parts : parts.flatMap(([k, c]) => Array.from({ length: c }, () => [k, 1] as const));
          return (
            <Pressable
              key={s}
              onPress={() => setSel(sel === s ? undefined : s)}
              accessibilityRole="button"
              accessibilityLabel={`${timeLabel(s)}: ${n.booking} booked, ${n.walkin} walk-in, ${n.block} blocked, ${n.free} free`}
              style={[styles.col, s + step <= now && styles.past, sel === s && styles.sel]}
            >
              {cells.map(([k, c], i) => (
                <Cell key={i} kind={k} style={{ flex: c }} />
              ))}
            </Pressable>
          );
        })}
        {open && width > 0 && <View pointerEvents="none" style={[styles.nowline, { left: (width * (now - at[0])) / span - 1 }]} />}
      </View>
      <View style={styles.axis}>
        {width > 0 &&
          ticks.map((hr, i) => (
            <Text key={hr} style={[styles.tick, i === 0 ? { left: 0, textAlign: 'left' } : { left: (width * (hr - v.open[0])) / (v.open[1] - v.open[0]) - 24 }]}>
              {timeLabel(h.day + hr * 60 * MIN).replace(':00', '')}
            </Text>
          ))}
      </View>
      <Text style={styles.read}>
        <Text style={styles.readAt}>{sel !== undefined ? `At ${timeLabel(sel)}` : open ? 'Now' : `At ${timeLabel(at[0])}`}</Text>: {parts}
      </Text>
      <View style={styles.cfoot}>
        <Text style={styles.kick}>Walk-ins now</Text>
        <View style={styles.stepper}>
          <Round glyph="−" label={`Free a ${t.unit[0]} early`} disabled={!here.walkin || busy.has(`free:${t.id}`)} onPress={() => freeOne(t.id)} />
          <Text style={styles.count}>{here.walkin}</Text>
          <Round glyph="+" label={`Add a walk-in on ${t.name}`} onPress={() => router.push({ pathname: '/walkin', params: { type: t.id } })} />
        </View>
        <Pill label="Block" onPress={() => router.push({ pathname: '/walkin', params: { type: t.id, mode: 'block' } })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  rows: { marginHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: stoneAt(0.12) },
  name: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  sline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  dotSoon: { width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: color.accent },
  dotLate: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.text },
  legend: { marginTop: -4, marginBottom: 14, marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { flex: 0, width: 10, height: 10, borderRadius: 2 },
  keyText: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  cards: { marginHorizontal: 20, gap: 16 },
  card: { borderRadius: 22, padding: 16, borderWidth: 1, borderColor: color.border, gap: 12 },
  chead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  ctitle: { flexShrink: 1, fontFamily: font.title, fontSize: 16, lineHeight: 22, color: color.text },
  cnow: { fontFamily: font.medium, fontSize: 13, color: color.secondary },
  strip: { height: 64, flexDirection: 'row', gap: 1.5 },
  col: { flex: 1, flexDirection: 'column-reverse', gap: 1.5, borderRadius: 3 },
  past: { opacity: 0.45 },
  sel: { outlineWidth: 1, outlineColor: color.text, outlineOffset: 2 },
  cell: { flex: 1, minHeight: 2, borderRadius: 1.5, overflow: 'hidden' },
  booking: { backgroundColor: color.accent },
  walkin: { backgroundColor: stoneAt(0.62) },
  block: { backgroundColor: stoneAt(0.08) },
  free: { backgroundColor: stoneAt(0.07), borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.12) },
  nowline: { position: 'absolute', top: -6, bottom: -6, width: 2, borderRadius: 1, backgroundColor: color.text },
  axis: { height: 14, marginTop: -4 },
  tick: { position: 'absolute', top: 0, width: 48, textAlign: 'center', fontFamily: font.medium, fontSize: 11, lineHeight: 14, color: color.secondary },
  read: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary, fontVariant: ['tabular-nums'] },
  readAt: { fontFamily: font.medium, color: color.text },
  cfoot: { flexDirection: 'row', alignItems: 'center', gap: space.small, paddingTop: 4 },
  kick: { flex: 1, fontFamily: font.medium, fontSize: 13, color: color.secondary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  count: { minWidth: 18, textAlign: 'center', fontFamily: font.title, fontSize: 15, color: color.text, fontVariant: ['tabular-nums'] },
});
