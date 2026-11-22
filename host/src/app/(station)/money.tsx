// Money, for Admins (Station take 3, approved 22 Nov 2026: https://claude.ai/artifact/Me5XbAzWHUYi6muYwwSZrP, Take 3).
// From the Money doc (the buyer fee and the commission, the seven numbers, payouts, the bank account) and Play:
// - What can be asked for comes first: earnings from bookings 3 or more days past their end, less paid out and asked
//   for, what's still in its 3 days and when it opens, then Request ₹X (one ask a week per venue).
// - Orbit says the commission: the rate now, the free or half months left, when it changes, who pays the 4% fee.
// - The seven numbers in the doc's order: the first five for the period picked (Today, 7 days, 30 days, or one day
//   from By day), then Paid out and Available so far. Cash walk-ins stay off; a released no-show keeps its money.
// - By day, Payouts (Asked, Paid with its UTR, Cancelled with why) and the bank account, added or replaced in a sheet.
// Desk never comes here: Station's tab bar sends it to Today.
import { DARK_TINT as DARK, Glass } from '@orbit/mobile/glass';
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space, stoneAt } from '@orbit/mobile/theme';
import { type Href, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dayLabel, timeLabel } from '../../station/day';
import { balance, monthOf, nextStep, numbers, percent, rateAt, rupees, type Terms } from '../../station/money';
import { useStation } from '../../station/state';
import { Head, Pill, Section } from '../../station/ui';

const PERIODS = [
  [1, 'Today'],
  [7, '7 days'],
  [30, '30 days'],
] as const;

/** What Orbit says about the commission: the rate now, what's left of the intro and when it changes, and the fee. */
function commissionLine(t: Terms, now: number) {
  const month = monthOf(t.onboarded, now);
  const next = nextStep(t, now);
  const fee = t.feeIncluded ? ' The 4% buyer fee comes out of your prices.' : ' Buyers pay the 4% buyer fee on top of your prices.';
  if (month <= 3 && next)
    return `No commission for your first 3 months. From ${dayLabel(next.at)} it’s ${percent(next.rate)} for 3 months, then ${percent(t.rate)}; you’ll hear 7 days before each change.${fee}`;
  if (month <= 6 && next) return `Half commission for now, ${percent(rateAt(t, now))}. From ${dayLabel(next.at)} it’s ${percent(t.rate)}; you’ll hear 7 days before.${fee}`;
  return `Your commission is ${percent(t.rate)} of ticket sales.${fee}`;
}

// Keyed by venue and opening, so a picked day never carries over to another venue's money.
export default function Money() {
  const { venue, hours } = useStation();
  return <Body key={`${venue.id}:${hours.day}`} />;
}

