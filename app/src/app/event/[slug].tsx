// The event page (Discover flow doc, Event page; defaults accepted 15 Nov 2026), from any event row or card and the
// Home carousel. One column: the poster, the status, title and host; when and where; About; the people, a group per
// role; and last the host with Follow. Tickets are a bar pinned to the bottom ("In the app this is a bar pinned to the
// bottom"). No icons in its cards.
// The poster runs full width like Home's carousel (owner, 15 Nov 2026: "apply 4:3/ 3:4 poster full", "same like home
// page carousel"), from the very top of the screen ("remove the poster top blur, instead start poster from top"): the
// 4:3 poster when the event has one, else the 3:4.
// Each kind adds its own sections (src/kindSections.tsx). Not here yet: picking a ticket type and quantity.
import { categories, formatPrice } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { past as history, ticketFor } from '../../account/data';
import { barPrice, cast } from '../../detail';
import { BookBar } from '../../bookBar';
import { Fact } from '../../fact';
import { Glass } from '../../glass';
import { KindSections, WithActs } from '../../kindSections';
import { Carousel } from '../../home/Carousel';
import { type Event, events, hosts, interestedBase, now, people, type Person, vibes } from '../../mock';
import { BackBar, FaceWash, LoveButton, MenuButton, Monogram, NotFound, SaveButton, Section, shareLink, StatusDot, Tag, Verified } from '../../rows';
import { bookAction, eventStatus, seatsLine } from '../../status';
import { addToList, needsAccount, setFollowing, setInterested, useInterested, useSaved, useViewer } from '../../session';
import { around, color, font, radius, rim, space } from '../../theme';

// This page's cards have more room than the app's usual 8 (owner, 15 Nov 2026: "add padding for card in event"), and
// their corners still nest outward from their contents' (a 6px corner and 12px padding make the face 18, the frosted
// rim 20). The When and where card glows very faintly from the bottom centre in the poster's own colour ("add very
// less tint too", then "radial gradiant tint, should be based on event banner"), as Search's Explore boxes glow in
// theirs; Hosted by stays plain ("dont apply for hosted by card").
const CARD_PAD = 12;
const FACE = around(radius.sm, CARD_PAD);
const RIM = around(FACE, rim);
// The When and where card and the FAQ and terms card have more room still (owner, 15 Nov 2026: "add proper spacing and
// padding to when & where card and faq &terms card"): 16 inside and 16 between their rows, so each block reads on its
// own; their corners nest the same way (6 + 16 = 22, rim 24).
const INFO_PAD = 16;
const INFO_FACE = around(radius.sm, INFO_PAD);
const INFO_RIM = around(INFO_FACE, rim);
const GLOW = 0.2; // the glow's strength at its centre; Explore's is 0.75
const HOST_RIM = 1; // the Hosted by card's rim
const PHOTO = 48; // a person's 1:1 photo in their row


