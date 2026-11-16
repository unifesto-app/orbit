// The host page (Discover flow doc, Host page; defaults accepted 15 Nov 2026), from host cards on Home, host results
// on Search and the event page. Who they are, Follow, About, then every upcoming event and the latest past ones. The
// 4:3 banner, when there is one, runs full width like Home's carousel (owner, 15 Nov 2026: "apply 4:3/ 3:4 poster
// full", "same like home page carousel"), with the 1:1 logo seated on its bottom edge, as Home's host cards seat it on
// their top rim. Without one, the host's colour glows from the top and the logo leads.
// A host on the API (any link that isn't a mock host's) reads GET /public/hosts/:slug, with "Part of [college]" and its
// clubs; its events come with the API's events, so it says "No upcoming events" until then.
// ponytail: real logos and banners wait for uploads, so a real host draws as its monogram over its colour's glow.
import type { PublicHost } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { followersLine, hostEvents } from '../../detail';
import { Glass } from '../../glass';
import { Carousel } from '../../home/Carousel';
import { hostsApi, kindLabel, markOf } from '../../hosts';
import { useLoad } from '../../load';
import { type Host, events, hosts, now } from '../../mock';
import { BackBar, EventRow, Failed, Glow, MenuButton, Monogram, NotFound, Section, shareLink, Tag, TOP, Verified, Waiting } from '../../rows';
import { api, needsAccount, setFollowing, useFollowing, useMe, useSignedIn } from '../../session';
import { around, color, font, radius, rim, space } from '../../theme';

const LOGO = 80;

export default function HostPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const host = hosts.find((h) => h.id === slug);
  return host ? <MockHost host={host} /> : <LiveHost slug={slug} />;
}

function MockHost({ host }: { host: Host }) {
  const insets = useSafeAreaInsets();
  const [scrollY] = useState(() => new Animated.Value(0));
  const following = useFollowing(host.id); // signed out, nobody is followed (src/session.ts)

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

// A host from the API. Signed in, the answer says whether you follow it; a tap follows at once and the page reads
// again once the API has it.
function LiveHost({ slug }: { slug: string }) {
  const insets = useSafeAreaInsets();
  const [scrollY] = useState(() => new Animated.Value(0));
  const signedIn = useSignedIn();
  const me = useMe();
  const page = useLoad(`${slug}|${me.id}`, () => hostsApi(api).publicHost(slug, signedIn));
  // Your tap, shown until the next answer replaces the one it was made on.
  const [mine, setMine] = useState<{ of: PublicHost; on: boolean } | null>(null);
  if (page.loading) return <Waiting />;
  if (page.status === 404) return <NotFound what="host" />;
  if (!page.data) return <Failed message={page.error!.message} retry={page.reload} />;

  const h = page.data;
  const mark = markOf(h);
  const following = mine?.of === h ? mine.on : !!h.following;
  const followers = h.followers === null ? null : followersLine(h.followers);
  const follow = () =>
    needsAccount(async () => {
      const on = !following;
      setMine({ of: h, on });
      const r = await hostsApi(api).follow(h.id, on);
      if (!r.ok) {
        setMine(null);
        Alert.alert(on ? 'Couldn’t follow' : 'Couldn’t unfollow', r.error.message);
      }
      page.reload();
    });

  return (
    <View style={styles.screen}>
      <Glow tint={mark.bg} />
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        contentContainerStyle={{ paddingTop: insets.top + TOP, paddingBottom: (Platform.OS === 'ios' ? insets.bottom : 0) + space.big }}>
        <View style={styles.head}>
          <Glass style={styles.logoRim}>
            <Monogram mark={mark} size={LOGO} />
          </Glass>
          <View style={styles.nameRow}>
            <Text style={styles.name} accessibilityRole="header">
              {h.name}
            </Text>
            {h.verified && <Verified size={22} />}
          </View>
          <Text style={styles.meta}>
            {kindLabel(h.kind)} · {h.city}
          </Text>
          {/* A club names the host it's part of, such as its college (Discover doc). */}
          {h.parent && (
            <Pressable onPress={() => router.push(`/host/${h.parent!.slug}`)} accessibilityRole="link">
              <Text style={[styles.meta, styles.partOf]}>Part of {h.parent.name}</Text>
            </Pressable>
          )}
          <View style={styles.badges}>
            {!h.verified && <Tag text="Unverified" />}
            {followers && <Text style={styles.meta}>{followers}</Text>}
          </View>
          <Pressable onPress={follow} accessibilityRole="button">
            <Glass style={styles.follow}>
              <Text style={[styles.followText, following && styles.followingText]}>{following ? 'Following' : 'Follow'}</Text>
            </Glass>
          </Pressable>
        </View>

        {h.about && (
          <>
            <Section title="About" />
            <Text style={styles.prose}>{h.about}</Text>
          </>
        )}

        <Section title="Coming up" />
        <Text style={styles.prose}>No upcoming events</Text>

        {h.clubs.length > 0 && (
          <>
            <Section title="Clubs" />
            {h.clubs.map((club) => (
              <Pressable
                key={club.slug}
                onPress={() => router.push(`/host/${club.slug}`)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.club, pressed && styles.pressed]}>
                {/* ponytail: the API names a club by slug only, so its colour here can differ from its own page's. */}
                <Monogram mark={markOf({ id: club.slug, name: club.name })} size={48} />
                <Text style={styles.clubName} numberOfLines={1}>
                  {club.name}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </Animated.ScrollView>
      <BackBar scrollY={scrollY}>
        <MenuButton
          actions={[
            { label: 'Share', icon: 'share', onPress: () => shareLink(`${h.name} on Orbit`, `/host/${h.slug}`) },
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
  partOf: { marginTop: 2, color: color.text },
  club: { marginHorizontal: 20, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  clubName: { flex: 1, fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  pressed: { opacity: 0.7 },
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
