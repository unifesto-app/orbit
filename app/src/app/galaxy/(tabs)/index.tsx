// Galaxy's dashboard (Galaxy doc, Dashboard; Galaxy canvas, 16 Nov 2026): what's waiting in the queues the viewer holds,
// how many in all and how many overdue, then each queue, overdue first; then the last 7 or 30 days against the period
// before; then this month's money for Money holders. Platform (legal documents, app settings, staff and the audit log)
// is the circle at the header's right, not a tab (owner, 16 Nov 2026: "move platform to header right side from tab").
// "Galaxy" heads it in Explore's script, as on the lock (owner, 16 Nov 2026: "in Galaxy screen use Explore font for
// galaxy").
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Chips, Group, Row } from '../../../account/kit';
import { rupees } from '../../../console/money';
import { type Count, money, month, numbers, payoutPaise, payouts, reports, requests, tickets } from '../../../galaxy/data';
import { due } from '../../../galaxy/due';
import { TabPage } from '../../../modeKit';
import { type StaffFeature, hasFeature } from '../../../modes';
import { now } from '../../../mock';
import { CircleButton, ScriptTitle, Section } from '../../../rows';
import { useMe } from '../../../session';
import { color, font, space } from '../../../theme';

const PERIODS = ['7 days', '30 days'] as const;
// The script title, small enough to sit in the 44pt header bar (Sacramento's line is about 1.46 times its size).
const TITLE = 30;

const change = ({ now: n, before, money: m }: Count) => {
  const v = m ? rupees(n) : n.toLocaleString('en-IN');
  if (before === 0) return v; // nothing to compare with
  const pct = Math.round((100 * (n - before)) / before);
  return `${v} · ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct)}%`;
};

type Waiting = { label: string; count: number; overdue: number; line?: string; feature: StaffFeature; open: string };
const overdue = (items: { askedAt: string }[]) => items.filter((i) => due(i.askedAt, now).overdue).length;
const open = tickets.filter((t) => t.status !== 'Resolved');
const owed = payouts.reduce((p, x) => p + payoutPaise(x), 0);
const WAITING: Waiting[] = [
  { label: 'Support', count: open.length, overdue: overdue(open.filter((t) => t.status === 'Open')), feature: 'queues', open: '/galaxy/queues?show=Support' },
  { label: 'Content reports', count: reports.length, overdue: overdue(reports), feature: 'queues', open: '/galaxy/queues?show=Reports' },
  { label: 'Requests', count: requests.length, overdue: overdue(requests), feature: 'queues', open: '/galaxy/queues?show=Requests' },
  { label: 'Payouts', count: payouts.length, overdue: 0, line: rupees(owed), feature: 'money', open: '/galaxy/payouts' },
  { label: 'Refunds', count: money.refunds, overdue: 0, feature: 'money', open: '/galaxy/money' },
  { label: 'Orphaned payments', count: money.orphaned, overdue: 0, feature: 'money', open: '/galaxy/money' },
  { label: 'Failed refunds', count: money.failedRefunds, overdue: 0, feature: 'money', open: '/galaxy/money' },
  { label: 'Reconciliation gaps', count: money.gaps, overdue: 0, feature: 'money', open: '/galaxy/money' },
  { label: 'Disputes', count: money.disputed, overdue: 0, feature: 'money', open: '/galaxy/money' },
];
const value = (w: Waiting) => [String(w.count), w.line, w.overdue ? `${w.overdue} overdue` : undefined].filter(Boolean).join(' · ');

export default function Dashboard() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('7 days');
  const me = useMe();
  const seesMoney = hasFeature(me, 'money'); // money rows only for Money holders (Roles doc)
  const waiting = WAITING.filter((w) => w.count > 0 && hasFeature(me, w.feature)).sort((a, b) => b.overdue - a.overdue);
  const total = waiting.reduce((n, w) => n + w.count, 0);
  const late = waiting.reduce((n, w) => n + w.overdue, 0);
  const platform = hasFeature(me, 'platform') || hasFeature(me, 'staff');
  return (
    <TabPage
      head={<ScriptTitle title="Galaxy" size={TITLE} />}
      tint={color.galaxy}
      right={platform ? <CircleButton icon="sliders" label="Platform" onPress={() => router.push('/galaxy/platform')} /> : undefined}>
      <Group title="Waiting">
        <View style={styles.total}>
          <Text style={styles.big}>{total > 0 ? `${total} waiting` : 'Nothing waiting'}</Text>
          {late > 0 && <Text style={styles.late}>{`${late} overdue`}</Text>}
        </View>
        {waiting.map((w) => (
          <Row key={w.label} label={w.label} value={value(w)} onPress={() => router.navigate(w.open)} />
        ))}
      </Group>

      <Section title="Last" />
      <View style={styles.chips}>
        <Chips options={PERIODS} value={period} onChange={setPeriod} />
      </View>
      <Group>
        {numbers[period]
          .filter((c) => seesMoney || !c.money)
          .map((c) => (
            <Row key={c.label} label={c.label} value={change(c)} />
          ))}
      </Group>

      {seesMoney && (
        <Group title={month.name}>
          {month.rows.map((r) => (
            <Row key={r.label} label={r.label} value={rupees(r.paise)} />
          ))}
        </Group>
      )}
    </TabPage>
  );
}

const styles = StyleSheet.create({
  chips: { marginHorizontal: 20 },
  total: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.small },
  big: { fontFamily: font.headline, fontSize: 28, lineHeight: 34, color: color.text },
  late: { fontFamily: font.text, fontSize: 13, color: color.secondary },
});
