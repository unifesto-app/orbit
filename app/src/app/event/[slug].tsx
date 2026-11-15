// The event page (Discover flow doc, Event page; defaults accepted 15 Nov 2026), from any event row or card and the
// Home carousel. One column: the poster, the status, title and host; when and where; About; the people, a group per
// role; and last the host with Follow. Tickets are a bar pinned to the bottom ("In the app this is a bar pinned to the
// bottom"). No icons in its cards.
// The poster runs full width like Home's carousel (owner, 15 Nov 2026: "apply 4:3/ 3:4 poster full", "same like home
// page carousel"), from the very top of the screen ("remove the poster top blur, instead start poster from top"): the
// 4:3 poster when the event has one, else the 3:4.
// Not here yet: picking a ticket type and quantity, agenda, prizes and FAQ.
import { formatPrice } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ticketFor } from '../../account/data';
import { barPrice, cast } from '../../detail';
import { Glass } from '../../glass';
import { Carousel } from '../../home/Carousel';
import { Icon } from '../../icons';
import { events, hosts, now, people, type Person } from '../../mock';
import { BackBar, CircleButton, FaceWash, MenuButton, Monogram, NotFound, SaveIcon, Section, shareLink, Verified } from '../../rows';
import { needsAccount, setFollowing, setSaved, useSaved, useViewer } from '../../session';
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
  const saved = useSaved(slug);
  if (!e || !host) return <NotFound what="event" />;

  const past = Date.parse(e.startsAt) < now;
  const booked = viewer.signedIn && !!viewer.tickets?.some((t) => t.eventId === e.id);
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
        contentContainerStyle={{ paddingBottom: past ? insets.bottom + space.big : bar }}>
        {/* From the top of the screen, under the status bar and the back button. */}
        <Carousel
          top={0}
          extend={false}
          ratio={e.wide ? '4:3' : '3:4'}
          slides={[{ key: e.id, image: (e.wide ?? e.poster).source, edge: e.wide?.edge ?? host.bg, label: `Poster for ${e.title}` }]}
        />
        <View style={styles.head}>
          <View style={styles.status}>
            <View style={[styles.dot, past && styles.dotPast]} />
            <Text style={styles.statusText}>{past ? 'Ended' : 'Booking open'}</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {e.title}
          </Text>
          <Pressable onPress={openHost} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.by}>by {host.name}</Text>
          </Pressable>
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

        <Section title="About" />
        <Text style={styles.prose}>{e.about}</Text>

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

      {!past && (
        <TicketBar
          price={formatPrice(price.paise)}
          from={price.from}
          note={e.seats}
          action={booked ? 'View ticket' : e.pricePaise ? 'Book ticket' : 'Register'}
          // A booking opens its ticket (src/app/ticket/[id].tsx, keyed by booking id). Signed out, Book and Register open
          // the sign-in sheet over this page and come back to it (Booking doc, step 2); booking itself isn't built yet.
          onAction={
            booked
              ? () => {
                  const t = ticketFor(e.id);
                  if (t) router.push(`/ticket/${t.id}`);
                }
              : viewer.signedIn
                ? undefined
                : () => needsAccount()
          }
          onHeight={setBar}
        />
      )}
      {/* Save and the menu (owner, 15 Nov 2026: "add top right, love and menu"); the menu holds the rest of the doc's list.
          Signed out, Save asks to sign in first, then saves. Copy link, Add to calendar and Report aren't built yet. */}
      <BackBar scrollY={scrollY}>
        <CircleButton label={saved ? `Saved: ${e.title}` : `Save ${e.title}`} onPress={() => needsAccount(() => setSaved(e.id, !saved))}>
          <SaveIcon eventId={e.id} />
        </CircleButton>
        <MenuButton
          actions={[
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
function Fact({ label, value, note, onPress }: { label: string; value: string; note?: string; onPress?: () => void }) {
  const lines = (
    <View style={[styles.grow, styles.factLines]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {note && <Text style={styles.meta}>{note}</Text>}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.factRow, pressed && styles.pressed]}>
      {lines}
      <Icon name="chevron" size={16} color={color.secondary} />
    </Pressable>
  ) : (
    lines
  );
}

// One person on the event, a plain row like Search's hosts: their 1:1 photo (a rounded square; the monogram until
// photos exist), name and one line. Tapping opens the person sheet.
function PersonRow({ person: p }: { person: Person }) {
  return (
    <Pressable
      onPress={() => router.push(`/person/${p.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}>
      <Monogram mark={p} size={PHOTO} />
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

// Tickets, pinned to the bottom: the price and seats line on the left, one pill on the right (Book ticket, Register
// when free, View ticket once booked). It floats, never attached to the screen's edges (owner, 15 Nov 2026: "bottom
// cta should not be attached"): a frosted pill on the page margins, held off the bottom, darkened like the top bar so
// its white text reads over any poster. Its corners nest round the button's (22 + the small gap = 30, half its
// height). View ticket opens the ticket; Book ticket and Register aren't buttons until booking exists (`onAction`).
// `onHeight` gets the room it takes, gap below included.
const BAR_PAD = space.small;
const BUTTON = 44;
// With more than one ticket type, the cheapest leads with "Starting from" (`from`).
function TicketBar({
  price,
  from,
  note,
  action,
  onAction,
  onHeight,
}: {
  price: string;
  from: boolean;
  note?: string;
  action: string;
  onAction?: () => void;
  onHeight: (h: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, space.big);
  return (
    <View style={[styles.ticketBar, { bottom }]} onLayout={(ev) => onHeight(ev.nativeEvent.layout.height + bottom + space.big)}>
      <Glass style={styles.ticketGlass} />
      <View style={styles.ticketShade} />
      <View style={[styles.grow, styles.ticketText]}>
        <Text style={styles.price}>
          {from && <Text style={styles.from}>Starting from </Text>}
          {price}
        </Text>
        {note && <Text style={styles.small}>{note}</Text>}
      </View>
      <Pressable onPress={onAction} disabled={!onAction} accessibilityRole="button">
        <Glass style={styles.button}>
          <Text style={styles.buttonText}>{action}</Text>
        </Glass>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },

  head: { marginHorizontal: 20, alignItems: 'center' },
  status: { marginTop: space.big, flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The accent on a dot, never on text.
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  dotPast: { backgroundColor: color.secondary },
  statusText: { fontFamily: font.medium, fontSize: 13, color: color.secondary },
  title: { marginTop: space.small, fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text, textAlign: 'center' },
  by: { marginTop: 4, fontFamily: font.medium, fontSize: 15, color: color.secondary, textAlign: 'center' },

  cardRim: { marginHorizontal: 20, marginTop: space.big, padding: rim, borderRadius: RIM },
  card: { borderRadius: FACE, backgroundColor: color.card, padding: CARD_PAD, gap: space.small },
  infoRim: { marginHorizontal: 20, marginTop: space.big, padding: rim, borderRadius: INFO_RIM },
  infoCard: { borderRadius: INFO_FACE, backgroundColor: color.card, padding: INFO_PAD, gap: INFO_PAD },
  bareCard: { marginHorizontal: 20, marginTop: space.big },
  factLines: { gap: 2 }, // line spacing between a fact's label, value and note
  factRow: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  label: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  value: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },

  prose: { marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  people: { marginHorizontal: 20, gap: 16 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },

  hostCard: { flexDirection: 'row', alignItems: 'center' },
  // A finer rim than the app's 2px (owner, 15 Nov 2026: "reduce rim of hosted by to 1px"); its corner still nests.
  hostRim: { padding: HOST_RIM, borderRadius: around(FACE, HOST_RIM) },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
  // Home's host card Follow: 32 tall and fully round (owner: "even follow and following").
  follow: { height: 32, paddingHorizontal: 16, borderRadius: 16, justifyContent: 'center' },
  followText: { fontFamily: font.title, fontSize: 13, color: color.text },
  followingText: { color: color.secondary },

  ticketBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    padding: BAR_PAD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.small,
  },
  ticketGlass: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: BUTTON / 2 + BAR_PAD },
  ticketShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: BUTTON / 2 + BAR_PAD, backgroundColor: `${color.ground}80` },
  // In from the pill's round end, so the price sits clear of the curve.
  ticketText: { paddingLeft: 12 },
  price: { fontFamily: font.price, fontSize: 18, color: color.text },
  from: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  small: { fontFamily: font.text, fontSize: 12, color: color.secondary },
  // View ticket's size (owner: "rounded view ticket and view events and book ticket").
  button: { height: BUTTON, paddingHorizontal: 24, borderRadius: BUTTON / 2, justifyContent: 'center' },
  buttonText: { fontFamily: font.title, fontSize: 15, color: color.text },
});
