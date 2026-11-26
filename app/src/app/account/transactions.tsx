// Transactions: every payment that took money, newest first, from GET /me/payments with the terms it sold under (Money
// doc: frozen at sale): the ticket price, the fee as a line of its own and never a percentage, and the payment ID the
// receipt email carries. A refunded one says how much went back. Signed out, a line and Sign in.
import { formatPrice } from '@orbit/contract';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Group, Note, Page, Row, SignInNote } from '../../account/kit';
import { day, year } from '../../account/rules';
import { useLoad } from '../../load';
import { paymentsApi } from '../../pay';
import { Failed, Waiting } from '../../rows';
import { api, useSession } from '../../session';
import { color, font } from '../../theme';

export default function Transactions() {
  const me = useSession()?.me.id;
  const page = useLoad(me ? `payments|${me}` : null, () => paymentsApi(api).mine());
  const [now] = useState(Date.now);
  return (
    <Page title="Transactions">
      {!me ? (
        <SignInNote>Sign in to see what you’ve paid.</SignInNote>
      ) : !page.data ? (
        page.error ? <Failed message={page.error.message} retry={page.reload} /> : <Waiting />
      ) : page.data.length === 0 ? (
        <Note>Nothing paid yet.</Note>
      ) : (
        <Group>
          {page.data.map((p) => {
            const paid = year(p.createdAt) === year(now) ? day(p.createdAt) : `${day(p.createdAt)} ${year(p.createdAt)}`;
            const lines = [`${formatPrice(p.pricePaise)}${p.feePaise ? ` + ${formatPrice(p.feePaise)} fee` : ''}`, `${paid} · ${p.razorpayPaymentId}`];
            if (p.refundedPaise) lines.push(`${formatPrice(p.refundedPaise)} refunded${p.refundedAt ? ` ${day(p.refundedAt)}` : ''}`);
            else if (p.status === 'refundPending') lines.push('Refund on its way');
            return (
              <Row
                key={p.id}
                label={p.eventTitle ?? p.hostName}
                note={lines.join('\n')}
                right={<Text style={styles.total}>{formatPrice(p.amountPaise)}</Text>}
              />
            );
          })}
        </Group>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  total: { alignSelf: 'flex-start', marginTop: 2, fontFamily: font.price, fontSize: 15, color: color.text },
});
