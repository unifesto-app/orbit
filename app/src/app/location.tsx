// The location screen, a modal over Home (owner, 15 Nov 2026: "create a location modal screen. get functionality from
// website"). It works like the web's navbar picker (web/src/app/location-button.tsx): search, "Use my current
// location", Popular cities, then every city A to Z (the city sheet, src/citySheet.tsx, which Edit profile's city
// shares). Choosing closes it, and Home shows events near the new place.
import type { City } from '@orbit/contract';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { CitySheet } from '../citySheet';
import { Glass } from '../glass';
import { Blocked, locate, locationStatus, setPlace, usePlace } from '../place';
import { color, font, space } from '../theme';

type Status = 'idle' | 'locating' | 'failed';

export default function LocationScreen() {
  const place = usePlace();
  const [status, setStatus] = useState<Status>('idle');

  function choose(name: { area: string; city: string; state?: string; lat?: number; lng?: number }, source: 'gps' | 'pick') {
    setPlace({ ...name, source, nearAreas: [] }); // the API decides what's near (src/events.ts)
    if (router.canGoBack()) router.back(); // not if it was swiped away while locating
  }

  // Allowed already: find it now. Not yet, or blocked: Orbit's sheet says why first (src/app/allow.tsx; owner, 27 Nov
  // 2026: "Approve, build it"), and its Allow location brings up the phone's prompt.
  const allow = (kind: 'location' | 'location-off') => router.push({ pathname: '/allow', params: { kind, from: 'location' } });
  async function useCurrent() {
    setStatus('locating');
    try {
      const now = await locationStatus();
      if (now !== 'on') {
        setStatus('idle');
        return allow(now === 'ask' ? 'location' : 'location-off');
      }
      choose(await locate({ ask: false }), 'gps');
    } catch (e) {
      if (e instanceof Blocked) {
        setStatus('idle');
        allow('location-off'); // turned off between the two reads
      } else setStatus('failed');
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
      {status === 'failed' && (
        <Text style={[styles.noteText, styles.note]}>Couldn’t find where you are. Try again, or pick your city.</Text>
      )}
    </CitySheet>
  );
}

const styles = StyleSheet.create({
  current: { marginTop: space.small, marginHorizontal: 20, height: 50, borderCurve: 'continuous', borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  currentText: { fontFamily: font.title, fontSize: 15, color: color.text },
  note: { marginTop: space.small, marginHorizontal: 20 },
  noteText: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
