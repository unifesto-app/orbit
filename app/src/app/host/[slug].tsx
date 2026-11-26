// The host page (Discover flow doc, Host page; defaults accepted 15 Nov 2026), from host cards on Home, host results
// on Search and the event page. Who they are, Follow, About, then every upcoming event and the latest past ones. The
// 4:3 banner, when there is one, runs full width like Home's carousel (owner, 15 Nov 2026: "apply 4:3/ 3:4 poster
// full", "same like home page carousel"), with the 1:1 logo seated on its bottom edge, as Home's host cards seat it on
// their top rim. Without one, the host's colour glows from the top and the logo leads.
// Redrawn 19 Nov 2026 in the event page's language (owner approved Take 2 of the detail pages mockup,
// https://claude.ai/artifact/5dDmrmZ6soDjoe8kro1xAq): the back and menu circles and the Book a slot pill on the tab
// bar's dark glass with nothing behind the bar, a left-aligned head (the logo seated at the left), Home's Clean rows
// without their host line, Orbit's bubble when nothing's coming up, sections 40 apart.
// Every host reads the API first: only a 404 on a mock host's id (a place to play, or one the mock's tickets and history
// link to) draws the mock page, so a real host can never be taken for a mock one. It reads GET /public/hosts/:slug, with "Part of [college]" and its
// clubs, and its events from GET /public/hosts/:slug/events (upcoming, then the latest past), in the same rows.
// ponytail: real logos and banners wait for uploads, so a real host draws as its monogram over its colour's glow.
// ponytail: the mock page goes with the mock (places to play: slots, P17).
import { formatPrice, type PublicHost } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookBar } from '../../bookBar';
import { followersLine, hostEvents } from '../../detail';
import { Fact, FactCard } from '../../fact';
import { DARK_TINT, Glass } from '../../glass';
import { Carousel } from '../../home/Carousel';
import { eventsApi, type Host, toEvent, toHost } from '../../events';
import { hostsApi, kindLabel, markOf } from '../../hosts';
import { Icon } from '../../icons';
import { countLine, fromPricePaise, perHour, startsLine, type Venue, venues } from '../../kinds';
import { useLoad } from '../../load';
import { timeLabel } from '../../booking';
import { slotsApi, venueBar } from '../../slots';
import { past as history } from '../../account/data';
import { events, hosts, now } from '../../mock';
import { OrbitSays } from '../../orbitSays';
import { showNote } from '../../note';
import { offerPush, PushAsk } from '../../push';
import { BackBar, copyLink, EventRow, Failed, Glow, MenuButton, Monogram, NotFound, reportIt, SECTION, Section, shareLink, Tag, TOP, Verified, Waiting } from '../../rows';
import { api, followedHere, needsAccount, setFollowing, setHostOff, useFollowing, useHostOff, useMe, useSignedIn } from '../../session';
import { around, color, font, radius, rim, space } from '../../theme';

const LOGO = 80;

export default function HostPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <LiveHost slug={slug} />;
}

