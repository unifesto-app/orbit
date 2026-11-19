// The ways to pay as Account's cards (owner, 19 Nov 2026: Unifesto's pay-method sheet "with orbit's ui"): UPI apps
// (four, then Show more), your UPI ID, a card, a wallet, your bank, and Apple Pay on iPhones (coming). The pick is the
// accent dot and stays on this phone (src/session.ts); lists and rules in src/pay.ts. Account › Payment methods shows it
// to set the way you usually pay; at checkout, How to pay (src/app/pay.tsx) shows it and closes on a pick, except a UPI
// ID, which stays open to type (as Unifesto's did). Titles only, no descriptions (owner, 15 Nov 2026).
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Field, Group, Row, TONE } from './account/kit';
import { BANKS, isVpa, payKey, SHOWN, UPI_APPS, WALLETS, type PayWith } from './pay';
import { setPayWith, usePayWith } from './session';
import { color, font } from './theme';

export function PayChoices({ onPicked }: { onPicked?: () => void }) {
  const pick = usePayWith();
  const [allApps, setAllApps] = useState(false);
  const [allBanks, setAllBanks] = useState(false);
  const choose = (p: PayWith) => {
    setPayWith(p);
    if (p.kind !== 'vpa') onPicked?.();
  };
  const on = (p: PayWith) => !!pick && payKey(pick) === payKey(p);
  const vpa = pick?.kind === 'vpa' ? pick.vpa : '';
  const apps = allApps ? UPI_APPS : UPI_APPS.slice(0, SHOWN);
  const banks = allBanks ? BANKS : BANKS.slice(0, SHOWN);

  return (
    <>
      <Group title="UPI apps">
        {apps.map((a) => (
          <Row key={a.id} icon="upi" tone={TONE.green} label={a.name} picked={on({ kind: 'upiApp', id: a.id })} onPress={() => choose({ kind: 'upiApp', id: a.id })} />
        ))}
        {!allApps && <Row label={`Show ${UPI_APPS.length - SHOWN} more UPI apps`} chevron onPress={() => setAllApps(true)} />}
      </Group>

      <Group title="UPI ID">
        <Row icon="vpa" tone={TONE.cyan} label="Your UPI ID" picked={pick?.kind === 'vpa'} onPress={() => choose({ kind: 'vpa', vpa })} />
        {pick?.kind === 'vpa' && (
          <View style={styles.vpa}>
            <Field
              label="UPI ID"
              value={vpa}
              onChangeText={(v) => setPayWith({ kind: 'vpa', vpa: v.trim() })}
              placeholder="name@bank"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={!vpa}
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={() => isVpa(vpa) && onPicked?.()}
              maxLength={256}
            />
            {vpa !== '' && !isVpa(vpa) && (
              <Text style={styles.warn} accessibilityLiveRegion="polite">
                A UPI ID looks like name@bank
              </Text>
            )}
          </View>
        )}
      </Group>

      <Group title="Card">
        <Row icon="card" tone={TONE.mint} label="Credit or debit card" picked={on({ kind: 'card' })} onPress={() => choose({ kind: 'card' })} />
      </Group>

      <Group title="Wallets">
        {WALLETS.map((w) => (
          <Row key={w.code} icon="wallet" tone={TONE.orange} label={w.name} picked={on({ kind: 'wallet', code: w.code })} onPress={() => choose({ kind: 'wallet', code: w.code })} />
        ))}
      </Group>

      <Group title="Netbanking">
        {banks.map((b) => (
          <Row key={b.code} icon="bank" tone={TONE.blue} label={b.name} picked={on({ kind: 'netbanking', bank: b.code })} onPress={() => choose({ kind: 'netbanking', bank: b.code })} />
        ))}
        {!allBanks && <Row label={`Show ${BANKS.length - SHOWN} more banks`} chevron onPress={() => setAllBanks(true)} />}
      </Group>

      {/* Apple Pay's own mark is Apple's to draw; until checkout takes it, it's listed as coming. */}
      {Platform.OS === 'ios' && (
        <Group title="Apple Pay">
          <Row icon="apple" tone={color.text} label="Apple Pay" value="Coming soon" />
        </Group>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  vpa: { gap: 6 },
  warn: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
