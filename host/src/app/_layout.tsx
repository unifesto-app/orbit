import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { color } from '@orbit/mobile/theme';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { refreshMe, useSession } from '../session';
import { seats } from '../station/seats';
import { StationProvider } from '../station/state';
import { isLaunch, isStation, ONE_0 } from '../variant';

// Station's short sheets (walk-in and block, you, Venue's edits) are see-through, so their own frosted glass shows, as the Orbit
// app's venue sheet: as tall as what's in them, with a grabber.
const SHEET = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  contentStyle: { backgroundColor: 'transparent' },
} as const;

export default function Layout() {
  const [loaded, error] = useFonts({ Sacramento_400Regular, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold });
  // Every host app signs in: signed out it shows Sign in. Signed in, Launch shows the no-host screen until its tabs read
  // the API, Station its tabs, Crew its name (index) until its own screens come. Launch's Punchline demo opens only in
  // development builds (session.ts); Station has no demo, so a demo session there is signed out.
  const session = useSession();
  const signedIn = !!session && 'me' in session;
  const demo = !!session && 'demo' in session;
  useEffect(() => {
    if (signedIn) void refreshMe(); // once a launch: the account as the API has it now
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at launch or sign-in
  }, [signedIn]);
  if (!loaded && !error) return null;
  const stack = (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }}>
        {/* Station's own: in Launch and Crew a link to them goes nowhere, since they read Station's state. */}
        <Stack.Protected guard={isStation && signedIn && seats(session.me).length > 0}>
          <Stack.Screen name="(station)" />
          <Stack.Screen name="walkin" options={SHEET} />
          <Stack.Screen name="you" options={SHEET} />
          {/* Venue's edits, Admins only (take 4). */}
          <Stack.Screen name="setup" options={SHEET} />
          {/* The scanner takes the whole screen, over Today (take 2). Not in 1.0 (ONE_0). */}
          <Stack.Protected guard={!ONE_0}>
            <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: '#000' } }} />
          </Stack.Protected>
        </Stack.Protected>
        <Stack.Protected guard={!session || (isStation && !signedIn)}>
          <Stack.Screen name="signin" />
        </Stack.Protected>
        {/* Orbit Launch's own: in Station and Crew a link to them goes nowhere. */}
        <Stack.Protected guard={(isLaunch || isStation) && signedIn}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={isLaunch && demo}>
          <Stack.Screen name="(launch)" />
          {/* Pushed over the tabs, with its own back circle. */}
          <Stack.Screen name="inbox" />
        </Stack.Protected>
      </Stack>
    </>
  );
  // Keyed by account: signing out (or in as someone else) drops the last person's venue, role, day and bank details.
  return isStation ? <StationProvider key={signedIn ? session.me.id : 'out'}>{stack}</StationProvider> : stack;
}
