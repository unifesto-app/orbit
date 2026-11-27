// Appearance: what the app actually supports. Orbit is dark only (app.json's userInterfaceStyle, the Theme board), and
// no flow asks for a light theme, so Dark is the one choice. Two of the phone's accessibility settings change how Orbit
// looks, and Orbit follows them: Reduce Transparency swaps the glass for a solid fill (src/glass.tsx), Reduce Motion
// stops the Home carousel (src/home/Carousel.tsx). Each is also Orbit's own switch (owner, 27 Nov 2026), for Orbit
// alone; when the phone's is on, the row just says On. Titles only, no descriptions (owner, 15 Nov 2026).
// The app icon: the main one or an alternate (owner, 16 Nov 2026: Ticket and Hologram approved; 19 Nov 2026: In orbit,
// Heart and Glass added, Ticket redrawn green).
import { requireOptionalNativeModule } from 'expo';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Group, Page, Row, Toggle } from '../../account/kit';
import { setReduce, useForcedAccessibility, usePhoneAccessibility } from '../../glass';
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
// null is the main icon. The other names are app.json's expo-alternate-app-icons entry. Each row shows the icon itself
// (owner, 19 Nov 2026: "allow to see in appearance screen"); scripts/app-icon.cjs draws the art and these previews.
const ICONS = [
  { name: null, label: 'Orbit', thumb: require('../../../assets/icons/orbit-thumb.png') },
  { name: 'InOrbit', label: 'In orbit', thumb: require('../../../assets/icons/inorbit-thumb.png') },
  { name: 'Heart', label: 'Heart', thumb: require('../../../assets/icons/heart-thumb.png') },
  { name: 'Glass', label: 'Glass', thumb: require('../../../assets/icons/glass-thumb.png') },
  { name: 'Ticket', label: 'Ticket', thumb: require('../../../assets/icons/ticket-thumb.png') },
  { name: 'Hologram', label: 'Hologram', thumb: require('../../../assets/icons/hologram-thumb.png') },
] as const;

export default function Appearance() {
  const selected = <View style={styles.dot} accessibilityLabel="Selected" />;
  const phone = { transparency: usePhoneAccessibility('reduceTransparencyChanged'), motion: usePhoneAccessibility('reduceMotionChanged') };
  const own = { transparency: useForcedAccessibility('reduceTransparencyChanged'), motion: useForcedAccessibility('reduceMotionChanged') };
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
              lead={<Image source={i.thumb} style={styles.thumb} accessibilityIgnoresInvertColors />}
              label={i.label}
              right={i.name === icon ? selected : undefined}
              onPress={i.name === icon ? undefined : () => pick(i.name)}
            />
          ))}
        </Group>
      )}

      <Group title="Accessibility">
        <Row
          label="Reduce transparency"
          value={phone.transparency ? 'On' : undefined}
          right={phone.transparency ? undefined : <Toggle label="Reduce transparency" value={own.transparency} onChange={(on) => setReduce('reduceTransparencyChanged', on)} />}
        />
        <Row
          label="Reduce motion"
          value={phone.motion ? 'On' : undefined}
          right={phone.motion ? undefined : <Toggle label="Reduce motion" value={own.motion} onChange={(on) => setReduce('reduceMotionChanged', on)} />}
        />
      </Group>
    </Page>
  );
}

const styles = StyleSheet.create({
  // The pick, as on Search's chips: the accent on a dot, never on text.
  dot: { width: 8, height: 8, borderCurve: 'continuous', borderRadius: 4, marginRight: 4, backgroundColor: color.accent },
  // The icon as the home screen rounds it, with the card's outline so the Charcoal ones keep their edge.
  thumb: { width: 40, height: 40, borderRadius: 9, borderCurve: 'continuous', borderWidth: 1, borderColor: color.border, marginRight: 4 },
});
