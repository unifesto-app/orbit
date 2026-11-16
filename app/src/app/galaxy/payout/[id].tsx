// One payout (Money flow, Payouts; Galaxy canvas, 16 Nov 2026): the host, what's to pay and how it's made up, the bank
// account it goes to (last 4 only), then the bank transfer's reference (UTR, 6 to 40 letters or numbers, never reused).
// Marking it paid and cancelling it are risky, so both go through the reason sheet: logged, and everyone holding Money
// is emailed.
// ponytail: the API checks the UTR was never used before and records the payout.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Field, Group, Note, Page, Row } from '../../../account/kit';
import { rupees } from '../../../console/money';
import { payoutPaise, payouts } from '../../../galaxy/data';
import { ago } from '../../../galaxy/due';
import { Choices, StaffNote, askReason, emailed, gated, opener } from '../../../galaxy/kit';
import { hosts, now } from '../../../mock';
import { canActOn } from '../../../modes';
import { Monogram, NotFound, Tag } from '../../../rows';
import { useMe } from '../../../session';
import { color, font, space } from '../../../theme';

const UTR = /^[A-Za-z0-9]{6,40}$/;

export default gated('money', function PayoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const [utr, setUtr] = useState('');
  const p = payouts.find((x) => x.id === id);
  const host = hosts.find((h) => h.id === p?.hostId);
  if (!p || !host) return <NotFound what="payout" />;

  const acts = canActOn(me, { hostId: host.id });
  return (
    <Page title={`Payout to ${host.name}`}>
      <Note>{`Asked ${ago(p.askedAt, now)} · ${p.event}`}</Note>
      <Group>
        <Row
          lead={<Monogram mark={host} size={40} />}
          label={host.name}
          note={host.kind}
          right={<Tag text={host.verified ? 'Verified' : 'Unverified'} />}
          onPress={opener(me, 'hosts', `/galaxy/host/${host.id}`)}
        />
      </Group>
      <Group>
        <View style={styles.total}>
          <Text style={styles.big}>{rupees(payoutPaise(p))}</Text>
          <Text style={styles.toPay}>to pay</Text>
        </View>
        <Row label="Sales" value={rupees(p.salesPaise)} />
        <Row label="Refunds" value={`−${rupees(p.refundsPaise)}`} />
        <Row label="Orbit’s fee" value={`−${rupees(p.feePaise)}`} />
      </Group>
      <Group title="Bank account">
        {p.bank.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
      </Group>

      <View style={styles.field}>
        <Field label="UTR" placeholder="6 to 40 letters or numbers" autoCapitalize="characters" autoCorrect={false} value={utr} onChangeText={setUtr} />
      </View>
      <StaffNote>{acts ? emailed('money') : 'You’re on this host’s team, so someone else pays it.'}</StaffNote>
      <Choices
        choices={[
          {
            label: 'Mark paid',
            disabled: !acts || !UTR.test(utr.trim()),
            onPress: () =>
              askReason({
                title: `Mark ${rupees(payoutPaise(p))} paid to ${host.name}?`,
                line: `UTR ${utr.trim().toUpperCase()}. They’re told it’s on its way.`,
                action: 'Mark paid',
                who: 'Only staff see this',
                feature: 'money',
              }),
          },
          {
            label: 'Cancel payout',
            muted: true,
            disabled: !acts,
            onPress: () =>
              askReason({
                title: `Cancel ${host.name}’s payout?`,
                line: 'The money stays held for them, and they can ask again.',
                action: 'Cancel payout',
                who: `${host.name}’s Admins see this`,
                feature: 'money',
              }),
          },
        ]}
      />
    </Page>
  );
});

const styles = StyleSheet.create({
  total: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.small },
  big: { fontFamily: font.headline, fontSize: 28, lineHeight: 34, color: color.text },
  toPay: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  field: { marginHorizontal: 20, marginTop: 24 },
});
