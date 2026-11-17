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
import { api, needsAccount, setAccount, useSession } from '../../session';
import { space } from '../../theme';

export default function AccountCity() {
  const me = useSession()?.me;
  const city = me?.city ?? null; // an account from before the API kept cities has none
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // set from the first tap until the sheet closes or the save fails: one save, one close
  const open = useRef(true); // swiped away while saving: the save still counts, but there's nothing to close
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  async function save(next: string | null) {
    if (!me) return needsAccount();
    if (working.current) return;
    working.current = true;
    if (next === city) return router.back();
    setBusy(true);
    setError(null);
    const r = await api.authed<Account>('PATCH', '/me', { city: next });
    setBusy(false);
    // An API from before cities drops the field and answers 200 with no city: that isn't saved either.
    const saved = r.ok && (r.data.city ?? null) === next;
    if (!saved) {
      working.current = false;
      return setError(r.ok ? 'Couldn’t save your city. Try again in a moment.' : r.error.message);
    }
    setAccount(r.data);
    if (open.current) router.back();
  }

  return (
    <CitySheet title="City for new events" chosen={(c) => c.name === city} onPick={(c) => void save(c.name)}>
      {city && (
        <View style={styles.remove}>
          <Pill label="Remove city" size="wide" disabled={busy} onPress={() => void save(null)} />
        </View>
      )}
      {busy ? <Note>Saving…</Note> : error && <Note>{error}</Note>}
    </CitySheet>
  );
}

const styles = StyleSheet.create({
  remove: { marginTop: space.small },
});
