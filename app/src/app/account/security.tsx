// Sign-in and security, the owner's "Login Methods / Passkeys / Sessions": the User doc's one screen for every way in,
// the passkeys, and the devices signed in, with Sign out everywhere else. The phone can be changed but never removed,
// and nothing removes the last way in (canRemove). Apple is iOS only, as today.
// ponytail: Change, Link and Add a passkey need the fresh code or passkey check first, which comes with the API; Remove
// and Sign out confirm and update this screen only.
import { useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { devices as signedIn, methods as linked, passkeys as keys } from '../../account/data';
import { Group, Page, Pill, Row } from '../../account/kit';
import { canRemove, day, maskEmail, maskPhone, type Way } from '../../account/rules';
import { space } from '../../theme';

const NAMES = { phone: 'Phone', email: 'Email', google: 'Google', apple: 'Apple' } as const;

const confirm = (title: string, message: string, action: string, then: () => void) =>
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: then },
  ]);

export default function Security() {
  const [methods, setMethods] = useState(linked);
  const [passkeys, setPasskeys] = useState(keys);
  const [devices, setDevices] = useState(signedIn);
  const ways: Way[] = [...methods.map((m) => m.way), ...passkeys.map(() => 'passkey' as const)];
  const shown = (['phone', 'email', 'google', 'apple'] as const).filter((w) => w !== 'apple' || Platform.OS === 'ios');

  return (
    <Page title="Sign-in and security">
      <Group title="Ways in">
        {shown.map((w) => {
          const m = methods.find((x) => x.way === w);
          const detail = !m ? 'Not linked' : w === 'phone' ? maskPhone(m.detail) : maskEmail(m.detail);
          const action = !m ? (
            <Pill label={w === 'email' ? 'Add' : 'Link'} size="small" />
          ) : w === 'phone' || w === 'email' ? (
            <Pill label="Change" size="small" />
          ) : canRemove(w, ways) ? (
            <Pill
              label="Remove"
              size="small"
              onPress={() =>
                confirm(`Remove ${NAMES[w]}?`, `You won’t be able to sign in with ${NAMES[w]} any more.`, 'Remove', () =>
                  setMethods((all) => all.filter((x) => x.way !== w)),
                )
              }
            />
          ) : undefined;
          return <Row key={w} label={NAMES[w]} note={detail} right={action} />;
        })}
      </Group>

      <Group title="Passkeys">
        {passkeys.map((p) => (
          <Row
            key={p.id}
            label={p.name}
            note={`Added ${day(p.added)}`}
            right={
              canRemove('passkey', ways) ? (
                <Pill
                  label="Remove"
                  size="small"
                  onPress={() =>
                    confirm(`Remove ${p.name}?`, 'This passkey stops working for Orbit.', 'Remove', () =>
                      setPasskeys((all) => all.filter((x) => x.id !== p.id)),
                    )
                  }
                />
              ) : undefined
            }
          />
        ))}
        {passkeys.length === 0 && <Row label="No passkeys" />}
      </Group>
      <View style={styles.add}>
        <Pill label="Add a passkey" size="small" />
      </View>

      <Group title="Devices">
        {devices.map((d) => (
          <Row
            key={d.id}
            label={d.name}
            note={`${d.surface} · ${d.current ? 'This device' : `Active ${day(d.lastActive)}`}`}
            right={
              !d.current && (
                <Pill
                  label="Sign out"
                  size="small"
                  onPress={() => confirm(`Sign out ${d.name}?`, 'It will need a code or passkey to sign in again.', 'Sign out', () => setDevices((all) => all.filter((x) => x.id !== d.id)))}
                />
              )
            }
          />
        ))}
      </Group>
      {devices.length > 1 && (
        <View style={styles.add}>
          <Pill
            label="Sign out everywhere else"
            size="small" // small, like Add a passkey (owner, 15 Nov 2026: "make them small")
            onPress={() =>
              confirm('Sign out everywhere else?', 'Every other phone and browser signs out now. This phone stays signed in.', 'Sign out', () =>
                setDevices((all) => all.filter((x) => x.current)),
              )
            }
          />
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({ add: { marginTop: space.small + 4, alignItems: 'center' } });
