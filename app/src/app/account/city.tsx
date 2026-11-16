// City for new events nearby (User flow, Profile): optional, picked from the city list so no Google place name is kept,
// and seen by nobody else. Opened from Edit profile as a sheet like the location's (the same city sheet). A pick saves
// at once (PATCH /me) and closes; Remove city clears it. Event Request's city and Notifications' nearby switch start
// from it.
import type { Me as Account } from '@orbit/contract';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Note, Pill } from '../../account/kit';
import { CitySheet } from '../../citySheet';
import { api, setAccount, useSession } from '../../session';
import { space } from '../../theme';

export default function AccountCity() {
  const me = useSession()?.me;
  const city = me?.city ?? null; // an account from before the API kept cities has none
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false); // a second tap while saving does nothing
  const open = useRef(true); // swiped away while saving: the save still counts, but there's nothing to close
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  async function save(next: string | null) {
    if (!me || working.current) return;
    if (next === city) return router.back();
    working.current = true;
    setError(null);
    const r = await api.authed<Account>('PATCH', '/me', { city: next });
    working.current = false;
    if (!r.ok) return setError(r.error.message);
    setAccount(r.data);
    if (open.current) router.back();
  }

  return (
    <CitySheet title="City for new events" chosen={(c) => c.name === city} onPick={(c) => void save(c.name)}>
      {city && (
        <View style={styles.remove}>
          <Pill label="Remove city" size="wide" onPress={() => void save(null)} />
        </View>
      )}
      {error && <Note>{error}</Note>}
    </CitySheet>
  );
}

const styles = StyleSheet.create({
  remove: { marginTop: space.small },
});
