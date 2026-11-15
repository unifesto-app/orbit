import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { Splash } from '../splash/Splash';
import { color } from '../theme';

// The tabs always sit under the location sheet, even when the app opens or reloads on /location, so Close has a
// screen to go back to (without it: "GO_BACK was not handled", and the sheet shows as a plain card).
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const [loaded, error] = useFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    Sacramento_400Regular,
  });
  // On a font load error, carry on with the system font rather than a stuck splash.
  const ready = loaded || !!error;
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  return (
    <>
      <StatusBar style="light" />
      {/* Home mounts underneath as soon as it can draw, so the splash's zoom lands on it; and if the
          splash starts leaving through its cap first, Home mounts then, never a blank screen. */}
      {(ready || splashLeaving) && (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.ground },
          }}
        >
          {/* The tabs, Home and Search (src/app/(tabs)/_layout.tsx), with the location as a sheet over them: swipe down
              on iOS, back on Android. */}
          <Stack.Screen name="location" options={{ presentation: 'modal' }} />
        </Stack>
      )}
      {!splashDone && <Splash ready={ready} onLeave={() => setSplashLeaving(true)} onDone={() => setSplashDone(true)} />}
    </>
  );
}