function Body() {
  const { venue: v, money: m, now, role } = useStation();
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const [period, setPeriod] = useState(7);
  const [pick, setPick] = useState<number>();
  const b = balance(
    m.days.flatMap((d) => d.sold),
    m.terms,
    m.payouts,
    now,
  );
  const shown = pick !== undefined ? m.days.filter((d) => d.day === pick) : m.days.slice(0, period);
  const n = numbers(
    shown.flatMap((d) => d.sold),
    m.terms,
  );
  const free = monthOf(m.terms.onboarded, now) <= 3;
  const minus = (p: number) => (p ? `−${rupees(p)}` : rupees(0));
  // One sheet per tap: a quick second tap doesn't push another.
  const last = useRef(0);
  const open = (href: Href) => {
    if (Date.now() - last.current < 800) return;
    last.current = Date.now();
    router.push(href);
  };
  // Money is an Admin's: a role changed under a sheet (You) shows nothing here.
  if (role !== 'admin') return null;

  // Once a week per venue: an ask still waiting to be paid blocks nothing more.
  let ask;
  if (now < b.nextAsk) ask = <Pill wide disabled label={`Next ask from ${dayLabel(b.nextAsk)}`} onPress={() => {}} />;
  else if (b.available > 0) ask = <Pill wide label={`Request ${rupees(b.available)}`} onPress={() => open('/payout')} />;
  else ask = <Pill wide disabled label="Nothing to ask for yet" onPress={() => {}} />;

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: insets.bottom + space.big }} onScroll={onScroll} scrollEventThrottle={16}>
      <Head venue={v} title="Money" line="Paid to your bank, at most once a week" />
      <View style={styles.bal}>
        <Text style={styles.kick}>Ready to ask</Text>
        <Text style={styles.big} accessibilityLabel={`Ready to ask: ${rupees(b.available)}`}>
          {rupees(b.available)}
        </Text>
        {b.waiting > 0 && (
          <Text style={styles.kick}>
            {rupees(b.waiting)} more opens by {dayLabel(b.opensBy)}
          </Text>
        )}
        {b.asked > 0 && <Text style={styles.kick}>Asked for {rupees(b.asked)}, waiting to be paid by bank transfer</Text>}
        {m.bank && <View style={styles.askAt}>{ask}</View>}
      </View>
      {!m.bank ? (
        <OrbitSays
          title="Add where you get paid"
          text="Orbit pays you by bank transfer. Add your account first; asks are paid once Orbit has checked it."
          answers={[{ label: 'Add bank account', onPress: () => open('/bank') }]}
        />
      ) : m.bank.state === 'rejected' ? (
        <OrbitSays
          text="Orbit couldn’t verify your bank account. Replace it to be paid; asks wait till then."
          answers={[{ label: 'Replace it', onPress: () => open({ pathname: '/bank', params: { replace: '1' } }) }]}
        />
      ) : (
        m.bank.state === 'checking' && (
          <OrbitSays
            text={`Your account is being checked${m.bank.until ? ` till ${dayLabel(m.bank.until)}, ${timeLabel(m.bank.until)}` : ''}. Ask anyway: nothing is paid till it’s verified.`}
          />
        )
      )}
      <OrbitSays text={commissionLine(m.terms, now)} />

      <Section title="The numbers" aside={pick !== undefined ? dayLabel(pick) : period === 1 ? 'Today' : `Last ${period} days`} />
      <Glass tint={DARK} style={styles.period}>
        {PERIODS.map(([k, label]) => (
          <Chip key={k} label={label} on={pick === undefined && period === k} onPress={() => (setPeriod(k), setPick(undefined))} />
        ))}
        {pick !== undefined && <Chip label={`${dayLabel(pick)} ×`} on onPress={() => setPick(undefined)} />}
      </Glass>
      <View style={styles.card}>
        <Row label="Ticket sales" value={rupees(n.sales)} note={`${n.bookings} booking${n.bookings === 1 ? '' : 's'}`} />
        <Row label="Commission" value={minus(n.commission)} note={free ? 'Your first 3 months are free' : undefined} />
        <Row label="Buyer fee you included" value={minus(n.included)} note={m.terms.feeIncluded ? undefined : 'Buyers pay it on top'} />
        <Row label="Refunded" value={minus(n.refunded)} />
        <Row label="Your earnings" value={rupees(n.earnings)} total />
        <Text style={styles.split}>SO FAR</Text>
        <Row label="Paid out" value={rupees(b.paidOut)} first />
        <Row label="Available" value={rupees(b.available)} note={b.asked ? `Less ${rupees(b.asked)} asked for` : undefined} />
      </View>

      <Section title="By day" aside="Earnings" />
      <View style={styles.rows}>
        {m.days.slice(0, period).map((d, i) => {
          const x = numbers(d.sold, m.terms);
          return (
            <Pressable
              key={d.day}
              onPress={() => setPick(pick === d.day ? undefined : d.day)}
              accessibilityRole="button"
              accessibilityState={{ selected: pick === d.day }}
              style={({ pressed }) => [styles.row, i > 0 && styles.rule, pressed && styles.pressed]}
            >
              <View style={styles.grow}>
                <Text style={styles.name}>{i === 0 ? 'Today' : dayLabel(d.day)}</Text>
                <Text style={styles.meta}>
                  {x.bookings} booking{x.bookings === 1 ? '' : 's'} · {rupees(x.sales)} sales{x.refunded ? ` · ${rupees(x.refunded)} refunded` : ''}
                </Text>
              </View>
              <Text style={styles.amount}>{rupees(x.earnings)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Section title="Payouts" />
      {m.payouts.length === 0 ? (
        <OrbitSays top={0} text="No payouts yet." />
      ) : (
        <View style={styles.rows}>
          {[...m.payouts]
            .sort((x, y) => y.asked - x.asked)
            .map((p, i) => (
              <View key={p.id} style={[styles.row, i > 0 && styles.rule]}>
                <View style={styles.grow}>
                  <Text style={styles.name}>{p.status === 'paid' ? 'Paid' : p.status === 'requested' ? 'Asked' : 'Cancelled'}</Text>
                  <View style={styles.sline}>
                    <View style={p.status === 'paid' ? styles.dot : p.status === 'requested' ? styles.dotSoon : styles.dotOff} />
                    <Text style={[styles.meta, styles.grow]}>
                      {p.status === 'paid'
                        ? `Asked ${dayLabel(p.asked)} · paid ${dayLabel(p.paid ?? p.asked)} · UTR ${p.utr}`
                        : p.status === 'requested'
                          ? `${dayLabel(p.asked)} · Orbit pays it by bank transfer`
                          : (p.why ?? '')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.amount}>{rupees(p.paise)}</Text>
              </View>
            ))}
        </View>
      )}

      <Section title="Bank account" />
      <View style={styles.bank}>
        {m.bank ? (
          <>
            <Text style={styles.bankName}>
              {m.bank.bank} ••{m.bank.last4}
            </Text>
            <Text style={styles.meta}>{m.bank.holder}</Text>
            <Text style={styles.tag}>
              {m.bank.state === 'verified' ? 'Verified' : m.bank.state === 'rejected' ? 'Not verified' : m.bank.until ? `Checking till ${dayLabel(m.bank.until)}` : 'Checking'}
            </Text>
            <View style={styles.bankAct}>
              <Pill label="Replace" onPress={() => open({ pathname: '/bank', params: { replace: '1' } })} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.bankName}>No bank account yet</Text>
            <Text style={styles.meta}>Add one to be paid.</Text>
            <View style={styles.bankAct}>
              <Pill label="Add bank account" onPress={() => open('/bank')} />
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} hitSlop={4} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, value, note, total, first }: { label: string; value: string; note?: string; total?: boolean; first?: boolean }) {
  return (
    <View style={[styles.nrow, !first && styles.rule]}>
      <View style={styles.grow}>
        <Text style={total ? styles.totalLabel : styles.nlabel}>{label}</Text>
        {note && <Text style={styles.note}>{note}</Text>}
      </View>
      <Text style={total ? styles.totalValue : styles.amount}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  bal: { marginTop: space.big, marginHorizontal: 20, gap: 4 },
  kick: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: color.secondary },
  big: { fontFamily: font.headline, fontSize: 40, lineHeight: 46, letterSpacing: -0.8, color: color.text, fontVariant: ['tabular-nums'] },
  askAt: { marginTop: 12 },
  period: { marginHorizontal: 20, marginBottom: 14, alignSelf: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 22, overflow: 'hidden' },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  chipOn: { backgroundColor: stoneAt(0.14), borderColor: stoneAt(0.24) },
  chipText: { fontFamily: font.price, fontSize: 13, color: color.secondary },
  chipTextOn: { color: color.text },
  card: { marginHorizontal: 20, borderRadius: 22, borderWidth: 1, borderColor: color.border, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 },
  nrow: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 10 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: stoneAt(0.12) },
  nlabel: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: color.text },
  note: { fontFamily: font.text, fontSize: 12, lineHeight: 16, color: color.secondary },
  totalLabel: { fontFamily: font.headline, fontSize: 16, lineHeight: 22, color: color.text },
  totalValue: { fontFamily: font.headline, fontSize: 16, lineHeight: 22, color: color.text, fontVariant: ['tabular-nums'] },
  amount: { fontFamily: font.price, fontSize: 15, lineHeight: 20, color: color.text, fontVariant: ['tabular-nums'] },
  split: { paddingTop: 12, paddingBottom: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: stoneAt(0.12), fontFamily: font.price, fontSize: 11, letterSpacing: 0.66, color: color.secondary },
  rows: { marginHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  name: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  sline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  dotSoon: { width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: color.accent },
  dotOff: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.text },
  bank: { marginHorizontal: 20, borderRadius: 22, borderWidth: 1, borderColor: color.border, padding: 16, gap: 6 },
  bankName: { fontFamily: font.title, fontSize: 16, lineHeight: 22, color: color.text },
  tag: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', backgroundColor: stoneAt(0.12), fontFamily: font.medium, fontSize: 12, color: color.text },
  bankAct: { marginTop: 8, alignSelf: 'flex-start' },
});
