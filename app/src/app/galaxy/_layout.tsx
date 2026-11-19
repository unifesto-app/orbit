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
import { Glass } from '../../glass';
import { isStaff } from '../../modes';
import { Glow, ScriptTitle } from '../../rows';
import { useMe } from '../../session';
import { color, font, space } from '../../theme';

export const unstable_settings = { anchor: '(tabs)' };

type Lock = 'checking' | 'open' | 'locked' | 'no-passcode';

// The phone's own lock: Face ID or a fingerprint, falling back to the passcode. No passcode set means no Galaxy.
// Anything going wrong asking leaves it locked, with Unlock to try again.
async function askPhoneLock(): Promise<Lock> {
  try {
    if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) return 'no-passcode';
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Galaxy', cancelLabel: 'Cancel' });
    return res.success ? 'open' : 'locked';
  } catch {
    return 'locked';
  }
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
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }}>
      {/* Every risky action's reason, see-through like every other modal (src/app/_layout.tsx MODAL). */}
      <Stack.Screen name="reason" options={{ presentation: 'modal', contentStyle: { backgroundColor: 'transparent' } }} />
    </Stack>
  );
}

// The lock, the switch screen's glass (owner, 16 Nov 2026: "entering page glass one with Galaxy ( explore font )",
// "shortn the subtitle"): frosted glass with the ground at 70% over Galaxy's glow, "Galaxy" in Explore's script and one
// short line. No space dots (owner, 19 Nov 2026: "remove space dots, completely"). Nothing of Galaxy
// itself is drawn under the glass: without Liquid Glass it falls back to a clear fill, which would show staff data
// before the passcode.
function Locked({ lock, onUnlock }: { lock: Lock; onUnlock: () => void }) {
  const insets = useSafeAreaInsets();
  const line = lock === 'no-passcode' ? 'Set a passcode on this phone first.' : 'Use your passcode to enter.';
  return (
    <View style={styles.screen}>
      <Glow tint={color.galaxy} />
      <Glass style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={[styles.content, { paddingTop: insets.top + space.big, paddingBottom: insets.bottom + space.big }]}>
        <View style={styles.middle}>
          <ScriptTitle title="Galaxy" />
          <Text style={styles.line}>{line}</Text>
        </View>
        <View style={styles.buttons}>
          {lock === 'locked' && <Pill label="Unlock" size="wide" onPress={onUnlock} />}
          <Pill label="Back to Home" size="wide" muted onPress={() => router.dismissAll()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  shade: { backgroundColor: `${color.ground}B3` }, // the ground at 70% over the glass, as on the switch screen
  content: { flex: 1 },
  middle: { flex: 1, justifyContent: 'center', gap: 4 },
  line: { marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.secondary, textAlign: 'center' },
  buttons: { gap: space.small },
});
