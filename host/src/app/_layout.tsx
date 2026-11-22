import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { color, font } from '@orbit/mobile/theme';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { isLaunch } from '../variant';

// The Orbit app's type (@orbit/mobile/theme's `font` names): Plus Jakarta Sans for heads, DM Sans for text.
export default function Layout() {
  const [loaded, error] = useFonts({ Sacramento_400Regular, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold });
  if (!loaded && !error) return null;
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }}>
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
}
