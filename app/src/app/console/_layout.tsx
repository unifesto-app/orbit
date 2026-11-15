// Console, host management in the app (owner, 16 Nov 2026). A Stack holding the tabs (console/(tabs)) and everything
// pushed from them, so a link into any Console screen passes this check first. Someone on no host's team sees Start a
// host, never an error (Hosts doc). The check only decides what to draw; the API checks every host route itself.
import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';

import { HostPick, keepHost, lastHost } from '../../console/data';
import { useMe } from '../../session';
import { color } from '../../theme';

// The tabs always sit under the host switcher, even when a link opens on it, so its close has somewhere to go back to.
export const unstable_settings = { anchor: '(tabs)' };

export default function ConsoleLayout() {
  const [hostId, setHostId] = useState(lastHost);
  const pick = (id: string) => setHostId(keepHost(id));
  const me = useMe(); // signed out, on no team
  if (me.teams.length === 0) return <Redirect href="/account/host" />;
  return (
    <HostPick value={{ hostId, pick }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }}>
        {/* The host switcher, a short glass sheet like the mode sheet. */}
        <Stack.Screen
          name="hosts"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack>
    </HostPick>
  );
}
