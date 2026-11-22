import { OrbitSays } from '@orbit/mobile/orbitSays';
import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from '../../launch/ui';

// Host, the host's page and team (route `team`). Its take comes after Money's.
export default function Host() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingTop: insets.top + 12 }}>
      <Text style={styles.pageTitle} accessibilityRole="header">
        Host
      </Text>
      <OrbitSays text="Your host comes after Money: its page, logo and banner, your Admins and event team, and asking Orbit to verify you." />
    </ScrollView>
  );
}
