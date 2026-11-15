// Transactions: every payment, newest first, with the terms it sold under (Money doc: frozen at sale): the ticket price,
// the processing fee as a line of its own and never a percentage, how it was paid, and the payment ID the receipt email
// carries. A refunded payment says how much went back.
import { formatPrice } from '@orbit/contract';
import { StyleSheet, Text } from 'react-native';

import { payments, refunds } from '../../account/data';
import { Group, Note, Page, Row } from '../../account/kit';
import { day, year } from '../../account/rules';
import { events, now } from '../../mock';
import { color, font } from '../../theme';

export default function Transactions() {
  if (payments.length === 0)
    return (
      <Page title="Transactions">
        <Note>Nothing paid yet.</Note>
      </Page>
    );
  return (
    <Page title="Transactions">
      <Group>
        {payments.map((p) => {
          const back = refunds.find((r) => r.eventId === p.eventId && r.status === 'Refunded');
          const paid = year(p.paidAt) === year(now) ? day(p.paidAt) : `${day(p.paidAt)} ${year(p.paidAt)}`;
          const lines = [`${formatPrice(p.pricePaise)} + ${formatPrice(p.feePaise)} fee · ${p.via}`, `${paid} · ${p.id}`];
          if (back?.settled) lines.push(`${formatPrice(back.amountPaise)} refunded ${day(back.settled)}`);
          return (
            <Row
              key={p.id}
              label={events.find((e) => e.id === p.eventId)?.title ?? 'An event'}
              note={lines.join('\n')}
              right={<Text style={styles.total}>{formatPrice(p.pricePaise + p.feePaise)}</Text>}
            />
          );
        })}
      </Group>
    </Page>
  );
}

const styles = StyleSheet.create({
  total: { alignSelf: 'flex-start', marginTop: 2, fontFamily: font.price, fontSize: 15, color: color.text },
});
