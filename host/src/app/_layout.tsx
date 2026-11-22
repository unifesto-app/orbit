import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { color, font } from '@orbit/mobile/theme';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { StationProvider } from '../station/state';
import { isLaunch, isStation } from '../variant';

// Station's short sheets (walk-in and block, you, payout, bank) are see-through, so their own frosted glass shows, as the Orbit
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
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }}>
        {/* Station's own: in Launch and Crew a link to them goes nowhere, since they read Station's state. */}
        <Stack.Protected guard={isStation}>
          <Stack.Screen name="(station)" />
          <Stack.Screen name="walkin" options={SHEET} />
          {/* The scanner takes the whole screen, over Today (take 2). */}
          <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: '#000' } }} />
          <Stack.Screen name="you" options={SHEET} />
          {/* Money's, Admins only (take 3). */}
          <Stack.Screen name="payout" options={SHEET} />
          <Stack.Screen name="bank" options={SHEET} />
        </Stack.Protected>
        {/* Orbit Launch's own: in Station and Crew a link to them goes nowhere. */}
        <Stack.Protected guard={isLaunch}>
          <Stack.Screen name="(launch)" />
          {/* Pushed over the tabs with the system back, until the Inbox gets its own take. */}
          <Stack.Screen
            name="inbox"
            options={{
              headerShown: true,
              title: 'Inbox',
              headerBackButtonDisplayMode: 'minimal', // it opens from any tab
              headerTintColor: color.text,
              headerStyle: { backgroundColor: color.ground },
              headerTitleStyle: { fontFamily: font.title },
              headerShadowVisible: false,
            }}
          />
        </Stack.Protected>
      </Stack>
    </>
  );
  return isStation ? <StationProvider>{stack}</StationProvider> : stack;
}
