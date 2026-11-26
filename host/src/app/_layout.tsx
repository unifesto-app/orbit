import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { color } from '@orbit/mobile/theme';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { adminHosts } from '../launch/host';
import { PushHost } from '../push';
import { refreshMe, useSession } from '../session';
import { seats } from '../station/seats';
import { StationProvider } from '../station/state';
import { isLaunch, isStation } from '../variant';

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
  // Every host app signs in: signed out it shows Sign in. Signed in, Event Partner shows its tabs on a host the account is
  // an Admin of (welcome with none), Station its tabs, Crew its name (index) until its own screens come.
  const session = useSession();
  const signedIn = !!session;
  const admin = isLaunch && !!session && adminHosts(session.me).length > 0;
  const onStation = isStation && !!session && seats(session.me).length > 0;
  useEffect(() => {
    if (signedIn) void refreshMe(); // once a launch: the account as the API has it now
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at launch or sign-in
  }, [signedIn]);
  if (!loaded && !error) return null;
  const stack = (
    <>
      <StatusBar style="light" />
      <PushHost />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }}>
        {/* Station's own: in Launch and Crew a link to them goes nowhere, since they read Station's state. */}
        <Stack.Protected guard={onStation}>
          <Stack.Screen name="(station)" />
          <Stack.Screen name="walkin" options={SHEET} />
          <Stack.Screen name="you" options={SHEET} />
          {/* Venue's edits, Admins only (take 4). */}
          <Stack.Screen name="setup" options={SHEET} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="signin" />
        </Stack.Protected>
        {/* Orbit Launch's own: in Station and Crew a link to them goes nowhere. */}
        <Stack.Protected guard={(isLaunch || isStation) && signedIn}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        {/* The Event Request's three steps, from welcome. */}
        <Stack.Protected guard={isLaunch && signedIn}>
          <Stack.Screen name="request" />
        </Stack.Protected>
        <Stack.Protected guard={admin}>
          <Stack.Screen name="(launch)" />
          {/* Which host, with several. */}
          <Stack.Screen name="pick" />
          {/* An event's editor: New event, a draft's Continue, a card's Edit event. */}
          <Stack.Screen name="edit" />
          {/* The ticket scanner, full screen over Events, from an open event's Scan or Find someone (X6). */}
          <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', contentStyle: { backgroundColor: '#000' } }} />
        </Stack.Protected>
        {/* Pushed over the tabs (welcome, Crew's screen), with its own back circle: anyone signed in, on every app, so a
            push about a seat just ended still opens it. */}
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="inbox" />
          {/* An event's announcements and automatic messages, from Messages on its card. */}
          <Stack.Screen name="event/[id]" />
        </Stack.Protected>
      </Stack>
    </>
  );
  // Keyed by account: signing out (or in as someone else) drops the last person's seat, day and writes in flight.
  return isStation ? <StationProvider key={signedIn ? session.me.id : 'out'}>{stack}</StationProvider> : stack;
}
