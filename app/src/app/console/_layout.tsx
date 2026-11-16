// Console, host management in the app (owner, 16 Nov 2026). A Stack holding the tabs (console/(tabs)) and everything
// pushed from them, so a link into any Console screen passes this check first. Someone on no host's team sees Start a
// host, never an error (Hosts doc). The check only decides what to draw; the API checks every host route itself.
// The teams are the account's own (GET /me), and the host showing is read from GET /hosts/:id here, once, for every tab.
import { Redirect, Stack } from 'expo-router';
import { useCallback, useState } from 'react';

import { HostPick, keepHost, lastHost } from '../../console/data';
import { drawHost, hostsApi } from '../../hosts';
import { useLoad } from '../../load';
import { Failed, Waiting } from '../../rows';
import { api, useMe } from '../../session';
import { color } from '../../theme';

// The tabs always sit under the host switcher, even when a link opens on it, so its close has somewhere to go back to.
export const unstable_settings = { anchor: '(tabs)' };

export default function ConsoleLayout() {
  const me = useMe(); // signed out, on no team
  const [hostId, setHostId] = useState(lastHost);
  const pick = useCallback((id: string) => setHostId(keepHost(id)), []);
  const team = me.teams.find((t) => t.hostId === hostId) ?? me.teams[0];
  // While another host loads, the one before stays up (still one of the account's), so picking in the switcher never
  // tears down the screens under it mid-close.
  const page = useLoad(team ? `${team.hostId}|${me.id}` : null, () => hostsApi(api).page(team!.hostId), { keep: true });
  const host = page.data && me.teams.some((t) => t.hostId === page.data!.id) ? page.data : null;

  if (!team) return <Redirect href="/account/host" />;
  if (!host) return page.error ? <Failed message={page.error.message} retry={page.reload} /> : <Waiting />;
  return (
    <HostPick value={{ hostId: host.id, pick, host: drawHost(host), reload: page.reload }}>
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