function MockHost({ host }: { host: Host }) {
  const insets = useSafeAreaInsets();
  const following = useFollowing(host.id); // signed out, nobody is followed (src/session.ts)

  const signedIn = useSignedIn();
  const { upcoming, past } = hostEvents(host.id, events, now);
  const followers = followersLine(host.followers);
  const went = (id: string) => signedIn && history.some((h) => h.eventId === id && h.status === 'Went');
  // A place to play (Play: a Venue host with stations) adds what you can book, its hours, and the Book a slot bar.
  const venue = venues[host.id];
  const [bar, setBar] = useState(insets.bottom + 108); // room for the bar, a guess until measured

  return (
    <View style={styles.screen}>
      {!host.banner && <Glow tint={host.bg} />}
      <ScrollView
        showsVerticalScrollIndicator={false}
        // Clear of the home indicator; pushed over the tabs, so no tab bar here.
        contentContainerStyle={{
          paddingTop: host.banner ? 0 : insets.top + TOP,
          paddingBottom: venue ? bar : (Platform.OS === 'ios' ? insets.bottom : 0) + space.big,
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
          {/* A verified host's tick sits beside the name; an unverified host keeps its tag below. Kind, area and
              followers on one line. */}
          <View style={styles.nameRow}>
            <Text style={styles.name} accessibilityRole="header">
              {host.name}
            </Text>
            {host.verified && <Verified size={20} />}
          </View>
          <Text style={styles.meta}>{[host.kind, host.area, followers].filter(Boolean).join(' · ')}</Text>
          {!host.verified && (
            <View style={styles.badges}>
              <Tag text="Unverified" />
            </View>
          )}
          {/* Signed out, it asks to sign in first, then follows. */}
          <View style={styles.followRow}>
            <Pressable
              onPress={() =>
                needsAccount(() => {
                  setFollowing(host.id, !following);
                  if (!following) void offerPush(`follow:${host.id}`); // a first follow may ask for push (src/push.tsx)
                })
              }
              accessibilityRole="button">
              <Glass style={styles.follow}>
                <Text style={[styles.followText, following && styles.followingText]}>{following ? 'Following' : 'Follow'}</Text>
              </Glass>
            </Pressable>
            {following && <NewEvents hostId={host.id} name={host.name} />}
          </View>
        </View>

        {following && <PushAsk moment={`follow:${host.id}`} line={`Hear when ${host.name} posts their next event?`} top={SECTION} />}

        <Section top={SECTION} title="About" />
        <Text style={styles.prose}>{host.bio}</Text>

        {venue && <VenueFacts venue={venue} />}

        {/* Every upcoming event, soonest first, as Home's Clean rows without their host line; an empty list says so,
            in Orbit's bubble (Discover doc). */}
        <Section top={SECTION} title="Coming up" />
        {upcoming.length > 0 ? (
          upcoming.map((e) => <EventRow key={e.id} event={e} host={host} found kicker={false} />)
        ) : (
          <NothingYet name={host.name} following={following} />
        )}

        {past.length > 0 && (
          <>
            <Section top={SECTION} title="Past events" />
            {past.map((e) => (
              <EventRow key={e.id} event={e} host={host} found kicker={false} past went={went(e.id)} />
            ))}
          </>
        )}
      </ScrollView>
      {/* Book a slot over "Starting from", the cheapest hour (Play doc): the slot picker (src/app/slot/[venue].tsx), after
          signing in when signed out. */}
      {venue && (
        <BookBar
          dark
          price={perHour(fromPricePaise(venue))}
          from
          action="Book a slot"
          onAction={() => needsAccount(() => router.push(`/slot/${host.id}`))}
          onHeight={setBar}
        />
      )}
      {/* The menu (Discover doc: Share, Copy link and Report). No Save: a host is followed. A mock host has no Report:
          the API doesn't know it (X15). */}
      <BackBar dark>
        <MenuButton
          tint={DARK_TINT}
          actions={[
            { label: 'Share', icon: 'share', onPress: () => shareLink(`${host.name} on Orbit`, `/host/${host.slug}`) },
            { label: 'Copy link', icon: 'link', onPress: () => void copyLink(`/host/${host.slug}`) },
          ]}
        />
      </BackBar>
    </View>
  );
}

// What a place to play has (Play 7, 8, 19): each kind of station in its own card, how many, the hour's price, its one
// off-peak window, a co-op price and the games where there are any; then how a booking starts, the hours and the address.
// A card, so text only.
function VenueFacts({ venue }: { venue: Venue }) {
  return (
    <>
      <Section top={SECTION} title="Book by the hour" />
      <View style={styles.stations}>
        {venue.stations.map((s) => (
          <FactCard key={s.name}>
            <Fact label={countLine(s)} value={s.name} note={s.note} />
            <Fact
              label="An hour"
              value={formatPrice(s.pricePaise)}
              note={s.offPeak && `${formatPrice(s.offPeak.pricePaise)} ${s.offPeak.when}`}
            />
            {s.coopPaise && <Fact label="Two playing" value={`${formatPrice(s.coopPaise)} an hour`} />}
            {s.games && <Fact label="Games" value={s.games} />}
          </FactCard>
        ))}
      </View>
      <Text style={[styles.prose, styles.rule]}>{startsLine(venue)}</Text>
      <Section top={SECTION} title="Hours and place" />
      <FactCard>
        <Fact label="Open" value={venue.hours} />
        <Fact label="Where" value={venue.address} />
      </FactCard>
    </>
  );
}

// A host from the API. Signed in, the answer says whether you follow it; a tap follows at once and the page reads
// again once the API has it.
function LiveHost({ slug }: { slug: string }) {
  const insets = useSafeAreaInsets();
  const signedIn = useSignedIn();
  const me = useMe();
  const now = Date.now();
  const page = useLoad(`${slug}|${me.id}`, () => hostsApi(api).publicHost(slug, signedIn));
  const list = useLoad(`events|${slug}`, () => eventsApi(api).hostEvents(slug));
  // Your tap, shown until the next answer replaces the one it was made on.
  const [mine, setMine] = useState<{ of: PublicHost; on: boolean } | null>(null);
  // A real place to play (a Venue host) gets the Book a slot bar from today's free slots (X8): the cheapest hour and the
  // next start with room. A venue not set up or not live answers 404: no bar.
  const venueId = page.data?.kind === 'venue' ? page.data.id : null;
  const slots = useLoad(venueId && `slots|${venueId}`, () => slotsApi(api).publicSlots(venueId!));
  const [bar, setBar] = useState(insets.bottom + 108); // room for the bar, a guess until measured
  if (page.loading) return <Waiting />;
  if (page.status === 404) {
    const mock = hosts.find((h) => h.id === slug);
    return mock ? <MockHost host={mock} /> : <NotFound what="host" />;
  }
  if (!page.data) return <Failed message={page.error!.message} retry={page.reload} />;

  const h = page.data;
  const mark = markOf(h);
  const book = slots.data && venueBar(slots.data);
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
      } else {
        followedHere(h.id, on); // Home reads the session's list
        if (on) void offerPush(`follow:${h.id}`);
      }
      page.reload();
    });

  return (
    <View style={styles.screen}>
      <Glow tint={mark.bg} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + TOP, paddingBottom: book ? bar : (Platform.OS === 'ios' ? insets.bottom : 0) + space.big }}>
        <View style={styles.head}>
          <Glass style={styles.logoRim}>
            <Monogram mark={mark} size={LOGO} />
          </Glass>
          <View style={styles.nameRow}>
            <Text style={styles.name} accessibilityRole="header">
              {h.name}
            </Text>
            {h.verified && <Verified size={20} />}
          </View>
          <Text style={styles.meta}>{[kindLabel(h.kind), h.city, followers].filter(Boolean).join(' · ')}</Text>
          {/* A club names the host it's part of, such as its college (Discover doc). */}
          {h.parent && (
            <Pressable onPress={() => router.push(`/host/${h.parent!.slug}`)} accessibilityRole="link">
              <Text style={[styles.meta, styles.partOf]}>Part of {h.parent.name}</Text>
            </Pressable>
          )}
          {!h.verified && (
            <View style={styles.badges}>
              <Tag text="Unverified" />
            </View>
          )}
          <View style={styles.followRow}>
            <Pressable onPress={follow} accessibilityRole="button">
              <Glass style={styles.follow}>
                <Text style={[styles.followText, following && styles.followingText]}>{following ? 'Following' : 'Follow'}</Text>
              </Glass>
            </Pressable>
            {following && <NewEvents hostId={h.id} name={h.name} />}
          </View>
        </View>

        {following && <PushAsk moment={`follow:${h.id}`} line={`Hear when ${h.name} posts their next event?`} top={SECTION} />}

        {h.about && (
          <>
            <Section top={SECTION} title="About" />
            <Text style={styles.prose}>{h.about}</Text>
          </>
        )}

        <Section top={SECTION} title="Coming up" />
        {!list.data ? (
          list.loading || !list.error ? <Waiting /> : <Failed message={list.error.message} retry={list.reload} />
        ) : list.data.upcoming.length > 0 ? (
          list.data.upcoming.map((c) => <EventRow key={c.id} event={toEvent(c)} host={toHost(c.host)} now={now} found kicker={false} />)
        ) : (
          <NothingYet name={h.name} following={following} />
        )}

        {list.data && list.data.past.length > 0 && (
          <>
            <Section top={SECTION} title="Past events" />
            {list.data.past.map((c) => (
              <EventRow key={c.id} event={toEvent(c)} host={toHost(c.host)} now={now} found kicker={false} past />
            ))}
          </>
        )}

        {h.clubs.length > 0 && (
          <>
            <Section top={SECTION} title="Clubs" />
            {h.clubs.map((club) => (
              <Pressable
                key={club.slug}
                onPress={() => router.push(`/host/${club.slug}`)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.club, pressed && styles.pressed]}>
                {/* ponytail: the API names a club by slug only, so its colour here can differ from its own page's. */}
                <Monogram mark={markOf({ id: club.slug, name: club.name })} size={44} />
                <Text style={styles.clubName} numberOfLines={1}>
                  {club.name}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
      {book && (
        <BookBar
          dark
          price={perHour(book.fromPaise)}
          from
          note={book.next !== null ? `Next free ${timeLabel(book.next)}` : 'Nothing free today'}
          action="Book a slot"
          onAction={() => needsAccount(() => router.push({ pathname: '/slot/[venue]', params: { venue: h.id, name: h.name } }))}
          onHeight={setBar}
        />
      )}
      <BackBar dark>
        <MenuButton
          tint={DARK_TINT}
          actions={[
            { label: 'Share', icon: 'share', onPress: () => shareLink(`${h.name} on Orbit`, `/host/${h.slug}`) },
            { label: 'Copy link', icon: 'link', onPress: () => void copyLink(`/host/${h.slug}`) },
            { label: 'Report', icon: 'report', onPress: () => reportIt('host', h.id, h.name) },
          ]}
        />
      </BackBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  partOf: { marginTop: 2, color: color.text },
  club: { marginHorizontal: 20, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  clubName: { flex: 1, fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  pressed: { opacity: 0.7 },
  // Left, like the event page's head (Take 2, 19 Nov 2026; it was centred).
  head: { marginHorizontal: 20, alignItems: 'flex-start' },
  logoRim: { padding: rim, borderRadius: around(radius.md, rim) },
  seated: { marginTop: -(LOGO / 2 + rim) },
  nameRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The event title's size.
  name: { flexShrink: 1, fontFamily: font.headline, fontSize: 26, lineHeight: 32, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  badges: { marginTop: space.small, flexDirection: 'row', alignItems: 'center', gap: space.small },
  // Wider than the cards' Follow, at View ticket's size (owner: fully round, "even follow and following").
  follow: { height: 44, paddingHorizontal: 32, borderRadius: 22, justifyContent: 'center' },
  followText: { fontFamily: font.title, fontSize: 15, color: color.text },
  followingText: { color: color.secondary },
  followRow: { marginTop: 16, flexDirection: 'row', gap: space.small },
  newEvents: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  prose: { marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  stations: { gap: space.big }, // a big gap between cards
  rule: { marginTop: space.small, fontSize: 13, lineHeight: 18 },
});

// Nothing coming up, said by Orbit in its bubble as Home's and Search's empty states are, with what Follow does.
function NothingYet({ name, following }: { name: string; following: boolean }) {
  return (
    <OrbitSays
      top={0}
      text={
        following
          ? `Nothing coming up from ${name} yet. You’ll hear when they post one.`
          : `Nothing coming up from ${name} yet. Follow them, and their next event lands on your Home.`
      }
    />
  );
}

// All or Off for a host you follow (Notifications doc, decision 3), a bell beside Following: All by default; Off stops
// the push and the email about its new events, which still reach your inbox. A tap switches; a note says what changed.
function NewEvents({ hostId, name }: { hostId: string; name: string }) {
  const off = useHostOff(hostId);
  const flip = () => {
    setHostOff(hostId, !off);
    showNote({ text: off ? `You’ll hear when ${name} posts an event` : `${name}’s new events will go to your inbox only` });
  };
  return (
    <Pressable onPress={flip} accessibilityRole="switch" accessibilityState={{ checked: !off }} accessibilityLabel={`Alerts for new events from ${name}`}>
      <Glass style={styles.newEvents}>
        <Icon name="bell" size={20} color={off ? color.secondary : color.text} />
      </Glass>
    </Pressable>
  );
}
