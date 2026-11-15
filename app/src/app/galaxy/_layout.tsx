// Galaxy, Orbit's staff admin in the app (owner, 16 Nov 2026), in the app's own look. A Stack holding the tabs
// (galaxy/(tabs)) and everything pushed from them, so a link into any Galaxy screen passes this check first. Staff with
// at least one feature only; anyone else goes back to Home (popped, not replaced, so there's never a second Home under it)
// with no hint. No passkey and no separate session: "role and access is enough" (owner, 16 Nov; Roles doc).
// Entering asks for the phone's own lock every time, even with the role (owner, 16 Nov: "to use access galaxy, passcode
// is mandatory. even with role"): Face ID or a fingerprint, falling back to the passcode. A phone with no passcode set
// can't open Galaxy.
// This only decides what to draw. The API is the gate: every staff route checks the feature it needs.
import * as LocalAuthentication from 'expo-local-authentication';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pill } from '../../account/kit';
import { isStaff } from '../../modes';
import { useMe } from '../../session';
import { color, font, space } from '../../theme';

export const unstable_settings = { anchor: '(tabs)' };

type Lock = 'checking' | 'open' | 'locked' | 'no-passcode';

// The phone's own lock: Face ID or a fingerprint, falling back to the passcode. No passcode set means no Galaxy.
async function askPhoneLock(): Promise<Lock> {
  if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) return 'no-passcode';
  const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Galaxy', cancelLabel: 'Cancel' });
  return res.success ? 'open' : 'locked';
}

export default function GalaxyLayout() {
  const staff = isStaff(useMe()); // signed out, nobody: back to Home
  const [lock, setLock] = useState<Lock>('checking');
  // Asked each time Galaxy is entered: this layout mounts on entry and goes when Galaxy is left.
  useEffect(() => {
    if (!staff) {
      router.dismissAll();
      return;
    }
    let live = true;
    void askPhoneLock().then((l) => live && setLock(l));
    return () => {
      live = false;
    };
  }, [staff]);
  if (!staff) return null;
  const retry = () => {
    setLock('checking');
    void askPhoneLock().then(setLock);
  };
  if (lock !== 'open') return <Locked lock={lock} onUnlock={retry} />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }} />;
}

function Locked({ lock, onUnlock }: { lock: Lock; onUnlock: () => void }) {
  const insets = useSafeAreaInsets();
  const line =
    lock === 'no-passcode'
      ? 'Set a passcode on this phone to use Galaxy.'
      : lock === 'locked'
        ? 'Galaxy stays locked until you use your passcode.'
        : 'Use your passcode to open Galaxy.';
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.big, paddingBottom: insets.bottom + space.big }]}>
      <View style={styles.middle}>
        <Text style={styles.title} accessibilityRole="header">
          Galaxy
        </Text>
        <Text style={styles.line}>{line}</Text>
      </View>
      <View style={styles.buttons}>
        {lock === 'locked' && <Pill label="Unlock" size="wide" onPress={onUnlock} />}
        <Pill label="Back to Home" size="wide" muted onPress={() => router.dismissAll()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground, paddingHorizontal: 20 },
  middle: { flex: 1, justifyContent: 'center', gap: space.small },
  title: { fontFamily: font.headline, fontSize: 28, lineHeight: 34, color: color.text, textAlign: 'center' },
  line: { fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.secondary, textAlign: 'center' },
  buttons: { gap: space.small },
});