export default function EventPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const [scrollY] = useState(() => new Animated.Value(0));
  const [bar, setBar] = useState(insets.bottom + 108); // room under the page for the ticket bar, a guess until measured
  const e = events.find((x) => x.id === slug);
  const host = e && hosts.find((h) => h.id === e.hostId);
  const viewer = useViewer(); // signed out, no tickets and no follows (src/session.ts)
  const saved = useSaved(e?.id ?? '');
  if (!e || !host) return <NotFound what="event" />;

  const past = Date.parse(e.startsAt) < now;
  const status = eventStatus(e, now); // the line at the top (src/status.ts)
  const booked = viewer.signedIn && !!viewer.tickets?.some((t) => t.eventId === e.id);
  const went = viewer.signedIn && history.some((h) => h.eventId === e.id && h.status === 'Went');
  const book = bookAction(status, !e.pricePaise);
  // The ticket bar: a ticket holder keeps View ticket until the event has ended, while it's on and if it's cancelled;
  // anyone else sees it until the start, never on a cancelled event.
  const showBar = booked ? status.kind !== 'ended' : !past && status.kind !== 'cancelled';
  const following = viewer.signedIn && viewer.follows.includes(host.id);
  const openHost = () => router.push(`/host/${host.id}`);
  const price = barPrice(e);
  const tint = <FaceWash tint={e.tone} opacity={GLOW} corner={INFO_FACE} />;

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        contentContainerStyle={{ paddingBottom: showBar ? bar : insets.bottom + space.big }}>
        {/* From the top of the screen, under the status bar and the back button. */}
        <Carousel
          top={0}
          extend={false}
          ratio={e.wide ? '4:3' : '3:4'}
          slides={[{ key: e.id, image: (e.wide ?? e.poster).source, edge: e.wide?.edge ?? host.bg, label: `Poster for ${e.title}` }]}
        />
        <View style={styles.head}>
          <View style={styles.status}>
            <StatusDot tone={status.tone} />
            <Text style={styles.statusText}>{status.label}</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {e.title}
          </Text>
          <Pressable onPress={openHost} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.by}>by {host.name}</Text>
          </Pressable>
          <WithActs eventId={e.id} />
        </View>

        {/* When and where: a card, so text and a pill only. Times are India time (the event's own zone). */}
        <Glass style={styles.infoRim}>
          <View style={styles.infoCard}>
            {tint}
            {/* Each opens a short sheet: When its agenda, if it has one; Where the venue with Copy, Share and Get
                directions (owner, 15 Nov 2026), which replaced the Open in Google Maps pill. */}
            <Fact
              label="When"
              value={`${e.when} IST`}
              note={e.repeats && `${e.repeats} · ${host.name} runs this again and again`}
              onPress={e.agenda ? () => router.push(`/agenda/${e.id}`) : undefined}
            />
            <Fact label="Where" value={e.venue.name} note={e.venue.address} onPress={() => router.push(`/venue/${e.id}`)} />
          </View>
        </Glass>

        {!past && status.kind !== 'cancelled' && <InterestedCard event={e} />}

        <Section title="About" />
        <Text style={styles.prose}>{e.about}</Text>

        {/* What it's like, as small cards: its kind, then the vibe (owner, 19 Nov 2026: interest cards, all four). */}
        <Section title="What it’s like" />
        <View style={styles.tags}>
          {[categories.find((c) => c.slug === e.category)?.label ?? e.category, ...(vibes[e.id] ?? [])].map((t) => (
            <Tag key={t} text={t} />
          ))}
        </View>

        {/* Its kind's own sections: the show, the jam, how a hackathon works, the room, the fest (src/kindSections.tsx). */}
        <KindSections event={e} past={past} went={went} />

        {cast(e.people).map((g) => (
          <View key={g.title}>
            <Section title={g.title} />
            <View style={styles.people}>
              {g.ids.map((id) => {
                const p = people.find((x) => x.id === id);
                return p && <PersonRow key={id} person={p} />;
              })}
            </View>
          </View>
        ))}

        {/* The event's FAQ, if it has one, and its terms, each in a full modal (owner, 15 Nov 2026: "add Event FAQ &
            Terms & Conditions Modals"). No rim round this one ("remove rim for faq card"): the bare face, its edge in
            line with the rim of the card above. */}
        <View style={[styles.infoCard, styles.bareCard]}>
          {e.faq && (
            <Fact
              label="FAQ"
              value={`${e.faq.length} ${e.faq.length === 1 ? 'question' : 'questions'}`}
              onPress={() => router.push(`/faq/${e.id}`)}
            />
          )}
          <Fact label="Terms & Conditions" value="Tickets, refunds and entry" onPress={() => router.push(`/terms/${e.id}`)} />
        </View>

        {/* Last, the host to come back to (Discover doc: "every event page ends on the host and Follow"). */}
        <Section title="Hosted by" />
        <Pressable
          onPress={openHost}
          accessibilityRole="button"
          accessibilityLabel={`${host.name}${host.verified ? ', verified' : ''}, ${host.kind}`}>
          <Glass style={[styles.cardRim, styles.hostRim]}>
            <View style={[styles.card, styles.hostCard]}>
              <Monogram mark={host} size={PHOTO} />
              <View style={styles.grow}>
                {/* The verified tick beside the name, in place of the word (owner, 15 Nov 2026). */}
                <View style={styles.nameRow}>
                  <Text style={[styles.name, styles.shrink]} numberOfLines={1}>
                    {host.name}
                  </Text>
                  {host.verified && <Verified size={16} />}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {host.kind}
                </Text>
              </View>
              {/* Signed out, it asks to sign in first, then follows (src/session.ts). */}
              <Pressable onPress={() => needsAccount(() => setFollowing(host.id, !following))} accessibilityRole="button" hitSlop={6}>
                <Glass style={styles.follow}>
                  <Text style={[styles.followText, following && styles.followingText]}>{following ? 'Following' : 'Follow'}</Text>
                </Glass>
              </Pressable>
            </View>
          </Glass>
        </Pressable>
      </Animated.ScrollView>

      {showBar && (
        <BookBar
          price={formatPrice(price.paise)}
          from={price.from}
          note={booked ? undefined : seatsLine(e, status)}
          action={booked ? 'View ticket' : book.label}
          // A booking opens its ticket (src/app/ticket/[id].tsx, keyed by booking id). Signed out, Book and Register open
          // the sign-in sheet over this page and come back to it (Booking doc, step 2); booking itself isn't built yet.
          onAction={
            booked
              ? () => {
                  const t = ticketFor(e.id);
                  if (t) router.push(`/ticket/${t.id}`);
                }
              : !book.can
                ? undefined
                : () => needsAccount(() => router.push(`/book/${e.id}`)) // signed out, sign in first, then on to it
          }
          onHeight={setBar}
        />
      )}
      {/* Save and the menu (owner, 15 Nov 2026: "add top right, love and menu"); the menu holds the rest of the doc's list.
          Once it's over, Save goes; an event you went to has Loved it's heart there instead (owner, 19 Nov 2026).
          Signed out, Save asks to sign in first, then saves; so does Add to a list, which saves first if it isn't
          (Saved events and lists doc). Copy link, Add to calendar and Report aren't built yet. */}
      <BackBar scrollY={scrollY}>
        {/* Once it's started, Save goes: only a saved one keeps its filled star, to manage or remove it. */}
        {past && went && <LoveButton event={e} bar />}
        {(!past || saved) && <SaveButton event={e} bar />}
        <MenuButton
          actions={[
            ...(past ? [] : [{ label: 'Add to a list', icon: 'listPlus' as const, onPress: () => addToList(e.id) }]),
            {
              label: 'Share',
              icon: 'share',
              onPress: () => shareLink(`${e.title} · ${e.when} · ${e.area} · ${formatPrice(e.pricePaise)}`, `/event/${e.id}`),
            },
            { label: 'Copy link', icon: 'link' },
            { label: 'Add to calendar', icon: 'calendar' },
            { label: 'Report', icon: 'report' },
          ]}
        />
      </BackBar>
    </View>
  );
}

