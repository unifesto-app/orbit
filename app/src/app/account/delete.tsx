// Delete account (User doc, Account deletion), on the Orbit API: one screen with what goes, what is wiped and what
// stays, and anything blocking it, as the API lists them. Delete asks "Confirm it's you" (a code, Google, Apple or a
// passkey), then every device signs out at once and the account is deleted 30 days later, unless the person signs back
// in and keeps it (Keep my account, on the sign-in sheet and Account).
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Group, Note, Page, Pill, Row } from '../../account/kit';
import { day, deletesOn } from '../../account/rules';
import { useLoad } from '../../load';
import { api, signOut, useMe } from '../../session';
import { space } from '../../theme';
import { ensureFresh } from '../../ways';

type Blocker = { kind: 'ownsHost'; hostId: string; name: string } | { kind: 'onlyStaffHolder' };
type Deletion = { deleted: string[]; scrubbed: string[]; kept: string[]; blockers: Blocker[]; dueAt: string | null };

const say = (b: Blocker) => (b.kind === 'ownsHost' ? `Archive ${b.name}, the host you started` : 'Give Staff to someone else first');

export default function DeleteAccount() {
  const me = useMe();
  const { data, error, reload } = useLoad(`deletion|${me.id}`, () => api.authed<Deletion>('GET', '/me/deletion'), { keep: true });
  const working = useRef(false);
  const [on] = useState(() => deletesOn(Date.now())); // the day a deletion asked for now runs

  const remove = async () => {
    if (working.current) return;
    working.current = true;
    try {
      if (!(await ensureFresh())) return;
      const r = await api.authed<{ dueAt: string }>('POST', '/me/deletion');
      if (!r.ok) {
        Alert.alert(r.error.message);
        if (r.error.error === 'blocked') reload();
        return;
      }
      // Every session has ended on the API, this one too.
      signOut();
      router.dismissTo('/');
      Alert.alert('Account set to be deleted', `Your account will be deleted on ${day(r.data.dueAt)}. Sign in before then to keep it.`);
    } finally {
      working.current = false;
    }
  };

  if (!data)
    return (
      <Page title="Delete account">
        {error && (
          <View style={styles.failed}>
            <Note>{error.message}</Note>
            <View style={styles.retry}>
              <Pill label="Try again" size="small" onPress={reload} />
            </View>
          </View>
        )}
      </Page>
    );

  const blocked = data.blockers.length > 0;
  return (
    <Page title="Delete account">
      {/* The date only; the confirm says the rest (every device signs out, sign in before then to keep it). */}
      <Group bare>
        <Row label="Deleted on" value={data.dueAt ? day(data.dueAt) : on} />
      </Group>

      {blocked && (
        <Group title="Before it can go" bare>
          {data.blockers.map((b) => (
            <Row key={b.kind === 'ownsHost' ? b.hostId : b.kind} label={say(b)} />
          ))}
        </Group>
      )}

      <Group title="What is deleted" bare>
        {data.deleted.map((x) => (
          <Row key={x} label={x} />
        ))}
      </Group>
      <Group title="What is wiped from what stays" bare>
        {data.scrubbed.map((x) => (
          <Row key={x} label={x} />
        ))}
      </Group>
      <Group title="What is kept" bare>
        {data.kept.map((x) => (
          <Row key={x} label={x} />
        ))}
      </Group>

      <View style={styles.delete}>
        <Pill
          label="Delete account"
          size="wide"
          disabled={blocked || !!data.dueAt}
          onPress={() =>
            Alert.alert('Delete your account?', `Every device signs out now. Your account is deleted on ${on}. Sign in before then to keep it.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void remove() },
            ])
          }
        />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  delete: { marginTop: space.big },
  failed: { gap: space.small },
  retry: { alignItems: 'center' },
});
