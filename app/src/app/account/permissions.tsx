// Permissions: what Orbit may use on this phone, and the way to the phone's settings to change it. The Notifications doc
// folds today's Permissions screen into Notifications; the owner listed it, so it stays, small. Location is read from
// the phone. Push and photos have no native module in the app yet (expo-notifications, an image picker), so Orbit has
// never asked for them: push comes after a first booking or follow (Notifications doc), photos with a profile photo.
// Titles only, no descriptions (owner, 15 Nov 2026).
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Group, Page, Pill, Row } from '../../account/kit';
import { space } from '../../theme';

type Status = 'Allowed while using' | 'Not allowed' | 'Not asked yet' | '';

export default function Permissions() {
  const [location, setLocation] = useState<Status>('');
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
        <Row label="Notifications" value="Not asked yet" />
        <Row label="Photos" value="Not asked yet" />
      </Group>
      <View style={styles.open}>
        <Pill label="Open phone settings" size="wide" onPress={() => Linking.openSettings()} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({ open: { marginTop: space.big } });
