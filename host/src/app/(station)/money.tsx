// Money, for Admins (Station take 3, approved 22 Nov 2026: https://claude.ai/artifact/Me5XbAzWHUYi6muYwwSZrP, Take 3),
// fed by GET /hosts/:id/money (X4). From the Money doc (the buyer fee and the commission, the seven numbers, payouts,
// the bank account) and Play:
// - What can be asked for comes first: slot money 3 or more days past its end, less paid out and asked for, what's
//   still in its 3 days and when it opens, then Request ₹X (one ask a week per venue), to a verified account only.
// - Orbit says the venue's fee plan: the buyer fee (3% or 5%), who bears it, and the commission (2% or none).
// - The seven numbers in the doc's order, all time. Cash walk-ins stay off.
// - Payouts (Asked, Paid with its UTR, Cancelled with why) and the bank account, added or replaced in a sheet.
// Shown since X10 turned ONE_0 off. Desk never comes here: Station's tab bar sends it to Today.
// ponytail: take 3's period chips and By day wait for per-day money from the API; this shows the totals.
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space, stoneAt } from '@orbit/mobile/theme';
import { type Href, router } from 'expo-router';
import { useRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHostMoney } from '../../hostMoney';
import { dayLabel, timeLabel } from '../../station/day';
import { PLANS, percent, type Plan, rupees } from '../../money';
import { useStation } from '../../station/state';
import { Head, Pill, Section } from '../../station/ui';

/** What Orbit says about the venue's fee plan, in one sentence: the buyer fee and who bears it, and the commission. */
function commissionLine(plan: Plan, feeIncluded: boolean) {
  const { buyer, host } = PLANS[plan];
  const fee = feeIncluded ? `The ${percent(buyer)} buyer fee comes out of your prices` : `Buyers pay a ${percent(buyer)} fee on top of your prices`;
  return host ? `${fee} and Orbit’s commission is ${percent(host)}.` : `${fee}; Orbit takes no commission from you.`;
}

const at = (iso: string) => Date.parse(iso);

