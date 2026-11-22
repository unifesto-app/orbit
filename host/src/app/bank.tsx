// Add or replace where Orbit pays the venue (Money flow, bank account): the holder's name, account number (9 to 18
// digits) and IFSC, or a UPI ID. Orbit checks it by hand against a cancelled cheque or statement; asks go in meanwhile
// and are paid once it's verified. A replacement needs the Admin to confirm it's them, waits 72 hours in Checking, and
// every Admin and the owner hear. Admins only.
// ponytail: "Confirm it's you" (a passkey or a code) comes with sign-in in the host apps; the mock replaces at once.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { type BankForm, bankFrom } from '../money';
import { useStation } from '../station/state';
import { close, Pill, Sheet, SheetSays, styles as ui } from '../station/ui';

export default function Bank() {
  const { replace } = useLocalSearchParams<{ replace?: string }>();
  const { role, venue, setBank } = useStation();
  const [f, setF] = useState<BankForm>({});
  const [why, setWhy] = useState<string>();
  const done = useRef(false);
  useEffect(() => {
    if (role !== 'admin') close(); // money is an Admin's
  }, [role]);
  if (role !== 'admin') return null;
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
  return (
    <Sheet title={swap ? 'Replace bank account' : 'Add bank account'} note={`Where Orbit pays ${venue.name}`}>
      {field('holder', 'Account holder', 'As the bank has it')}
      {field('account', 'Account number', '9 to 18 digits', 'number-pad')}
      {field('ifsc', 'IFSC', 'HDFC0001234')}
      {field('upi', 'Or a UPI ID', 'venue@okhdfcbank', 'email-address')}
      {why && <SheetSays text={why} />}
      <SheetSays
        text={
          swap
            ? 'You’ll confirm it’s you with your passkey or a code. Then Orbit checks it for 72 hours, every Admin hears, and asks already in wait to be confirmed again.'
            : 'Orbit checks it by hand against a cancelled cheque or bank statement; asks go in meanwhile and are paid once it’s verified.'
        }
      />
      <Pill
        wide
        label={swap ? 'Confirm it’s you and replace' : 'Add'}
        onPress={() => {
          const r = bankFrom(f, venue.name, Date.now());
          if ('why' in r) return setWhy(r.why);
          if (done.current) return;
          done.current = true;
          setBank(r.bank);
          close();
        }}
      />
    </Sheet>
  );
}
