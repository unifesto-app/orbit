// The app's tabs (owner, 15 Nov 2026: "add Tab Nav", "Home Search"). The system's own tab bar: Liquid Glass on iOS 26,
// so it matches the frosted glass on every other control, and Material on Android. The selected tab is white, never the
// accent (accent goes on elements, never text). The location sheet opens over the tabs (src/app/_layout.tsx).
// Icons are Phosphor duotone like the rest of the app (owner: "Phosphor duotone even in tab bar"), as PNGs made by
// scripts/icons.mjs: templates, so the bar tints them white or grey and the 20% layer keeps the duotone.
import { NativeTabs } from 'expo-router/native-tabs';
import { Platform } from 'react-native';

import { color, stoneAt } from '../../theme';

export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={color.text}
      iconColor={{ default: color.secondary, selected: color.text }}
      labelStyle={{ default: { color: color.secondary }, selected: { color: color.text } }}
      backgroundColor={color.ground} // Android and iOS before 26; iOS 26 draws its own glass
      indicatorColor={stoneAt(0.14)} // Android's pill behind the selected icon, the glass fallback's fill
      // Scrolling down shrinks the bar to the current tab's icon, with no labels; scrolling up brings it back (owner,
      // 15 Nov 2026: "when scroll make the tab small and remove text"). iOS 26 and later; Android keeps its bar.
      minimizeBehavior="onScrollDown"
    >
      {/* iOS would inset each screen's scroll view at the top too, pushing Home's carousel off the top of the screen
          and Search's pinned box away from it. Both pad their own bottom instead, from the tab's safe area, which
          includes the tab bar. */}
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets={Platform.OS === 'ios'}>
        <NativeTabs.Trigger.Icon src={require('../../../assets/tabs/home.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" disableAutomaticContentInsets={Platform.OS === 'ios'}>
        <NativeTabs.Trigger.Icon src={require('../../../assets/tabs/search.png')} renderingMode="template" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
