// Ask for a payout (Money flow: everything available with one confirm; Change amount asks for less; X4), from either
// host app's Money: an event's money (`eventId`), or with none a venue's slot money. POST /hosts/:id/payouts; the API
// holds the rules (3 days after the end, a verified account, at most what's there, a venue once a week) and says
// which one stopped it. Orbit transfers it by hand and sends the UTR. Admins only.
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useHostMoney } from '../hostMoney';
import { paiseFrom, rupees } from '../money';
import { api } from '../session';
import { close, Pill, Sheet, SheetSays, styles as ui } from '../station/ui';

export default function Payout() {
  const { hostId, eventId, name = '' } = useLocalSearchParams<{ hostId: string; eventId?: string; name?: string }>();
  const money = useHostMoney(hostId);
  const [change, setChange] = useState(false);
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string>();
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const m = money.data;
  if (!m) return <Sheet title="Request a payout">{money.error && <SheetSays text={money.error.message} />}</Sheet>;
  if (!m.account)
    return (
      <Sheet title="Request a payout">
        <SheetSays text="Add where you get paid first." answers={[{ label: 'Add bank account', onPress: () => router.replace({ pathname: '/bank', params: { hostId, name } }) }]} />
      </Sheet>
    );
  const event = eventId ? m.events.find((e) => e.eventId === eventId) : undefined;
  const available = event ? event.availablePaise : (m.venue?.availablePaise ?? 0);
  const amount = change ? (paiseFrom(text) ?? 0) : available;
  const verified = m.account.state === 'verified';
  const ok = verified && amount > 0 && amount <= available;
  const ask = async () => {
    if (!ok || done.current) return;
    done.current = true;
    setBusy(true);
    const r = await api.authed('POST', `/hosts/${hostId}/payouts`, { ...(eventId && { eventId }), amountPaise: amount });
    setBusy(false);
    if (r.ok) return close();
    done.current = false;
    setSaid(r.error.message);
    money.reload();
  };
  return (
    <Sheet title={ok ? `Request ${rupees(amount)}` : 'Request a payout'} note={`${event ? `${event.eventTitle} · ` : ''}To ${m.account.bankName} ••${m.account.last4}`}>
      {change && (
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          keyboardType="decimal-pad"
          placeholder={`Up to ${rupees(available)}`}
          placeholderTextColor={ui.label.color}
          accessibilityLabel="Amount in rupees"
          style={ui.input}
        />
      )}
      <SheetSays
        text={
          said ??
          (!verified
            ? 'Orbit pays once your bank account is verified. Ask then.'
            : ok
              ? `Orbit transfers it to your bank and sends you the UTR.${event ? '' : ' Your next ask is a week on.'}`
              : `Ask for up to ${rupees(available)}.`)
        }
      />
      <View style={styles.row}>
        {!change && (
          <View style={styles.grow}>
            <Pill wide label="Change amount" onPress={() => setChange(true)} />
          </View>
        )}
        <View style={styles.grow}>
          <Pill wide label={busy ? 'Sending…' : 'Request'} disabled={!ok || busy} onPress={() => void ask()} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
});
