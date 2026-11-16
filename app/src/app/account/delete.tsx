// Delete account (User doc, Account deletion): one screen with what goes, what stays and anything blocking it, then a
// confirm. Every device signs out at once and the account is deleted 30 days later, unless the person signs back in and
// keeps it. Same words as the web's /delete-account page.
// ponytail: the fresh code or passkey before Delete comes with the API; for now Delete confirms, signs this phone out
// (src/session.ts) and goes back Home.
import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { hostsStarted, refunds } from '../../account/data';
import { Group, Page, Pill, Row } from '../../account/kit';
import { deletesOn, deletionBlockers, isOpen } from '../../account/rules';
import { events, now, viewer } from '../../mock';
import { signOut } from '../../session';
import { space } from '../../theme';

export default function DeleteAccount() {
  const blockers = deletionBlockers({
    tickets: (viewer.tickets ?? []).map((t) => ({ eventId: t.eventId, title: events.find((e) => e.id === t.eventId)?.title ?? 'an event' })),
    openRefunds: refunds.filter((r) => isOpen(r.status)).map((r) => r.eventId),
    hostsStarted,
  });
  const on = deletesOn(now);
  const remove = () =>
    Alert.alert('Delete your account?', `Every device signs out now. Your account is deleted on ${on}. Sign in before then to keep it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          signOut();
          router.dismissTo('/');
        },
      },
    ]);

  return (
    <Page title="Delete account">
      {/* The date only; the confirm says the rest (every device signs out, sign in before then to keep it). */}
      <Group bare>
        <Row label="Deleted on" value={on} />
      </Group>

      {blockers.length > 0 && (
        <Group title="Before it can go" bare>
          {blockers.map((b) => (
            <Row key={b} label={b} />
          ))}
        </Group>
      )}

      <Group title="What is deleted" bare>
        <Row label="Sign-in methods, passkeys and sessions" />
        <Row label="Devices, notification settings, saved events, follows and notifications" />
        <Row label="Roles on hosts, your photo and anything you uploaded" />
      </Group>

      <Group title="What is wiped from what stays" bare>
        <Row label="Your name, phone, email and date of birth, your answers to hosts, names on tickets and support messages" />
      </Group>

      <Group title="What is kept" bare>
        <Row label="Bookings, payments, refunds and payouts, with your details removed" />
      </Group>

      <View style={styles.delete}>
        <Pill label="Delete account" size="wide" disabled={blockers.length > 0} onPress={remove} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({ delete: { marginTop: space.big } });
