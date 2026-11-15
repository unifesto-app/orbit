// The host page (Discover flow doc, Host page; defaults accepted 15 Nov 2026), from host cards on Home, host results
// on Search and the event page. Who they are, Follow, About, then every upcoming event and the latest past ones. The
// 4:3 banner, when there is one, runs full width like Home's carousel (owner, 15 Nov 2026: "apply 4:3/ 3:4 poster
// full", "same like home page carousel"), with the 1:1 logo seated on its bottom edge, as Home's host cards seat it on
// their top rim. Without one, the host's colour glows from the top and the logo leads.
// Not here yet: clubs under a college and "Part of [college]".
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { followersLine, hostEvents } from '../../detail';
import { Glass } from '../../glass';
import { Carousel } from '../../home/Carousel';
import { events, hosts, now } from '../../mock';
import { BackBar, EventRow, Glow, MenuButton, Monogram, NotFound, Section, shareLink, Tag, TOP, Verified } from '../../rows';
import { needsAccount, setFollowing, useFollowing } from '../../session';
import { around, color, font, radius, rim, space } from '../../theme';

const LOGO = 80;

export default function HostPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const [scrollY] = useState(() => new Animated.Value(0));
  const host = hosts.find((h) => h.id === slug);
  const following = useFollowing(slug); // signed out, nobody is followed (src/session.ts)
  if (!host) return <NotFound what="host" />;

  const { upcoming, past } = hostEvents(host.id, events, now);
  const followers = followersLine(host.followers);

  return (
    <View style={styles.screen}>
      {!host.banner && <Glow tint={host.bg} />}
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        // Clear of the home indicator; pushed over the tabs, so no tab bar here.
        contentContainerStyle={{
          paddingTop: host.banner ? 0 : insets.top + TOP,
          paddingBottom: (Platform.OS === 'ios' ? insets.bottom : 0) + space.big,
        }}>
        {/* From the top of the screen, under the status bar and the back button. */}
        {host.banner && (
          <Carousel
            top={0}
            extend={false}
            slides={[{ key: host.id, image: host.banner.source, edge: host.banner.edge, label: `Banner for ${host.name}` }]}
          />
        )}
        <View style={styles.head}>
          {/* Half over the banner's bottom edge, in a thin frosted rim (logo 6 + rim 2). */}
          <Glass style={[styles.logoRim, host.banner && styles.seated]}>
            <Monogram mark={host} size={LOGO} />
          </Glass>
          {/* A verified host's tick sits beside the name; an unverified host keeps its tag below. */}
          <View style={styles.nameRow}>
            <Text style={styles.name} accessibilityRole="header">
              {host.name}
            </Text>
            {host.verified && <Verified size={22} />}
          </View>
          <Text style={styles.meta}>
            {host.kind} · {host.area}
          </Text>
          <View style={styles.badges}>
            {!host.verified && <Tag text="Unverified" />}
            {followers && <Text style={styles.meta}>{followers}</Text>}
          </View>
          {/* Signed out, it asks to sign in first, then follows. */}
          <Pressable onPress={() => needsAccount(() => setFollowing(host.id, !following))} accessibilityRole="button">
            <Glass style={styles.follow}>
              <Text style={[styles.followText, following && styles.followingText]}>{following ? 'Following' : 'Follow'}</Text>
            </Glass>
          </Pressable>
        </View>

        <Section title="About" />
        <Text style={styles.prose}>{host.bio}</Text>

        {/* Every upcoming event, soonest first; an empty list says so plainly (Discover doc). */}
        <Section title="Coming up" />
        {upcoming.length > 0 ? (
          upcoming.map((e) => <EventRow key={e.id} event={e} host={host} />)
        ) : (
          <Text style={styles.prose}>No upcoming events</Text>
        )}

        {past.length > 0 && (
          <>
            <Section title="Past events" />
            {past.map((e) => (
              <EventRow key={e.id} event={e} host={host} past />
            ))}
          </>
        )}
      </Animated.ScrollView>
      {/* The menu (Discover doc: Share, Copy link and Report). No Save: a host is followed. Copy link and Report aren't
          built yet. */}
      <BackBar scrollY={scrollY}>
        <MenuButton
          actions={[
            { label: 'Share', icon: 'share', onPress: () => shareLink(`${host.name} on Orbit`, `/host/${host.id}`) },
            { label: 'Copy link', icon: 'link' },
            { label: 'Report', icon: 'report' },
          ]}
        />
      </BackBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  head: { marginHorizontal: 20, alignItems: 'center' },
  logoRim: { padding: rim, borderRadius: around(radius.md, rim) },
  seated: { marginTop: -(LOGO / 2 + rim) },
  nameRow: { marginTop: space.small, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  name: { flexShrink: 1, fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text, textAlign: 'center' },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary, textAlign: 'center' },
  badges: { marginTop: space.small, flexDirection: 'row', alignItems: 'center', gap: space.small },
  // Wider than the cards' Follow, at View ticket's size (owner: fully round, "even follow and following").
  follow: { marginTop: space.big, height: 44, paddingHorizontal: 32, borderRadius: 22, justifyContent: 'center' },
  followText: { fontFamily: font.title, fontSize: 15, color: color.text },
  followingText: { color: color.secondary },
  prose: { marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
});
