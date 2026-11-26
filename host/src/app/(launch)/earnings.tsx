// Money, Event Partner's second tab (route `earnings`: Station has `/money`). Money take 1 (approved 22 Nov 2026,
// https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg), fed by GET /hosts/:id/money (X4), for the host's Admins:
// - Ready to ask: each event's Available once its payout opens, 3 days after the event ends;
// - the fee plan, 3% + 2% or 5% + 0%, picked here (PATCH /hosts/:id feePlan; each sale keeps the plan it was made on);
// - the seven numbers across the host's events, in the Money doc's order;
// - each event's money with Ask (the payout sheet), the payouts, and the bank account (the bank sheet), paid to only
//   once Orbit has verified it.
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space } from '@orbit/mobile/theme';
import type { HostEventMoney } from '@orbit/contract';
import { type Href, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHostMoney } from '../../hostMoney';
import { type Host, useHost } from '../../launch/host';
import { dayLabel, istDate } from '../../launch/money';
import { type Plan, rupees } from '../../money';
import { api } from '../../session';
import { Card, Glow, HostHead, Note, Pill, Row, Section } from '../../launch/ui';

const PLAN_ROWS: { plan: Plan; label: string; note: string }[] = [
  { plan: '3+2', label: '3% from buyers, 2% from you', note: 'On ₹1,200: buyers pay ₹1,236, you keep ₹1,176' },
  { plan: '5+0', label: '5% from buyers, nothing from you', note: 'On ₹1,200: buyers pay ₹1,260, you keep ₹1,200' },
];
const day = (iso: string) => dayLabel(istDate(Date.parse(iso)));
const sum = (all: readonly HostEventMoney[], f: (e: HostEventMoney) => number) => all.reduce((n, e) => n + f(e), 0);

export default function Money() {
  const host = useHost();
  // Keyed by host: switching host starts the tab afresh.
  return host ? <MoneyTab key={host.id} host={host} /> : null;
}

