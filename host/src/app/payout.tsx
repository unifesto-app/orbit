// Request a payout, from Money's Request ₹X (Money flow: everything available with one confirm; Change amount asks for
// less). Orbit transfers it by hand and sends the UTR; the venue's next ask is a week on. Admins only.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { dayLabel } from '../station/day';
import { balance, paiseFrom, rupees, WEEK } from '../station/money';
import { useStation } from '../station/state';
import { close, Pill, Sheet, SheetSays, styles as ui } from '../station/ui';

export default function Payout() {
  const { role, money: m, now, ask } = useStation();
  const [change, setChange] = useState(false);
  const [text, setText] = useState('');
  const done = useRef<string | null>(null); // what Orbit said when Request was tapped: kept while the sheet closes
  useEffect(() => {
    if (role !== 'admin') close(); // money is an Admin's
  }, [role]);
  if (role !== 'admin') return null;
  if (!m.bank)
    return (
      <Sheet title="Request a payout">
        <SheetSays text="Add where you get paid first." answers={[{ label: 'Add bank account', onPress: () => router.replace('/bank') }]} />
      </Sheet>
    );
  const b = balance(
    m.days.flatMap((d) => d.sold),
    m.terms,
    m.payouts,
    now,
  );
  const amount = change ? (paiseFrom(text) ?? 0) : b.available;
  const can = now >= b.nextAsk; // once a week; an ask still waiting to be paid blocks nothing more
  const ok = can && amount > 0 && amount <= b.available;
  return (
    <Sheet title={ok ? `Request ${rupees(amount)}` : 'Request a payout'} note={`To ${m.bank.bank} ••${m.bank.last4}`}>
      {change && (
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          keyboardType="decimal-pad"
          placeholder={`Up to ${rupees(b.available)}`}
          placeholderTextColor={ui.label.color}
          accessibilityLabel="Amount in rupees"
          style={ui.input}
        />
      )}
      <SheetSays
        text={
          done.current ??
          (!can
            ? `Your next ask is from ${dayLabel(b.nextAsk)}.`
            : ok
              ? `Orbit transfers it to your bank and sends you the UTR. Your next ask is from ${dayLabel(now + WEEK)}.${m.bank.state !== 'verified' ? ' It’s paid once your account is verified.' : ''}`
              : `Ask for up to ${rupees(b.available)}.`)
        }
      />
      <View style={styles.row}>
        {!change && (
          <View style={styles.grow}>
            <Pill wide label="Change amount" onPress={() => setChange(true)} />
          </View>
        )}
        <View style={styles.grow}>
          <Pill
            wide
            label="Request"
            disabled={!ok}
            onPress={() => {
              if (!ok || done.current) return;
              done.current = `Asked for ${rupees(amount)}. Orbit transfers it and sends you the UTR.`;
              ask(amount);
              close();
            }}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
});
