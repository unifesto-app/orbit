// Add or replace where Orbit pays a host (Money flow, bank account; X4), from Money in either host app: the holder's
// name, account number (9 to 18 digits) and IFSC, or a UPI ID. PUT /hosts/:id/payout-account; Orbit checks it by hand
// against a cancelled cheque or statement, and pays only to a verified account. A replacement is checked again and
// every Admin hears. Admins only: the API answers anyone else with nothing.
// ponytail: no "Confirm it's you" (a passkey or a code) before a replacement yet; it comes with step-up in the host apps.
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { type BankForm, bankBody, bankFrom } from '../money';
import { api } from '../session';
import { close, Pill, Sheet, SheetSays, styles as ui } from '../station/ui';

export default function Bank() {
  const { hostId, name = '', replace } = useLocalSearchParams<{ hostId: string; name?: string; replace?: string }>();
  const [f, setF] = useState<BankForm>({});
  const [why, setWhy] = useState<string>();
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const swap = replace === '1';
  const field = (k: keyof BankForm, label: string, placeholder: string, keyboardType: 'default' | 'number-pad' | 'email-address' = 'default') => (
    <View style={ui.field}>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        value={f[k] ?? ''}
        onChangeText={(t) => setF((x) => ({ ...x, [k]: t }))}
        placeholder={placeholder}
        placeholderTextColor={ui.label.color}
        keyboardType={keyboardType}
        autoCapitalize={k === 'ifsc' ? 'characters' : k === 'holder' ? 'words' : 'none'}
        autoCorrect={false}
        autoComplete="off"
        textContentType="none" // the keyboard doesn't learn account numbers
        accessibilityLabel={label}
        style={ui.input}
      />
    </View>
  );
  const send = async () => {
    const r = bankFrom(f, name, Date.now());
    if ('why' in r) return setWhy(r.why);
    if (done.current || !hostId) return;
    done.current = true;
    setBusy(true);
    const out = await api.authed('PUT', `/hosts/${hostId}/payout-account`, bankBody(f));
    setBusy(false);
    if (out.ok) return close();
    done.current = false;
    setWhy(out.error.message);
  };
  return (
    <Sheet title={swap ? 'Replace bank account' : 'Add bank account'} note={name ? `Where Orbit pays ${name}` : undefined}>
      {field('holder', 'Account holder', 'As the bank has it')}
      {field('account', 'Account number', '9 to 18 digits', 'number-pad')}
      {field('ifsc', 'IFSC', 'HDFC0001234')}
      {field('upi', 'Or a UPI ID', 'name@okhdfcbank', 'email-address')}
      {why && <SheetSays text={why} />}
      <SheetSays
        text={
          swap
            ? 'Orbit checks the new one before paying to it, within 72 hours, and every Admin hears it changed.'
            : 'Orbit checks it by hand against a cancelled cheque or bank statement, within 72 hours. Payouts go to it once it’s verified.'
        }
      />
      <Pill wide label={busy ? 'Sending…' : swap ? 'Replace' : 'Add'} disabled={busy} onPress={() => void send()} />
    </Sheet>
  );
}
