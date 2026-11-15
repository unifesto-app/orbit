// Galaxy's money (Money flow, Orbit's side in Galaxy): transactions and disputes, refunds that reached Orbit, payouts,
// orphaned payments, the nightly reconciliation and fees, for staff with the Money feature. Every money action will be a
// risky one: a written reason, an audit row written with the change, and an email to everyone holding Money (Roles doc).
// ponytail: summary rows only; each screen and its actions are a later slice.
import { Group, Row } from '../../../account/kit';
import { money } from '../../../galaxy/data';
import { TabPage } from '../../../modeKit';

export default function GalaxyMoney() {
  return (
    <TabPage head="Money">
      <Group>
        {money.map((m) => (
          <Row key={m.label} label={m.label} value={m.value} />
        ))}
      </Group>
    </TabPage>
  );
}