function MoneyTab({ host }: { host: Host }) {
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const money = useHostMoney(host.id);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One sheet per tap: a quick second tap doesn't push another.
  const last = useRef(0);
  const open = (href: Href) => {
    if (Date.now() - last.current < 800) return;
    last.current = Date.now();
    router.push(href);
  };
  const m = money.data;
  const now = Date.now();
  const events = (m?.events ?? []).filter((e) => e.salesPaise > 0 || e.paidOutPaise > 0 || e.requestedPaise > 0);
  const isOpen = (e: HostEventMoney) => !!e.opensAt && Date.parse(e.opensAt) <= now;
  const ready = sum(events, (e) => (isOpen(e) ? e.availablePaise : 0));
  const later = sum(events, (e) => (isOpen(e) ? 0 : e.availablePaise));
  const asked = sum(events, (e) => e.requestedPaise);
  const verified = m?.account?.state === 'verified';
  const minus = (p: number) => (p ? `−${rupees(p)}` : rupees(0));
  const bankSheet = (replace: boolean): Href => ({ pathname: '/bank', params: { hostId: host.id, name: host.name, ...(replace && { replace: '1' }) } });

  const pick = (plan: Plan) =>
    Alert.alert('Change your fee plan?', 'It counts for sales from now on; each sale so far keeps the plan it was made on.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Change',
        onPress: async () => {
          setBusy(true);
          setSaid(null);
          const r = await api.authed('PATCH', `/hosts/${host.id}`, { feePlan: plan });
          setBusy(false);
          if (!r.ok) setSaid(r.error.message);
          money.reload();
        },
      },
    ]);

  return (
    <View style={styles.page}>
      <Glow tint={host.bg} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={money.loading && !!m} onRefresh={money.reload} tintColor={color.secondary} />}
      >
        <HostHead host={host} />
        {money.error && <Note>{money.error.message}</Note>}
        {m && (
          <>
            <View style={styles.bal}>
              <Text style={styles.kick}>Ready to ask</Text>
              <Text style={styles.big} accessibilityLabel={`Ready to ask: ${rupees(ready)}`}>
                {rupees(ready)}
              </Text>
              {later > 0 && <Text style={styles.kick}>{rupees(later)} more opens 3 days after each event ends</Text>}
              {asked > 0 && <Text style={styles.kick}>Asked for {rupees(asked)}, waiting to be paid by bank transfer</Text>}
            </View>

            <Section title="Fee plan" />
            <Card>
              {PLAN_ROWS.map((p) =>
                p.plan === m.plan ? (
                  <Row key={p.plan} label={p.label} note={p.note} value="Yours" dot />
                ) : (
                  <Row key={p.plan} label={p.label} note={p.note} onPress={busy ? undefined : () => pick(p.plan)} />
                ),
              )}
            </Card>
            {m.feeIncluded && <Note>Orbit set your buyer fee to come out of your prices, so buyers pay the price shown.</Note>}
            {said && <Note live>{said}</Note>}

            <Section title="The numbers" />
            <Card>
              <Row label="Ticket sales" value={rupees(sum(events, (e) => e.salesPaise))} />
              <Row label="Commission" value={minus(sum(events, (e) => e.commissionPaise))} />
              <Row label="Buyer fee you included" value={minus(sum(events, (e) => e.includedPaise))} />
              <Row label="Refunded" value={minus(sum(events, (e) => e.refundedPaise))} />
              <Row label="Your earnings" value={rupees(sum(events, (e) => e.earningsPaise))} strong />
              <Row label="Paid out" value={rupees(sum(events, (e) => e.paidOutPaise))} />
              <Row label="Available" value={rupees(sum(events, (e) => e.availablePaise))} strong />
            </Card>

            <Section title="By event" />
            {events.length === 0 ? (
              <Note>No paid sales yet.</Note>
            ) : (
              <Card>
                {events.map((e) => {
                  const can = isOpen(e) && e.availablePaise > 0 && verified;
                  const note = !e.opensAt
                    ? 'Opens 3 days after it ends'
                    : !isOpen(e)
                      ? `Opens ${day(e.opensAt)}`
                      : e.requestedPaise
                        ? `${rupees(e.requestedPaise)} asked for`
                        : e.availablePaise > 0
                          ? 'Open'
                          : 'All paid out';
                  return (
                    <Row
                      key={e.eventId}
                      label={e.eventTitle}
                      note={`${note} · earned ${rupees(e.earningsPaise)}`}
                      value={rupees(e.availablePaise)}
                      right={can ? <Pill label="Ask" onPress={() => open({ pathname: '/payout', params: { hostId: host.id, eventId: e.eventId, name: host.name } })} /> : undefined}
                    />
                  );
                })}
              </Card>
            )}

            <Section title="Payouts" />
            {m.payouts.length === 0 ? (
              <Note>No payouts yet.</Note>
            ) : (
              <Card>
                {m.payouts.map((p) => (
                  <Row
                    key={p.id}
                    label={p.eventTitle ?? 'Slots'}
                    note={
                      p.status === 'paid'
                        ? `Paid ${day(p.at)} · UTR ${p.utr}`
                        : p.status === 'requested'
                          ? `Asked ${day(p.askedAt)} · Orbit pays it by bank transfer`
                          : `Cancelled${p.reason ? ` · ${p.reason}` : ''}`
                    }
                    value={rupees(p.amountPaise)}
                  />
                ))}
              </Card>
            )}

            <Section title="Bank account" />
            <Card>
              {m.account ? (
                <Row
                  label={`${m.account.bankName} ••${m.account.last4}`}
                  note={`${m.account.holder} · ${
                    m.account.state === 'verified'
                      ? 'Verified'
                      : m.account.state === 'rejected'
                        ? `Not verified${m.account.reason ? `: ${m.account.reason}` : ''}`
                        : m.account.until
                          ? `Checking till ${day(m.account.until)}`
                          : 'Checking'
                  }`}
                  dot={verified}
                  right={<Pill label="Replace" onPress={() => open(bankSheet(true))} />}
                />
              ) : (
                <Row label="No bank account yet" note="Add one to be paid" right={<Pill label="Add" onPress={() => open(bankSheet(false))} />} />
              )}
            </Card>
            <Note>
              {verified
                ? 'Orbit pays by bank transfer and sends you the UTR.'
                : 'Orbit checks your account by hand within 72 hours; you can ask for payouts once it’s verified.'}
            </Note>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  bal: { marginTop: space.big, marginHorizontal: 20, gap: 4 },
  kick: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: color.secondary },
  big: { fontFamily: font.headline, fontSize: 40, lineHeight: 46, letterSpacing: -0.8, color: color.text, fontVariant: ['tabular-nums'] },
});
