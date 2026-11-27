// Permissions: what Orbit may use on this phone, and the way to the phone's settings to change it. The Notifications doc
// folds today's Permissions screen into Notifications; the owner listed it, so it stays, small. Location is read from
// the phone, and so is push (src/push.tsx), which Orbit asks for at the first moment it helps (Notifications doc).
// Photos need no permission: the image picker shows only what you pick.
// Titles only, no descriptions (owner, 15 Nov 2026). Each row has a dot, the accent when allowed and a ring when not, and
// one not allowed has a Turn on pill in place of its value: Orbit's sheet first (src/app/allow.tsx), or, for push the
// phone can still ask, the phone's prompt at once ("permission asks" Take 1, owner, 27 Nov 2026: "Approve, build it").
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';

import { Group, Page, Pill, Row } from '../../account/kit';
import { locationStatus } from '../../place';
import { askPushFromSettings, pushStatus, type PushStatus } from '../../push';
import { color, space, stoneAt } from '../../theme';

type Status = 'ask' | 'on' | 'blocked' | 'none'; // 'none': not read (a build without the module)

const allow = (kind: 'location' | 'location-off' | 'push-off') => router.push({ pathname: '/allow', params: { kind } });

export default function Permissions() {
  const [location, setLocation] = useState<Status | null>(null);
  const [push, setPush] = useState<PushStatus | null>(null);
  const readPush = () => void pushStatus().then(setPush, () => setPush('none'));
  const readLocation = () => void locationStatus().then(setLocation, () => setLocation('none'));
  // Read on coming back to this screen (from the allow sheet) and whenever the app comes back (from the phone's
  // settings, say), as Notifications does.
  useFocusEffect(
    useCallback(() => {
      readPush();
      readLocation();
      const sub = AppState.addEventListener('change', (s) => {
        if (s !== 'active') return;
        readPush();
        readLocation();
      });
      return () => sub.remove();
    }, []),
  );

  // Allowed: the dot and its value. Not: the ring and Turn on. Not readable (a build without the module): the ring and
  // Not available, so no row is ever blank. Before the first read (null), the ring and nothing yet.
  const row = (label: string, now: Status | null, value: string, turnOn: () => void) =>
    now === null ? (
      <Row lead={<Dot on={false} />} label={label} />
    ) : now === 'on' ? (
      <Row lead={<Dot on />} label={label} value={value} />
    ) : now === 'none' ? (
      <Row lead={<Dot on={false} />} label={label} value="Not available" />
    ) : (
      <Row
        lead={<Dot on={false} />}
        label={label}
        right={<Pill label="Turn on" size="small" accessibilityLabel={`Turn on ${label.toLowerCase()}`} onPress={turnOn} />}
      />
    );

  return (
    <Page title="Permissions">
      <Group>
        {row('Location', location, 'While using', () => allow(location === 'ask' ? 'location' : 'location-off'))}
        {row('Notifications', push, 'On', () => (push === 'ask' ? void askPushFromSettings().then(readPush) : allow('push-off')))}
        <Row lead={<Dot on />} label="Photos" value="Only what you pick" />
      </Group>
      <View style={styles.open}>
        <Pill label="Open phone settings" size="wide" onPress={() => Linking.openSettings()} />
      </View>
    </Page>
  );
}

// Allowed or not, at a glance: a dot, never an icon, in the cards (owner: no icons in cards).
function Dot({ on }: { on: boolean }) {
  return <View style={[styles.dot, on ? styles.dotOn : styles.dotOff]} accessible={false} />;
}

const DOT = 8;
const styles = StyleSheet.create({
  open: { marginTop: space.big },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, marginRight: 12 },
  dotOn: { backgroundColor: color.accent },
  dotOff: { borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.4) },
});