// A label over its value. One that opens something shows a ">" on its right (owner, 15 Nov 2026: "add > for when and
// where"), an exception to no icons in cards, like the verified tick.
// Interested (owner, 19 Nov 2026: "add interest cards for events", all four): apart from Save, it says you're thinking
// of going. How many are shows under the question, yours included, at any number (owner, same day: "in interested add
// count too", then "in button remove the count"). Signed out, it asks to sign in first. A card, so text and a pill only.
function InterestedCard({ event: e }: { event: Event }) {
  const mine = useInterested(e.id);
  const n = interestedBase(e.id) + (mine ? 1 : 0);
  return (
    <Glass style={styles.cardRim}>
      <View style={[styles.card, styles.interestCard]}>
        <View style={styles.grow}>
          <Text style={styles.name}>{mine ? 'You’re interested' : 'Thinking of going?'}</Text>
          <Text style={styles.meta}>{`${n} ${n === 1 ? 'person is' : 'people are'} interested`}</Text>
        </View>
        <Pressable
          onPress={() => needsAccount(() => setInterested(e.id, !mine))}
          accessibilityRole="button"
          accessibilityState={{ selected: mine }}
          hitSlop={6}>
          <Glass style={styles.follow}>
            <Text style={[styles.followText, mine && styles.followingText]}>{mine ? 'Interested' : 'I’m interested'}</Text>
          </Glass>
        </Pressable>
      </View>
    </Glass>
  );
}

// One person on the event, a plain row like Search's hosts: their 1:1 photo (a circle, as your own; the monogram until
// photos exist), name and one line. Tapping opens the person sheet.
function PersonRow({ person: p }: { person: Person }) {
  return (
    <Pressable
      onPress={() => router.push(`/person/${p.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}>
      <Monogram mark={p} size={PHOTO} round />
      <View style={styles.grow}>
        <Text style={styles.name} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {p.headline}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },

  head: { marginHorizontal: 20, alignItems: 'center' },
  status: { marginTop: space.big, flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The accent on a dot, never on text.
  statusText: { fontFamily: font.medium, fontSize: 13, color: color.secondary },
  title: { marginTop: space.small, fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text, textAlign: 'center' },
  by: { marginTop: 4, fontFamily: font.medium, fontSize: 15, color: color.secondary, textAlign: 'center' },

  cardRim: { marginHorizontal: 20, marginTop: space.big, padding: rim, borderRadius: RIM },
  card: { borderRadius: FACE, backgroundColor: color.card, padding: CARD_PAD, gap: space.small },
  infoRim: { marginHorizontal: 20, marginTop: space.big, padding: rim, borderRadius: INFO_RIM },
  infoCard: { borderRadius: INFO_FACE, backgroundColor: color.card, padding: INFO_PAD, gap: INFO_PAD },
  bareCard: { marginHorizontal: 20, marginTop: space.big, borderWidth: 1, borderColor: color.border }, // no rim, so an outline
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },

  prose: { marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  people: { marginHorizontal: 20, gap: 16 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },

  hostCard: { flexDirection: 'row', alignItems: 'center' },
  interestCard: { flexDirection: 'row', alignItems: 'center' },
  tags: { marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  // A finer rim than the app's 2px (owner, 15 Nov 2026: "reduce rim of hosted by to 1px"); its corner still nests.
  hostRim: { padding: HOST_RIM, borderRadius: around(FACE, HOST_RIM) },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
  // Home's host card Follow: 32 tall and fully round (owner: "even follow and following").
  follow: { height: 32, paddingHorizontal: 16, borderRadius: 16, justifyContent: 'center' },
  followText: { fontFamily: font.title, fontSize: 13, color: color.text },
  followingText: { color: color.secondary },

});
