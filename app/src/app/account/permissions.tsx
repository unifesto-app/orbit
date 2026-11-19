// Permissions: what Orbit may use on this phone, and the way to the phone's settings to change it. The Notifications doc
// folds today's Permissions screen into Notifications; the owner listed it, so it stays, small. Location is read from
// the phone, and so is push (src/push.tsx), which Orbit asks for at the first moment it helps (Notifications doc);
// photos come with a profile photo.
// Titles only, no descriptions (owner, 15 Nov 2026).
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Group, Page, Pill, Row } from '../../account/kit';
import { pushStatus } from '../../push';
import { space } from '../../theme';

type Status = 'Allowed while using' | 'Allowed' | 'Not allowed' | 'Not asked yet' | '';

export default function Permissions() {
  const [location, setLocation] = useState<Status>('');
  const [push, setPush] = useState<Status>('');
  useEffect(() => {
    void pushStatus().then((s) => setPush(s === 'on' ? 'Allowed' : s === 'blocked' ? 'Not allowed' : 'Not asked yet'));
  }, []);
  useEffect(() => {
    // Loaded only when asked, as src/place.ts does.
    import('expo-location')
      .then((L) => L.getForegroundPermissionsAsync())
      // 'undetermined', not canAskAgain: Android can ask again after one denial.
      .then((p) => setLocation(p.granted ? 'Allowed while using' : p.status === 'undetermined' ? 'Not asked yet' : 'Not allowed'))
      .catch(() => setLocation(''));
  }, []);
  return (
    <Page title="Permissions">
      <Group>
        <Row label="Location" value={location} />
        <Row label="Notifications" value={push} />
        <Row label="Photos" value="Not asked yet" />
      </Group>
      <View style={styles.open}>
        <Pill label="Open phone settings" size="wide" onPress={() => Linking.openSettings()} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({ open: { marginTop: space.big } });
