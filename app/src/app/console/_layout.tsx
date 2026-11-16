// Console, host management in the app (owner, 16 Nov 2026). A Stack holding the tabs (console/(tabs)) and everything
// pushed from them, so a link into any Console screen passes this check first. Someone on no host's team sees Start a
// host, never an error (Hosts doc). The check only decides what to draw; the API checks every host route itself.
// The teams are the account's own (GET /me), and the host showing is read from GET /hosts/:id here, once, for every tab.
import { Redirect, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { HostPick, keepHost, lastHost } from '../../console/data';
import { drawHost, hostsApi } from '../../hosts';
import { useLoad } from '../../load';
import { Failed, Waiting } from '../../rows';
import { api, refreshAccount, useMe } from '../../session';
import { color } from '../../theme';

// The tabs always sit under the host switcher, even when a link opens on it, so its close has somewhere to go back to.
export const unstable_settings = { anchor: '(tabs)' };

export default function ConsoleLayout() {
  const me = useMe(); // signed out, on no team
  const [hostId, setHostId] = useState(lastHost);
  const pick = useCallback((id: string) => setHostId(keepHost(id)), []);
  const team = me.teams.find((t) => t.hostId === hostId) ?? me.teams[0];
  // While another host loads, the one before stays up (still one of the account's), so picking in the switcher never
  // tears down the screens under it mid-close. A failed read never takes down a host already showing.
  const page = useLoad(team ? `${team.hostId}|${me.id}` : null, () => hostsApi(api).page(team!.hostId), { keep: true });
  const host = page.data && me.teams.some((t) => t.hostId === page.data!.id) ? page.data : null;

  useEffect(() => {
    if (!page.error) return;
    // Gone from this account since the app opened (archived by its owner, or they were removed): read the account's
    // teams again, so Console falls back to another host or to Start a host.
    if (page.status === 404) void refreshAccount();
    // A switch that failed: stay on the host showing, and say why.
    if (host && host.id !== team?.hostId) {
      // Back to the host showing, so its own reloads ask for it and not the one that failed. Set from the answer, once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHostId(keepHost(host.id));
      Alert.alert('Couldn’t open that host', page.error.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per failed answer
  }, [page.error]);

  if (!team) return <Redirect href="/account/host" />;
  if (!host) return page.error ? <Failed message={page.error.message} retry={page.reload} home /> : <Waiting />;
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
