// Money, Orbit Launch's second tab (route `earnings`: Station has `/money`). Money take 1, approved 22 Nov 2026
// (https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg), from the Money flow doc's Sales, commission and payouts:
// - Available, big, with how much of it can be asked for now (a payout opens 3 days after an event's scheduled end);
// - the host's fee plan (3% from buyers + 2% from the host, or 5% + 0%; owner, 25 Nov 2026);
// - the host's numbers across all events (Ticket sales, Commission, Buyer fee you included where it does, Refunded,
//   Your earnings, Paid out, Available), the same as on the web Console;
// - each event, newest first, with its earnings and its payout: when it opens, Request ₹X, or what was paid out;
// - the bank account, by its last 4 digits, with its check.
// Admins see all of it; an Event lead only their own events (Hosts flow).
// ponytail: Admins' view only, from the mock. Request, a paid-out row (its UTR) and the bank account open nothing yet.
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space } from '@orbit/mobile/theme';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bank, events, feePlan, host, now, salesOf } from '../../launch/data';
import { dayWord, startsToday } from '../../launch/day';
import {
  type Sales,
  available,
  dayLabel,
  earnings,
  momentLabel,
  payoutOpens,
  readyNow,
  requestable,
  rupees,
  total,
} from '../../launch/money';
import { PLANS, percent } from '../../money';
import { Card, EventCard, Glow, HostHead, Note, Pill, Row, Section, styles as ui } from '../../launch/ui';

const date = (when: string) => when.split(' · ')[0]; // "Fri 20 Nov"
const fees = PLANS[feePlan];

export default function Money() {
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  // Newest first, each with its sales; an event with no sales yet has no money to show.
  const mine = [...events]
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .flatMap((e) => {
      const s = salesOf(e.id);
      return s ? [{ e, s }] : [];
    });
  const all = mine.map((m) => m.s);
  const ready = readyNow(all, now);
  const included = all.some((s) => s.feeBy === 'host');
  const held = total(all, (s) => s.openRefundsPaise);
  const waiting = total(all, (s) => s.refundsWaiting);
  const notes = [
    included ? undefined : `Buyers pay the ${percent(fees.buyer)} fee on top, so it isn’t in your numbers.`,
    held > 0 ? `${rupees(held)} is held for ${waiting > 1 ? `${waiting} refund requests` : 'a refund request'}.` : undefined,
  ].filter(Boolean);

  return (
    <View style={styles.page}>
      <Glow tint={host.bg} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }} onScroll={onScroll} scrollEventThrottle={16}>
        <HostHead host={host} />

        {all.length === 0 ? (
          <Note>No sales yet. Your money shows here once tickets sell.</Note>
        ) : (
          // One stop for a screen reader: the three lines read together.
          <View style={[ui.card, styles.available]} accessible>
            <Text style={styles.kicker}>Available</Text>
            <Text style={styles.amount}>{rupees(total(all, available))}</Text>
            <Text style={styles.line}>{ready > 0 ? `${rupees(ready)} ready to request now` : 'Nothing to request yet'}</Text>
          </View>
        )}

        {/* The plan shows before the first sale too: the host should know what a ticket costs it. */}
        <Section title="Commission" />
        <Card>
          <Row label="Fee plan" value={`${percent(fees.buyer)} from buyers + ${percent(fees.host)} from you`} />
        </Card>

        {all.length > 0 && (
          <>
            <Section title="All events" />
            <Card>
              <Row label="Ticket sales" value={rupees(total(all, (s) => s.salesPaise))} />
              <Row label="Commission" value={rupees(total(all, (s) => s.commissionPaise))} />
              {included && <Row label="Buyer fee you included" value={rupees(total(all, (s) => (s.feeBy === 'host' ? s.feesPaise : 0)))} />}
              <Row label="Refunded" value={rupees(total(all, (s) => s.refundedPaise))} />
              <Row label="Your earnings" value={rupees(total(all, earnings))} strong />
              <Row label="Paid out" value={rupees(total(all, (s) => s.paidOutPaise))} />
              <Row label="Available" value={rupees(total(all, available))} strong />
            </Card>
            {notes.length > 0 && <Note>{notes.join(' ')}</Note>}

            <Section title="By event" />
            <View style={styles.cards}>
              {mine.map(({ e, s }) => (
                <EventCard
                  key={e.id}
                  title={e.title}
                  poster={e.poster}
                  when={startsToday(e.startsAt, now) ? `${date(e.when)} · ${dayWord(e.startsAt, now).toLowerCase()}` : date(e.when)}
                  sold={`Your earnings ${rupees(earnings(s))}`}
                >
                  {payout(s, all)}
                </EventCard>
              ))}
            </View>
          </>
        )}

        <Section title="Bank account" />
        <Card>
          {bank ? (
            <Row
              label={`${bank.name} •••• ${bank.last4}`}
              value={bank.status}
              dot={bank.status === 'Verified'}
              spoken={`${bank.name}, account ending ${bank.last4}, ${bank.status}`}
              onPress={() => {}}
            />
          ) : (
            <Row label="Add where you get paid" onPress={() => {}} />
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

// An event's payout rows: when it opens; Request for what can be asked for; and what was paid out, beside a Request
// when more came in after (a held refund released). As an array, so the card draws a hairline between them.
function payout(s: Sales, all: readonly Sales[]) {
  if (payoutOpens(s) > now) return [<Row key="opens" label="Payout" value={`Opens ${momentLabel(payoutOpens(s))}`} />];
  const free = requestable(s, all, now);
  const rows = [];
  if (free > 0) rows.push(<Row key="ready" label="Payout ready" right={<Pill label={`Request ${rupees(free)}`} />} />);
  if (s.paidOutPaise > 0)
    rows.push(
      <Row key="paid" label="Paid out" value={s.paidOn ? `${rupees(s.paidOutPaise)} · ${dayLabel(s.paidOn)}` : rupees(s.paidOutPaise)} onPress={() => {}} />,
    );
  if (rows.length === 0) rows.push(<Row key="none" label="Payout" value={available(s) < 0 ? `${rupees(-available(s))} short` : 'Nothing to pay out'} />);
  return rows;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  available: { marginTop: space.big, gap: 4 },
  kicker: { fontFamily: font.medium, fontSize: 13, color: color.secondary },
  amount: { fontFamily: font.headline, fontSize: 36, lineHeight: 42, letterSpacing: -0.5, color: color.text, fontVariant: ['tabular-nums'] },
  line: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary },
  cards: { gap: space.big },
});
