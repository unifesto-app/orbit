import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { Splash } from '../splash/Splash';
import { color } from '../theme';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });
  // On a font load error, carry on with the system font rather than a stuck splash.
  const ready = loaded || !!error;
  const [splashDone, setSplashDone] = useState(false);

  return (
    <>
      <StatusBar style="light" />
      {/* Home mounts underneath as soon as it can draw, so the splash's zoom lands on it; and if the
          splash ever leaves through its cap first, Home mounts anyway rather than a blank screen. */}
      {(ready || splashDone) && (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.ground },
          }}
        />
      )}
      {!splashDone && <Splash ready={ready} onDone={() => setSplashDone(true)} />}
    </>
  );
}
