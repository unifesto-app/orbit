import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { role } from '@orbit/tokens';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { StationProvider } from '../station/state';
import { isStation } from '../variant';

// Station's short sheets (walk-in and block, you) are see-through, so their own frosted glass shows, as the Orbit
// app's venue sheet: as tall as what's in them, with a grabber.
const SHEET = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  contentStyle: { backgroundColor: 'transparent' },
} as const;

export default function Layout() {
  const [loaded, error] = useFonts({ Sacramento_400Regular, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold });
  if (!loaded && !error) return null;
  const stack = (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: role.ground } }}>
        {/* Station's own: in Launch and Crew a link to them goes nowhere, since they read Station's state. */}
        <Stack.Protected guard={isStation}>
          <Stack.Screen name="(station)" />
          <Stack.Screen name="walkin" options={SHEET} />
          {/* The scanner takes the whole screen, over Today (take 2). */}
          <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: '#000' } }} />
          <Stack.Screen name="you" options={SHEET} />
        </Stack.Protected>
      </Stack>
    </>
  );
  return isStation ? <StationProvider>{stack}</StationProvider> : stack;
}
