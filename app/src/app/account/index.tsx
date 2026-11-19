// Account, opened from the profile circle in Home's header (owner, 15 Nov 2026: Profile, Tickets, Favorites, Payment
// Methods, History, Transactions, Refunds, Appearance, Settings, Permissions, Following, Login Methods / Passkeys /
// Sessions, Logout, "If anything i missed include"). A screen pushed over the tabs, not a third tab: the tabs are Home
// and Search only. Grouped from the flow docs:
// - Your events: Tickets is the Booking doc's Upcoming, History its Past (and cancelled); Saved is the owner's Favorites,
//   named as the heart's Save and the Discover doc's "Profile › Saved".
// - Money: Transactions (receipts), Refunds (the Booking doc's statuses), Payment methods (how to pay; nothing stored).
// - Settings: the Notifications doc's switches, the location, Appearance (dark only, as app.json) and Permissions.
// - Account: the User doc's one Sign-in and security screen (ways in, passkeys, devices), and Delete account.
// - Added from the docs: Help and support, Terms, Privacy, the version. Host on Orbit was here too, until the owner
//   took the Hosting group out; it's the Event Request screen now (src/app/account/host.tsx), which nothing opens yet.
// Cards hold text only. Log out confirms first; Delete account opens its own screen with what goes and what blocks it.
import Constants from 'expo-constants';
import { type Href, router } from 'expo-router';
import { Alert, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Group, Page, Panel, Pill, Row, TONE } from '../../account/kit';
import { ProfileHead, useFollows } from '../../account/profile';
import { orbitAds } from '../../mock';
import { OrbitAdStrip } from '../../orbitAd';
import { day } from '../../account/rules';
import { keepAccount, needsAccount, signOut, useSession, useViewer } from '../../session';
import { color, font, space } from '../../theme';
import { Wordmark } from '../../wordmark';

const go = (href: Href) => () => router.push(href);
export default function Account() {
  const viewer = useViewer(); // signed in or out on this phone (src/session.ts)
  const { width } = useWindowDimensions();
  const due = useSession()?.me.deletionDue; // set to be deleted: Keep my account in place of Delete account
  const following = useFollows().count; // the profile's count, read here so it's ready when the profile opens
  const logOut = () =>
    Alert.alert('Log out of Orbit?', 'You’ll sign back in on this phone with a code or your passkey.', [
      { text: 'Cancel', style: 'cancel' },
      // Back to Home signed out; the API's session ends too.
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          signOut();
          router.dismissTo('/');
        },
      },
    ]);

  const openProfile = go('/account/profile');

  return (
    <Page>
      <Panel>
        {viewer.signedIn ? (
          // View profile opens it (owner, 19 Nov 2026: "replace swipe down, and change to button").
          <ProfileHead onOpen={openProfile} following={following} />
        ) : (
          // Signed out, only what works without an account; Sign in opens the sign-in sheet (src/app/login.tsx).
          <View style={styles.head}>
            <Text style={styles.name} accessibilityRole="header">
              Your account
            </Text>
            <View style={styles.headButtons}>
              <Pill label="Sign in" onPress={() => needsAccount()} />
            </View>
          </View>
        )}
      </Panel>

      {viewer.signedIn && (
        <>
          <Group title="Your events">
            <Row icon="ticket" tone={TONE.orange} label="Tickets" chevron onPress={go('/account/tickets')} />
            <Row icon="star" tone={TONE.yellow} label="Saved" chevron onPress={go('/account/saved')} />
            <Row icon="following" tone={TONE.violet} label="Following" chevron onPress={go('/account/following')} />
            <Row icon="history" tone={TONE.cyan} label="History" chevron onPress={go('/account/history')} />
          </Group>
          {/* One of Orbit's own ads, after Your events (owner, 19 Nov 2026: "add one in account", "move it after your
              events"), 24 below it as an untitled group. */}
          {orbitAds[0] && <OrbitAdStrip ad={orbitAds[0]} width={width - 40} style={styles.ad} symbols />}

          <Group title="Money">
            <Row icon="receipt" tone={TONE.green} label="Transactions" chevron onPress={go('/account/transactions')} />
            <Row icon="refund" tone={TONE.yellow} label="Refunds" chevron onPress={go('/account/refunds')} />
            <Row icon="card" tone={TONE.mint} label="Payment methods" chevron onPress={go('/account/payment')} />
          </Group>
        </>
      )}

      <Group title="Settings">
        {viewer.signedIn && <Row icon="bell" tone={TONE.red} label="Notifications" chevron onPress={go('/account/notifications')} />}
        {viewer.signedIn && (
          <Row icon="interests" tone={TONE.orange} label="Interests" chevron onPress={go('/account/interests')} />
        )}
        <Row icon="pin" tone={TONE.blue} label="Location" chevron onPress={go('/location')} />
        <Row icon="moon" tone={TONE.grape} label="Appearance" chevron onPress={go('/account/appearance')} />
        <Row icon="shield" tone={TONE.green} label="Permissions" chevron onPress={go('/account/permissions')} />
      </Group>

      {/* No Hosting group (owner, 16 Nov 2026: "even remove the hosting"). The app is the people side only (owner,
          19 Nov 2026: "remove switch, remove console and remove the galaxy from mobile completely"). */}
      {viewer.signedIn && (
        <Group title="Account">
          <Row icon="key" tone={TONE.yellow} label="Sign-in and security" chevron onPress={go('/account/security')} />
          {due ? (
            <Row icon="trash" tone={TONE.red} label={`Deleted on ${day(due)}`} right={<Pill label="Keep my account" size="small" onPress={() => void keepAccount().then((m) => m && Alert.alert(m))} />} />
          ) : (
            <Row icon="trash" tone={TONE.red} label="Delete account" chevron onPress={go('/account/delete')} />
          )}
        </Group>
      )}

      <Group title="Help">
        <Row icon="help" tone={TONE.blue} label="Help and support" chevron onPress={go('/account/help')} />
        {/* One Legal row in place of a row per page (owner, 19 Nov 2026: "add Legal Modal instead of many"). */}
        <Row icon="terms" tone={TONE.cyan} label="Legal" chevron onPress={go('/legal')} />
      </Group>

      {viewer.signedIn && (
        <View style={styles.logOut}>
          <Pill label="Log out" size="wide" onPress={logOut} />
        </View>
      )}
      {/* The ORBIT wordmark at the foot of the page, over the version (owner, 15 Nov 2026: "at the bottom add orbit
          logo"). */}
      <View style={styles.foot}>
        <Wordmark width={120} />
        <Text style={styles.version}>Version {Constants.expoConfig?.version}</Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  ad: { marginTop: space.big },
  head: { marginHorizontal: 20, alignItems: 'center' },
  name: { marginTop: space.small + 4, fontFamily: font.headline, fontSize: 22, lineHeight: 28, color: color.text },
  headButtons: { marginTop: space.small + 4, flexDirection: 'row', gap: space.small },
  logOut: { marginTop: space.big },
  foot: { marginTop: 40, alignItems: 'center', gap: space.small },
  version: { fontFamily: font.text, fontSize: 12, color: color.secondary },
});