export default function Money() {
  const { venue: v, seat, role } = useStation();
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const hostId = role === 'admin' ? seat?.hostId : null;
  const money = useHostMoney(hostId);
  // One sheet per tap: a quick second tap doesn't push another.
  const last = useRef(0);
  const open = (href: Href) => {
    if (Date.now() - last.current < 800) return;
    last.current = Date.now();
    router.push(href);
  };
  if (role !== 'admin' || !hostId) return null; // Money is an Admin's
  const m = money.data;
  const b = m?.venue;
  const account = m?.account;
  const minus = (p: number) => (p ? `−${rupees(p)}` : rupees(0));
  const bankSheet = (replace: boolean): Href => ({ pathname: '/bank', params: { hostId, name: v.name, ...(replace && { replace: '1' }) } });

  // Once a week per venue, to a verified account.
  let ask;
  if (!b || !account) ask = null;
  else if (account.state !== 'verified') ask = <Pill wide disabled label="Ask once your account is verified" />;
  else if (b.nextAskAt) ask = <Pill wide disabled label={`Next ask from ${dayLabel(at(b.nextAskAt))}`} />;
  else if (b.availablePaise > 0) ask = <Pill wide label={`Request ${rupees(b.availablePaise)}`} onPress={() => open({ pathname: '/payout', params: { hostId, name: v.name } })} />;
  else ask = <Pill wide disabled label="Nothing to ask for yet" />;

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.big }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={money.loading && !!m} onRefresh={money.reload} tintColor={color.secondary} />}
    >
      <Head venue={v} title="Money" line="Paid to your bank, at most once a week" />
      {money.error && <OrbitSays text={money.error.message} />}
      {m && (
        <>
          <View style={styles.bal}>
            <Text style={styles.kick}>Ready to ask</Text>
            <Text style={styles.big} accessibilityLabel={`Ready to ask: ${rupees(b?.availablePaise ?? 0)}`}>
              {rupees(b?.availablePaise ?? 0)}
            </Text>
            {!!b?.waitingPaise && b.opensAt && (
              <Text style={styles.kick}>
                {rupees(b.waitingPaise)} more opens by {dayLabel(at(b.opensAt))}
              </Text>
            )}
            {!!b?.requestedPaise && <Text style={styles.kick}>Asked for {rupees(b.requestedPaise)}, waiting to be paid by bank transfer</Text>}
            {ask && <View style={styles.askAt}>{ask}</View>}
          </View>
          {!account ? (
            <OrbitSays
              title="Add where you get paid"
              text="Orbit pays you by bank transfer. Add your account first; you can ask once Orbit has checked it."
              answers={[{ label: 'Add bank account', onPress: () => open(bankSheet(false)) }]}
            />
          ) : account.state === 'rejected' ? (
            <OrbitSays
              text={`Orbit couldn’t verify your bank account${account.reason ? `: ${account.reason}` : ''}. Replace it to be paid.`}
              answers={[{ label: 'Replace it', onPress: () => open(bankSheet(true)) }]}
            />
          ) : (
            account.state === 'checking' && (
              <OrbitSays text={`Your account is being checked${account.until ? ` till ${dayLabel(at(account.until))}, ${timeLabel(at(account.until))}` : ''}. You can ask once it’s verified.`} />
            )
          )}
          <OrbitSays text={commissionLine(m.plan, m.feeIncluded)} />

          <Section title="The numbers" aside="All time" />
          <View style={styles.card}>
            <Row label="Ticket sales" value={rupees(b?.salesPaise ?? 0)} note={`${b?.bookings ?? 0} booking${b?.bookings === 1 ? '' : 's'}`} first />
            <Row label="Commission" value={minus(b?.commissionPaise ?? 0)} />
            <Row label="Buyer fee you included" value={minus(b?.includedPaise ?? 0)} note={m.feeIncluded ? undefined : 'Buyers pay it on top'} />
            <Row label="Refunded" value={minus(b?.refundedPaise ?? 0)} />
            <Row label="Your earnings" value={rupees(b?.earningsPaise ?? 0)} total />
            <Text style={styles.split}>SO FAR</Text>
            <Row label="Paid out" value={rupees(b?.paidOutPaise ?? 0)} first />
            <Row label="Available" value={rupees(b?.availablePaise ?? 0)} note={b?.requestedPaise ? `Less ${rupees(b.requestedPaise)} asked for` : undefined} />
          </View>

          <Section title="Payouts" />
          {m.payouts.length === 0 ? (
            <OrbitSays top={0} text="No payouts yet." />
          ) : (
            <View style={styles.rows}>
              {m.payouts.map((p, i) => (
                <View key={p.id} style={[styles.row, i > 0 && styles.rule]}>
                  <View style={styles.grow}>
                    <Text style={styles.name}>{p.status === 'paid' ? 'Paid' : p.status === 'requested' ? 'Asked' : 'Cancelled'}</Text>
                    <View style={styles.sline}>
                      <View style={p.status === 'paid' ? styles.dot : p.status === 'requested' ? styles.dotSoon : styles.dotOff} />
                      <Text style={[styles.meta, styles.grow]}>
                        {p.status === 'paid'
                          ? `Asked ${dayLabel(at(p.askedAt))} · paid ${dayLabel(at(p.at))} · UTR ${p.utr}`
                          : p.status === 'requested'
                            ? `${dayLabel(at(p.askedAt))} · Orbit pays it by bank transfer`
                            : (p.reason ?? '')}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.amount}>{rupees(p.amountPaise)}</Text>
                </View>
              ))}
            </View>
          )}

          <Section title="Bank account" />
          <View style={styles.bank}>
            {account ? (
              <>
                <Text style={styles.bankName}>
                  {account.bankName} ••{account.last4}
                </Text>
                <Text style={styles.meta}>{account.holder}</Text>
                <Text style={styles.tag}>
                  {account.state === 'verified' ? 'Verified' : account.state === 'rejected' ? 'Not verified' : account.until ? `Checking till ${dayLabel(at(account.until))}` : 'Checking'}
                </Text>
                <View style={styles.bankAct}>
                  <Pill label="Replace" onPress={() => open(bankSheet(true))} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.bankName}>No bank account yet</Text>
                <Text style={styles.meta}>Add one to be paid.</Text>
                <View style={styles.bankAct}>
                  <Pill label="Add bank account" onPress={() => open(bankSheet(false))} />
                </View>
              </>
            )}
          </View>
        </>
      )}
    </ScrollView>
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
  bal: { marginTop: space.big, marginHorizontal: 20, gap: 4 },
  kick: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: color.secondary },
  big: { fontFamily: font.headline, fontSize: 40, lineHeight: 46, letterSpacing: -0.8, color: color.text, fontVariant: ['tabular-nums'] },
  askAt: { marginTop: 12 },
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
