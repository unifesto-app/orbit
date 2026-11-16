// Appearance: what the app actually supports. Orbit is dark only (app.json's userInterfaceStyle, the Theme board), and
// no flow asks for a light theme, so Dark is the one choice. Two of the phone's accessibility settings change how Orbit
// looks, and Orbit follows them: Reduce Transparency swaps the glass for a solid fill (src/glass.tsx), Reduce Motion
// stops the Home carousel (src/home/Carousel.tsx). Titles only, no descriptions (owner, 15 Nov 2026).
// The app icon: the main one or an alternate (owner, 16 Nov 2026: Ticket and Hologram approved).
import { requireOptionalNativeModule } from 'expo';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Group, Page, Row } from '../../account/kit';
import { useAccessibility } from '../../glass';
import { color } from '../../theme';

// expo-alternate-app-icons' own import throws on a build made before it was added, so its native module is looked up
// here instead: null on such a build, and the App icon card is left out, as it is where the phone can't change icons.
type IconModule = {
  supportsAlternateIcons: boolean;
  getAppIconName(): string | null;
  setAlternateAppIcon(name: string | null): Promise<string | null>;
};
const native = requireOptionalNativeModule<IconModule>('ExpoAlternateAppIcons');
const icons = native?.supportsAlternateIcons ? native : null;
// null is the main icon. The other names are app.json's expo-alternate-app-icons entry (art: scripts/app-icon.cjs).
const ICONS = [
  { name: null, label: 'Orbit' },
  { name: 'Ticket', label: 'Ticket' },
  { name: 'Hologram', label: 'Hologram' },
] as const;

export default function Appearance() {
  const selected = <View style={styles.dot} accessibilityLabel="Selected" />;
  const transparency = useAccessibility('reduceTransparencyChanged');
  const motion = useAccessibility('reduceMotionChanged');
  const [icon, setIcon] = useState(() => icons?.getAppIconName() ?? null);
  // The dot follows what the phone reports afterwards, so a change the phone refused leaves it where it was.
  const pick = (name: string | null) => {
    if (!icons) return;
    icons
      .setAlternateAppIcon(name)
      .catch(() => {})
      .finally(() => setIcon(icons.getAppIconName()));
  };
  return (
    <Page title="Appearance">
      <Group title="Theme">
        <Row label="Dark" right={selected} />
      </Group>

      {icons && (
        <Group title="App icon">
          {ICONS.map((i) => (
            <Row
              key={i.label}
              label={i.label}
              right={i.name === icon ? selected : undefined}
              onPress={i.name === icon ? undefined : () => pick(i.name)}
            />
          ))}
        </Group>
      )}

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
