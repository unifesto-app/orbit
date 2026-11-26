// Which host Event Partner shows, for an Admin of several (plan F31, L2): at first open, and from the switcher at the top
// of each tab. The pick is kept on the phone (src/launch/host.ts).
import { color, font, space } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { adminHosts, pickHost, useHost } from '../launch/host';
import { Card, Monogram, Row } from '../launch/ui';
import { useSession } from '../session';

export default function Pick() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const current = useHost();
  if (!session) return null;
  const hosts = adminHosts(session.me);
  const open = (id: string) => {
    pickHost(id);
    if (router.canGoBack()) router.back();
    else router.replace('/events');
  };
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingTop: insets.top + 28, paddingBottom: insets.bottom + space.big }}>
      <Text style={styles.title} accessibilityRole="header">
        Which host?
      </Text>
      <Card style={styles.card} indent={44 + 12}>
        {hosts.map((h) => (
          <Row
            key={h.id}
            lead={<Monogram host={h} size={44} />}
            label={h.name}
            value={h.id === current?.id && router.canGoBack() ? 'Showing' : undefined}
            onPress={() => open(h.id)}
          />
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  title: { marginHorizontal: 20, fontFamily: font.headline, fontSize: 28, lineHeight: 34, letterSpacing: -0.3, color: color.text },
  card: { marginTop: space.big },
});
