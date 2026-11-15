// Galaxy's dashboard (Galaxy doc, Dashboard and platform settings): what's waiting for staff first, anything overdue at
// the top; then the last 7 or 30 days against the period before; then this month's money.
// ponytail: the waiting rows don't open their queues yet; the queues' own screens are the next slice.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chips, Group, Row } from '../../../account/kit';
import { rupees } from '../../../console/money';
import { type Count, month, numbers, waiting } from '../../../galaxy/data';
import { Empty, TabPage } from '../../../modeKit';
import { hasFeature } from '../../../modes';
import { Section } from '../../../rows';
import { useMe } from '../../../session';

const PERIODS = ['7 days', '30 days'] as const;

const change = ({ now, before, money }: Count) => {
  const n = money ? rupees(now) : now.toLocaleString('en-IN');
  if (before === 0) return n; // nothing to compare with
  const pct = Math.round((100 * (now - before)) / before);
  return `${n} · ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct)}%`;
};

export default function Dashboard() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('7 days');
  const me = useMe();
  const money = hasFeature(me, 'money'); // money rows only for Money holders (Roles doc)
  const open = waiting
    .filter((w) => w.count > 0 && hasFeature(me, w.feature))
    .sort((a, b) => (b.overdue ?? 0) - (a.overdue ?? 0));
  return (
    <TabPage head="Galaxy">
      {open.length > 0 ? (
        <Group title="Waiting">
          {open.map((w) => (
            <Row key={w.label} label={w.label} value={w.overdue ? `${w.count} · ${w.overdue} overdue` : String(w.count)} />
          ))}
        </Group>
      ) : (
        <Empty>Nothing waiting.</Empty>
      )}

      <Section title="Last" />
      <View style={styles.chips}>
        <Chips options={PERIODS} value={period} onChange={setPeriod} />
      </View>
      <Group>
        {numbers[period]
          .filter((c) => money || !c.money)
          .map((c) => (
            <Row key={c.label} label={c.label} value={change(c)} />
          ))}
      </Group>

      {money && (
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
});
