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
//   took the Hosting group out; the mode sheet's "Become a host" opens it now.
// Cards hold text only. Log out confirms first; Delete account opens its own screen with what goes and what blocks it.
import Constants from 'expo-constants';
import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Animated, Linking, StyleSheet, Text, View } from 'react-native';

import { methods, passkeys, past, refunds } from '../../account/data';
import { Group, Page, Panel, Pill, REVEAL, Row } from '../../account/kit';
import { ProfileHead } from '../../account/profile';
import { isOpen } from '../../account/rules';
import { usePlace } from '../../place';
import { needsAccount, signOut, useSession, useViewer } from '../../session';
import { color, font, space } from '../../theme';
import { Wordmark } from '../../wordmark';

const WWW = 'https://www.unifesto.app'; // the legal pages, as the web's footer links them
const go = (href: Href) => () => router.push(href);
// Each row's icon in its own colour (owner, 15 Nov 2026: "should have various acents"): Search's Explore colours, Open
// Color shades plus the brand blue, no two alike within a card. The icon only: labels stay white.
const TONE = {
  orange: '#E8590C',
  pink: '#D6336C',
  violet: '#7048E8',
  cyan: '#1098AD',
  green: '#2F9E44',
  yellow: '#FCC419',
  mint: '#099268',
  red: '#E03131',
  blue: color.accent,
  grape: '#AE3EC9',
} as const;

export default function Account() {
  const viewer = useViewer(); // signed in or out on this phone (src/session.ts)
  const saved = useSession()?.saved ?? [];
  const place = usePlace(viewer.place);
  const open = refunds.filter((r) => isOpen(r.status)).length;
  const logOut = () =>
    Alert.alert('Log out of Orbit?', 'You’ll sign back in on this phone with a code or your passkey.', [
      { text: 'Cancel', style: 'cancel' },
      // Back to Home signed out. ponytail: the API's session ends here too once it exists.
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          signOut();
          router.dismissTo('/');
        },
      },
    ]);

  // The panel grows toward your profile as you pull (owner, 15 Nov 2026: "drag transition is needed", "not just simple
  // pull", then picked "Panel grows into profile"; 16 Nov: "the profile should be a seperate screen"). Pulled past its
  // top, the page brings the panel down with the finger while its glass stretches above, and the head moves up half as
  // far, so it stays centred in the taller panel as it grows (`grow`, full at REVEAL). Let go past PULL, or tap the
  // chevrons, and the profile screen fades in over it, its top the panel fully grown; short of that, the panel shrinks
  // back with the bounce.
  // ponytail: the drag reads iOS's bounce, so on Android the tap is the way in.
  const [scrollY] = useState(() => new Animated.Value(0)); // negative while the page is pulled past its top
  const [{ grow, centre }] = useState(() => ({
    grow: scrollY.interpolate({ inputRange: [-REVEAL, 0], outputRange: [1, 0], extrapolate: 'clamp' }),
    centre: scrollY.interpolate({ inputRange: [-4 * REVEAL, 0], outputRange: [-2 * REVEAL, 0], extrapolate: 'clamp' }),
  }));
  const openProfile = go('/account/profile');

  return (
    <Page onPull={viewer.signedIn ? openProfile : undefined} scrollY={scrollY}>
      <Panel>
        {viewer.signedIn ? (
          <Animated.View style={{ transform: [{ translateY: centre }] }}>
            <ProfileHead p={grow} onChevrons={openProfile} />
          </Animated.View>
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
            <Row icon="ticket" tone={TONE.orange} label="Tickets" value={`${viewer.tickets?.length ?? 0} upcoming`} onPress={go('/account/tickets')} />
            <Row icon="heart" tone={TONE.pink} label="Saved" value={`${saved.length}`} onPress={go('/account/saved')} />
            <Row icon="following" tone={TONE.violet} label="Following" value={`${viewer.follows.length} hosts`} onPress={go('/account/following')} />
            <Row icon="history" tone={TONE.cyan} label="History" value={`${past.length}`} onPress={go('/account/history')} />
          </Group>

          <Group title="Money">
            <Row icon="receipt" tone={TONE.green} label="Transactions" onPress={go('/account/transactions')} />
            <Row icon="refund" tone={TONE.yellow} label="Refunds" value={open ? `${open} open` : undefined} onPress={go('/account/refunds')} />
            <Row icon="card" tone={TONE.mint} label="Payment methods" onPress={go('/account/payment')} />
          </Group>
        </>
      )}

      <Group title="Settings">
        {viewer.signedIn && <Row icon="bell" tone={TONE.red} label="Notifications" onPress={go('/account/notifications')} />}
        <Row icon="pin" tone={TONE.blue} label="Location" value={place?.area ?? 'Not set'} onPress={go('/location')} />
        <Row icon="moon" tone={TONE.grape} label="Appearance" value="Dark" onPress={go('/account/appearance')} />
        <Row icon="shield" tone={TONE.green} label="Permissions" onPress={go('/account/permissions')} />
      </Group>

      {/* No Hosting group (owner, 16 Nov 2026: "even remove the hosting"): starting a host is the mode sheet's
          "Become a host", which opens Host on Orbit (src/app/account/host.tsx); a host's team uses the Console. */}
      {viewer.signedIn && (
        <Group title="Account">
          <Row icon="key" tone={TONE.yellow} label="Sign-in and security" value={`${methods.length + passkeys.length} ways in`} onPress={go('/account/security')} />
          <Row icon="trash" tone={TONE.red} label="Delete account" onPress={go('/account/delete')} />
        </Group>
      )}

      <Group title="Help">
        <Row icon="help" tone={TONE.blue} label="Help and support" onPress={go('/account/help')} />
        <Row icon="terms" tone={TONE.cyan} label="Terms of service" onPress={() => Linking.openURL(`${WWW}/terms`)} />
        <Row icon="privacy" tone={TONE.violet} label="Privacy policy" onPress={() => Linking.openURL(`${WWW}/privacy`)} />
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
  head: { marginHorizontal: 20, alignItems: 'center' },
  name: { marginTop: space.small + 4, fontFamily: font.headline, fontSize: 22, lineHeight: 28, color: color.text },
  headButtons: { marginTop: space.small + 4, flexDirection: 'row', gap: space.small },
  logOut: { marginTop: space.big },
  foot: { marginTop: 40, alignItems: 'center', gap: space.small },
  version: { fontFamily: font.text, fontSize: 12, color: color.secondary },
});
