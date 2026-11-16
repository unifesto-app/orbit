// Galaxy's money (Money flow, Orbit's side in Galaxy; Galaxy canvas, 16 Nov 2026), for staff with the Money feature:
// what's waiting, last night's reconciliation, then transactions and fees. Every money action is a risky one: a written
// reason, an audit row written with the change, and an email to everyone holding Money (Roles doc).
// ponytail: payouts open their screens; refunds, orphaned payments, disputes, transactions, reconciliation and fees
// are the next slice, so their rows don't open yet.
import { router } from 'expo-router';

import { Group, Row } from '../../../account/kit';
import { rupees } from '../../../console/money';
import { money, payoutPaise, payouts } from '../../../galaxy/data';
import { gated } from '../../../galaxy/kit';
import { TabPage } from '../../../modeKit';
import { color } from '../../../theme';

export default gated('money', function GalaxyMoney() {
  const owed = payouts.reduce((p, x) => p + payoutPaise(x), 0);
  return (
    <TabPage head="Money" tint={color.galaxy}>
      <Group title="Waiting">
        <Row label="Payouts" value={`${payouts.length} · ${rupees(owed)}`} onPress={() => router.push('/galaxy/payouts')} />
        <Row label="Refunds that reached Orbit" value={String(money.refunds)} />
        {money.failedRefunds > 0 && <Row label="Failed refunds" value={String(money.failedRefunds)} />}
        <Row label="Orphaned payments" value={String(money.orphaned)} />
        <Row label="Disputed" value={money.disputedLine} />
      </Group>
      <Group title="Reconciliation">
        {money.reconciliation.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
      </Group>
      <Group>
        <Row label="Transactions" value={money.transactions} />
        <Row label="Fees" value={money.fees} />
      </Group>
    </TabPage>
  );
});
