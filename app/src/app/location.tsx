// The location screen, a modal over Home (owner, 15 Nov 2026: "create a location modal screen. get functionality from
// website"). It works like the web's navbar picker (web/src/app/location-button.tsx): search, "Use my current
// location", Popular cities, then every city A to Z (the city sheet, src/citySheet.tsx, which Edit profile's city
// shares). Choosing closes it, and Home shows events near the new place.
import type { City } from '@orbit/contract';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { CitySheet } from '../citySheet';
import { Glass } from '../glass';
import { Blocked, locate, setPlace, usePlace } from '../place';
import { color, font, space } from '../theme';

type Status = 'idle' | 'locating' | 'blocked' | 'failed';

export default function LocationScreen() {
  const place = usePlace();
  const [status, setStatus] = useState<Status>('idle');

  function choose(name: { area: string; city: string; state?: string; lat?: number; lng?: number }, source: 'gps' | 'pick') {
    setPlace({ ...name, source, nearAreas: [] }); // the API decides what's near (src/events.ts)
    if (router.canGoBack()) router.back(); // not if it was swiped away while locating
  }

  async function useCurrent() {
    setStatus('locating');
    try {
      choose(await locate(), 'gps');
    } catch (e) {
      setStatus(e instanceof Blocked ? 'blocked' : 'failed');
    }
  }

  return (
    <CitySheet
      title="Your location"
      chosen={(c: City) => place?.source === 'pick' && place.area === c.name && place.city === c.state}
      onPick={(c) => choose({ area: c.name, city: c.state, state: c.state }, 'pick')}
    >
      <Pressable onPress={useCurrent} disabled={status === 'locating'} accessibilityRole="button">
        <Glass style={styles.current}>
          <Text style={styles.currentText}>{status === 'locating' ? 'Locating…' : 'Use my current location'}</Text>
        </Glass>
      </Pressable>
      {status === 'blocked' && (
        <View style={styles.note}>
          <Text style={[styles.noteText, styles.grow]}>Location is off for Orbit. Turn it on in Settings.</Text>
          <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button" hitSlop={8}>
            <Glass style={styles.close}>
              <Text style={styles.closeText}>Settings</Text>
            </Glass>
          </Pressable>
        </View>
      )}
      {status === 'failed' && (
        <Text style={[styles.noteText, styles.note]}>Couldn’t find where you are. Try again, or pick your city.</Text>
      )}
    </CitySheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  // The Settings pill in the blocked note (the sheet's own close is an X, CloseButton in src/rows.tsx).
  close: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  closeText: { fontFamily: font.title, fontSize: 13, color: color.text },
  current: { marginTop: space.small, marginHorizontal: 20, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  currentText: { fontFamily: font.title, fontSize: 15, color: color.text },
  note: { marginTop: space.small, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: space.small },
  noteText: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
