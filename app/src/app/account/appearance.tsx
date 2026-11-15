// Appearance: what the app actually supports. Orbit is dark only (app.json's userInterfaceStyle, the Theme board), and
// no flow asks for a light theme, so Dark is the one choice. Two of the phone's accessibility settings change how Orbit
// looks, and Orbit follows them: Reduce Transparency swaps the glass for a solid fill (src/glass.tsx), Reduce Motion
// stops the Home carousel (src/home/Carousel.tsx). Titles only, no descriptions (owner, 15 Nov 2026).
import { StyleSheet, View } from 'react-native';

import { Group, Page, Row } from '../../account/kit';
import { useAccessibility } from '../../glass';
import { color } from '../../theme';

export default function Appearance() {
  const transparency = useAccessibility('reduceTransparencyChanged');
  const motion = useAccessibility('reduceMotionChanged');
  return (
    <Page title="Appearance">
      <Group title="Theme">
        <Row label="Dark" right={<View style={styles.dot} accessibilityLabel="Selected" />} />
      </Group>

      <Group title="From your phone">
        <Row label="Reduce transparency" value={transparency ? 'On' : 'Off'} />
        <Row label="Reduce motion" value={motion ? 'On' : 'Off'} />
      </Group>
    </Page>
  );
}

const styles = StyleSheet.create({
  // The pick, as on Search's chips: the accent on a dot, never on text.
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 4, backgroundColor: color.accent },
});
