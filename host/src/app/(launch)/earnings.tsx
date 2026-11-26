// Money, Event Partner's second tab (route `earnings`: Station has `/money`). Money take 1 (approved 22 Nov 2026,
// https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg) draws Available, the fee plan, the host's numbers, each event's
// payout and the bank account; its rules are in src/launch/money.ts.
// ponytail: no money routes exist until payments go live (Razorpay keys), so the tab says so in one card (plan F31).
// Take 1 comes back on the money API.
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space } from '@orbit/mobile/theme';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHost } from '../../launch/host';
import { Glow, HostHead, styles as ui } from '../../launch/ui';

export default function Money() {
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const host = useHost();
  if (!host) return null;
  return (
    <View style={styles.page}>
      <Glow tint={host.bg} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }} onScroll={onScroll} scrollEventThrottle={16}>
        <HostHead host={host} />
        <View style={[ui.card, styles.stub]}>
          <Text style={styles.line}>Payouts open when payments go live.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  stub: { marginTop: space.big },
  line: { fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
});
