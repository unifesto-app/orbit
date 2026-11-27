// Orbit's own word before the phone's permission prompt, and when a permission is blocked ("permission asks" Take 1,
// owner, 27 Nov 2026: "Approve, build it", https://claude.ai/artifact/EbowYtSUETdgr76y6HUhNW). The sign-in sheet's frame
// (Frame in src/sheet.tsx): the scene, a title, one line, a wide pill for yes, a plain one under it for no or the way
// round, then where to look on the phone. Push's first ask stays Orbit's bubble (PushAsk in src/push.tsx; owner, 27 Nov
// 2026: "Keep push as bubble"); only push blocked comes here.
// - location: Allow location runs the phone's prompt (locate in src/place.ts); a place found is set as the location
//   screen's "Use my current location" sets it, a no swaps to location-off. Pick a city instead goes to the city list.
// - location-off: Open Settings, or pick a city.
// - push-off: Open Settings (only the phone can turn push back on), or keep them off.
// `from=location` when the location screen opened it: a place found closes both, back to where that was opened from.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Pill } from '../account/kit';
import { Blocked, locate, locationStatus, setPlace, usePlace } from '../place';
import { openPushSettings, pushStatus } from '../push';
import { Frame } from '../sheet';
import { color, font, space } from '../theme';

type Kind = 'location' | 'location-off' | 'push-off';

const android = Platform.OS === 'android';
const SHEETS = {
  location: {
    title: 'See what’s on near you',
    line: 'Orbit uses where you are to show events and places to play nearby. Only while you’re using the app.',
    yes: 'Allow location',
    no: 'Pick a city instead',
    note: 'Your phone asks next.',
  },
  'location-off': {
    title: 'Location is off for Orbit',
    line: 'Turn on While using the app in Settings, or pick your city and we’ll show what’s on there.',
    yes: 'Open Settings',
    no: 'Pick a city',
    note: android ? 'Settings › Apps › Orbit › Permissions' : 'Settings › Orbit › Location',
  },
  'push-off': {
    title: 'Notifications are off for Orbit',
    line: 'Your phone has them off, so only your phone can turn them back on. Your inbox still fills either way.',
    yes: 'Open Settings',
    no: 'Keep them off',
    note: android ? 'Settings › Apps › Orbit › Notifications' : 'Settings › Orbit › Notifications',
  },
} as const;

export default function Allow() {
  const params = useLocalSearchParams<{ kind?: string; from?: string }>();
  const [kind, setKind] = useState<Kind>(params.kind === 'location-off' || params.kind === 'push-off' ? params.kind : 'location');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromLocation = params.from === 'location';
  const place = usePlace();
  const sheet = SHEETS[kind];

  const close = () => router.canGoBack() && router.back();
  // Closed (X, a swipe) while the phone looked: nothing after that may set the place or close a screen under it.
  const open = useRef(true);
  useEffect(() => {
    open.current = true; // again after Strict Mode's test unmount
    return () => {
      open.current = false;
    };
  }, []);
  // Back from Settings with it turned on: the sheet has done its job, so it goes. From the location screen that lands
  // back on it, to tap Use my current location (nothing finds the place by itself).
  useEffect(() => {
    if (kind === 'location') return;
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active') return;
      const on = kind === 'push-off' ? (await pushStatus()) !== 'blocked' : (await locationStatus().catch(() => null)) === 'on';
      if (on && open.current) close();
    });
    return () => sub.remove();
  }, [kind]);
  // The city list: the location screen under this sheet, or, opened from elsewhere (Account › Permissions), in its place.
  const pickCity = () => (fromLocation ? close() : router.replace('/location'));

  async function allowLocation() {
    setBusy(true);
    setError(null);
    try {
      const name = await locate();
      if (!open.current) return;
      // As the location screen's choose(…, 'gps'). From elsewhere (Account › Permissions) a city the viewer picked stays:
      // they turned on the permission, not a new place (owner, 27 Nov 2026: "Keep picked city").
      if (fromLocation || place?.source !== 'pick') setPlace({ ...name, source: 'gps', nearAreas: [] });
      if (router.canGoBack()) router.dismiss(fromLocation ? 2 : 1);
    } catch (e) {
      if (!open.current) return;
      if (e instanceof Blocked) setKind('location-off');
      else setError('Couldn’t find where you are. Try again, or pick your city.');
      setBusy(false);
    }
  }

  const yes = kind === 'location' ? () => void allowLocation() : kind === 'push-off' ? openPushSettings : () => void Linking.openSettings();
  const no = kind === 'push-off' ? close : pickCity;

  return (
    <Frame title={sheet.title} note={sheet.line} error={error}>
      <View style={styles.body}>
        <Pill label={busy ? 'Locating…' : sheet.yes} size="wide" disabled={busy} onPress={yes} />
        {/* The no, or the way round: a plain pill, no glass, so the yes is the one that stands out (Take 1). */}
        <Pressable onPress={no} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }} style={styles.plain}>
          <Text style={styles.plainText}>{sheet.no}</Text>
        </Pressable>
        <Text style={styles.note}>{sheet.note}</Text>
      </View>
    </Frame>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.small },
  plain: { marginHorizontal: 20, height: 44, borderCurve: 'continuous', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  plainText: { fontFamily: font.title, fontSize: 14, color: color.text },
  note: { marginHorizontal: 20, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary, textAlign: 'center' },
});
