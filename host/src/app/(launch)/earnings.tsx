import { OrbitSays } from '@orbit/mobile/orbitSays';
import { ScrollView, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from '../../launch/ui';

// Money, the host's (route `earnings`: Station has `/money`). Its take comes after Events' (one take at a time).
export default function Money() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingTop: insets.top + 12 }}>
      <Text style={styles.pageTitle} accessibilityRole="header">
        Money
      </Text>
      <OrbitSays text="Money comes next: the seven numbers across your events, each event’s payout with Request, the commission and your bank account." />
    </ScrollView>
  );
}
