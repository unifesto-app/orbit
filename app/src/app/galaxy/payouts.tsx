// Payouts waiting for staff (Money flow, Payouts), oldest first, each opening its own screen to pay.
import { router } from 'expo-router';

import { Group, Page, Row } from '../../account/kit';
import { rupees } from '../../console/money';
import { payoutPaise, payouts } from '../../galaxy/data';
import { ago, oldestFirst } from '../../galaxy/due';
import { gated } from '../../galaxy/kit';
import { hosts, now } from '../../mock';

export default gated('money', function Payouts() {
  return (
    <Page title="Payouts">
      <Group>
        {oldestFirst(payouts).map((p) => (
          <Row
            key={p.id}
            label={hosts.find((h) => h.id === p.hostId)?.name ?? p.hostId}
            note={`${p.event} · ${ago(p.askedAt, now)}`}
            value={rupees(payoutPaise(p))}
            onPress={() => router.push(`/galaxy/payout/${p.id}`)}
          />
        ))}
      </Group>
    </Page>
  );
});
