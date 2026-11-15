import { formatPrice } from '@orbit/contract';
import { type ReactNode, useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Reanimated, {
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ticketFor } from '../../account/data';
import { Carousel, type CarouselSlide } from '../../home/Carousel';
import { BarGlass, Glass } from '../../glass';
import { justAnnounced, planHome, type Viewer } from '../../home/layout';
import { Icon } from '../../icons';
import { type Event, type Host, events, hosts, now } from '../../mock';
import { refreshPlace, usePlace } from '../../place';
import { EventRow, Monogram, Poster, SEAT, SeatCard, Section, Tag } from '../../rows';
import { needsAccount, setFollowing, useViewer } from '../../session';
import { around, color, font, radius, rim, space } from '../../theme';

const HEADER = 44;
const FRAME = rim; // the thin frosted rim around cards
const TICKET_POSTER = 72; // 3:4, so 96 tall
const TICKET_FACE = 2 * space.small + (TICKET_POSTER * 4) / 3; // ticket face: padding, the poster, padding
// The stack opening and closing (owner: "also animate the flow", "it is very fast and rapid", "opening is good, closing
// is not good, little speed needed", then "contents in card are moving fix it"): the cards glide apart over 650ms and
// back over 450ms, easing in and out. One Reanimated value drives transforms only, so a card's contents never re-lay
// out mid-move, and the page below follows the stack's height.
const STACK_OPEN_MS = 650;
const STACK_CLOSE_MS = 450;
const STACK_GAP = 12; // between cards when open
const STACK_DIM = 0.55; // the veil over a card behind the front one
const STACK_INSET = 8; // each step back in a stack is this much narrower on each side
const STACK_PEEK = 6; // how much of each stacked card behind shows: a sliver of its top edge, its 2px rim and 4px
// of empty face, never text (owner: "no title should visible", then "reduce the peek of stacked cards" again: 10 to 6)
const CARD_INSET = space.small; // padding inside every card, around its contents
// Every card's corners nest outward from its contents' corner (owner, 15 Nov 2026: "Inner Radius = Outer Radius -
// Padding", then "apply to all cards"): with a 6px corner and 8px padding the face is 14, the frosted rim 16.
const FACE = around(radius.sm, CARD_INSET);
const RIM = around(FACE, FRAME);

// Home B ("Orbit"), picked by the owner on 15 Nov 2026: the boards are on the Orbit canvas. Which blocks show
// comes from planHome (src/home/layout.ts); the state to look at is `viewer` in src/mock.ts.
// No icons inside cards (owner). The location opens the location screen (src/app/location.tsx); events open their page
// (src/app/event/[slug].tsx) and hosts theirs (src/app/host/[slug].tsx), and the profile opens Account
// (src/app/account). Signed out (src/session.ts), Home has no tickets or orbit and the profile shows a person outline;
// Follow asks to sign in first, then follows.
export default function Home() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const signed = useViewer();
  const v: Viewer = { ...signed, place: usePlace(signed.place) }; // the place chosen on the location screen, if any
  useEffect(() => {
    refreshPlace(); // once a launch, only if location is already allowed (src/place.ts)
  }, []);
  const plan = planHome(v, events, hosts, now);
  const hostOf = (id: string) => hosts.find((h) => h.id === id) as Host;
  const ticketLabel = (id: string) => v.tickets?.find((t) => t.eventId === id)?.label ?? '';

  const headerTop = insets.top + 4;
  const posterTop = headerTop + HEADER + 4;
  const card = (width - 40 - space.big) / 2; // All events and host cards: two columns on the 20px margins, a big gap apart
  const slides: CarouselSlide[] = plan.slides.map((s) =>
    s.kind === 'event'
      ? { key: `e:${s.event.id}`, image: s.event.wide!.source, edge: s.event.wide!.edge, label: `Poster for ${s.event.title}`, action: 'Book ticket', href: `/event/${s.event.id}` }
      : { key: `h:${s.host.id}`, image: s.host.banner!.source, edge: s.host.banner!.edge, label: `Banner for ${s.host.name}`, action: 'View events', href: `/host/${s.host.id}` },
  );

  // Drives the glass behind the pinned header (BarGlass in src/glass.tsx).
  const [scrollY] = useState(() => new Animated.Value(0));

  // The ticket stack opens to show every ticket (owner, 15 Nov 2026: "need option to see the other tickets").
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const toggleTickets = () => setTicketsOpen((open) => !open);
  const ticketsAction =
    plan.tickets.length > 1 ? { label: ticketsOpen ? 'Show less' : `See all ${plan.tickets.length}`, onPress: toggleTickets } : undefined;

  const hostCards = (
    <View style={styles.grid}>
      {plan.hosts.map((h) => (
        <HostCard key={h.id} host={h} width={card} following={v.follows.includes(h.id)} />
      ))}
    </View>
  );

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false} // no side scroll line (owner, 15 Nov 2026)
        // Clear of the tab bar: on iOS the tab's safe area includes it; on Android the tabs already pad the screen.
        contentContainerStyle={{ paddingBottom: (Platform.OS === 'ios' ? insets.bottom : 0) + 32 }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}>
        {/* The header is pinned over the page (below); the carousel still starts at the top, under it. */}
        {slides.length ? <Carousel slides={slides} top={posterTop} /> : <View style={{ height: headerTop + HEADER }} />}

        {plan.tickets.length > 0 && (
          <>
            <Section title="Your tickets" />
            <Stack
              items={plan.tickets}
              height={TICKET_FACE + 2 * FRAME}
              open={ticketsOpen}
              onOpen={ticketsAction && !ticketsOpen ? toggleTickets : undefined}
              openLabel={`Show all ${plan.tickets.length} tickets`}
              render={(e) => <TicketCard event={e} host={hostOf(e.hostId)} label={ticketLabel(e.id)} />}
            />
            {/* Under the stack (owner: "move see all to the bottom of stack"). */}
            {ticketsAction && (
              <Pressable onPress={ticketsAction.onPress} accessibilityRole="button" hitSlop={10} style={styles.stackToggle}>
                <Glass style={styles.stackToggleGlass}>
                  <Text style={styles.stackToggleText}>{ticketsAction.label}</Text>
                </Glass>
              </Pressable>
            )}
          </>
        )}

        {plan.orbit.length > 0 && (
          <>
            <Section title="Next from your orbit" />
            <View style={styles.feed}>
              {plan.orbit.map((e) => (
                <FeedRow key={e.id} event={e} host={hostOf(e.hostId)} />
              ))}
            </View>
          </>
        )}

        {plan.hostsFirst && plan.hosts.length > 0 && (
          <>
            <Section title="Start your orbit" />
            {hostCards}
          </>
        )}

        {plan.notice && <Notice kind={plan.notice} area={v.place?.area} />}

        {plan.list.events.length > 0 && (
          <>
            <Section title={plan.list.title} />
            {plan.list.events.map((e) => <EventRow key={e.id} event={e} host={hostOf(e.hostId)} />)}
          </>
        )}

        {!plan.hostsFirst && plan.hosts.length > 0 && (
          <>
            <Section title="Hosts near you" />
            {hostCards}
          </>
        )}

        {plan.all.length > 0 && (
          <>
            <Section title="All events" />
            <View style={styles.grid}>
              {plan.all.map((e) => <GridCard key={e.id} event={e} width={card} />)}
            </View>
          </>
        )}
      </Animated.ScrollView>

      {/* Pinned, with glass fading in behind it once the page scrolls, as on Search (owner, 15 Nov 2026: "apply the
          same in home"); it replaced a ground strip under the clock. The gaps let taps through. */}
      <View style={[styles.bar, { paddingTop: headerTop }]}>
        <BarGlass scrollY={scrollY} />
        <Header viewer={v} />
      </View>
    </View>
  );
}

function Header({ viewer: v }: { viewer: Viewer }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.push('/location')}
        style={styles.place}
        accessibilityRole="button"
        accessibilityLabel={v.place ? `Location: ${[v.place.area, v.place.city].filter(Boolean).join(', ')}. Change location` : 'Set location'}
      >
        <Icon name="pin" size={22} color={color.accent} />
        <View>
          <View style={styles.areaRow}>
            <Text style={styles.area}>{v.place?.area ?? 'Set location'}</Text>
            <Icon name="caretDown" size={14} color={color.secondary} />
          </View>
          <Text style={styles.city}>{v.place?.city ?? 'Showing everywhere'}</Text>
        </View>
      </Pressable>
      {/* A thin frosted rim round the profile circle (owner, 15 Nov 2026: "add rim to profile"). It opens Account
          (src/app/account), signed out too, where only what works without an account shows. */}
      <Pressable onPress={() => router.push('/account')} accessibilityRole="button" accessibilityLabel={v.signedIn ? 'Account' : 'Sign in'}>
        <Glass style={styles.profileRim}>
          <View style={styles.round}>
            {v.signedIn && v.initial ? <Text style={styles.initial}>{v.initial}</Text> : <Icon name="user" size={20} color={color.text} />}
          </View>
        </Glass>
      </Pressable>
    </View>
  );
}

// A Wallet-style stack (owner, 15 Nov 2026: "stack them one on one", then "use this for tickets"): the first item in
// front and whole, each later one behind it showing only its top row. Cards behind are dimmed and inset STACK_INSET a
// side per step back, so none sticks out past the card in front ("dim back ones should not be out of main one").
// Drawn back to front, so the front comes last; `back` is 0 for the front card, 1 behind it, and so on.
// `open` lays every card out in full, one under another; `onOpen` makes the closed stack tappable to open it.
// Closed, cards behind sit STACK_PEEK above the one in front, each step back scaled from its top edge to be
// STACK_INSET narrower a side, and veiled. Open, they stand STACK_GAP apart at full size. Every card keeps its full
// width in both states, so only transforms move.
function Stack<T extends { id: string }>({
  items,
  height,
  render,
  open = false,
  onOpen,
  openLabel,
}: {
  items: readonly T[];
  height: number;
  render: (item: T) => ReactNode;
  open?: boolean;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = width - 40;
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: open ? STACK_OPEN_MS : STACK_CLOSE_MS, easing: Easing.inOut(Easing.ease) });
  }, [open, progress]);

  const n = items.length;
  const closedHeight = (n - 1) * STACK_PEEK + height;
  const openHeight = n * height + (n - 1) * STACK_GAP;
  const box = useAnimatedStyle(() => ({ height: interpolate(progress.value, [0, 1], [closedHeight, openHeight]) }));
  const tappable = !!onOpen && !open;

  return (
    <Pressable
      disabled={!tappable}
      onPress={onOpen}
      accessibilityRole={tappable ? 'button' : undefined}
      accessibilityLabel={tappable ? openLabel : undefined}
      style={styles.stack}>
      <Reanimated.View style={box}>
        {/* Back to front, so the front card draws last and sits on top. */}
        {[...items].reverse().map((item, r) => (
          <StackCard key={item.id} depth={n - 1 - r} count={n} height={height} cardWidth={cardWidth} progress={progress}>
            {render(item)}
          </StackCard>
        ))}
      </Reanimated.View>
    </Pressable>
  );
}

// One card in a Stack. `depth` is 0 for the front card, 1 behind it, and so on.
function StackCard({
  depth,
  count,
  height,
  cardWidth,
  progress,
  children,
}: {
  depth: number;
  count: number;
  height: number;
  cardWidth: number;
  progress: SharedValue<number>;
  children: ReactNode;
}) {
  const move = useAnimatedStyle(() => {
    const closedY = (count - 1 - depth) * STACK_PEEK;
    const openY = depth * (height + STACK_GAP);
    const closedScale = (cardWidth - 2 * depth * STACK_INSET) / cardWidth;
    return {
      transform: [
        { translateY: interpolate(progress.value, [0, 1], [closedY, openY]) },
        { scale: interpolate(progress.value, [0, 1], [closedScale, 1]) },
      ],
    };
  });
  const veil = useAnimatedStyle(() => ({ opacity: depth === 0 ? 0 : interpolate(progress.value, [0, 1], [STACK_DIM, 0]) }));
  return (
    <Reanimated.View style={[styles.stackCard, move]}>
      {children}
      <Reanimated.View style={[styles.stackVeil, veil]} />
    </Reanimated.View>
  );
}

// One booking, as a normal card like the others: the card face in the thin frosted rim (owner, 15 Nov 2026: the
// notched ticket shapes were tried, then "make it normal like others"). A card, so no icons.
// Hierarchy (owner: "fix the hierarchy and placements in ticket"): the poster anchors the left at the face's full
// height; the title leads (two lines when it needs them), the booked time follows in white, and host and area sit grey
// on their own lines beside a small View ticket at the bottom (owner: "small the view ticket", "instead of clipping
// the text use two lines as space is there").
// The face's top 10px (rim and padding) stays empty, so a stacked card's peek never shows text.
function TicketCard({ event: e, host, label }: { event: Event; host: Host; label: string }) {
  const ticket = ticketFor(e.id);
  return (
    <Glass style={styles.cardRim}>
      <View style={styles.ticketCard}>
        <Poster media={e.poster} width={TICKET_POSTER} label={e.title} />
        <View style={[styles.grow, styles.ticketText]}>
          <View style={styles.lines}>
            <Text style={styles.ticketTitle} numberOfLines={2}>{e.title}</Text>
            <Text style={styles.ticketWhen} numberOfLines={1}>{label}</Text>
          </View>
          <View style={styles.ticketFoot}>
            <Text style={[styles.ticketMeta, styles.grow]} numberOfLines={2}>{host.name}{'\n'}{e.area}</Text>
            {/* Opens the ticket, its QR for the gate (src/app/ticket/[id].tsx). */}
            <Pressable
              onPress={() => ticket && router.push(`/ticket/${ticket.id}`)}
              disabled={!ticket}
              accessibilityRole="button"
              hitSlop={6}>
              <Button label="View ticket" small />
            </Pressable>
          </View>
        </View>
      </View>
    </Glass>
  );
}

// "Next from your orbit" as a feed (owner, 15 Nov 2026: "change the entire next from orbit", then picked host feed
// rows): one plain row per followed host, its round 1:1 logo, name and tag, then its next event's title and date,
// with a small 3:4 poster on the right. 20px between rows, no rules (owner: "remove hairlines between rows, fix the
// spacing and typography"): the host is a small grey label, the title leads, the date follows. Not a card, but kept
// icon-free like one.
function FeedRow({ event: e, host }: { event: Event; host: Host }) {
  return (
    <Pressable
      onPress={() => router.push(`/event/${e.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.feedRow, pressed && styles.pressed]}>
      <Monogram mark={host} size={40} />
      <View style={[styles.grow, styles.feedText]}>
        <View style={styles.feedHead}>
          <Text style={styles.feedHost} numberOfLines={1}>{host.name}</Text>
          {justAnnounced(e, now) ? (
            <View style={styles.announced}>
              <View style={styles.dot} />
              <Text style={styles.small}>Just announced</Text>
            </View>
          ) : (
            e.repeats && <Tag text={e.repeats} />
          )}
        </View>
        <Text style={styles.feedTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.feedWhen}>{e.when}</Text>
      </View>
      <Poster media={e.poster} width={48} label={e.title} />
    </Pressable>
  );
}

// Hosts as two columns of 4:3 cards, the host's 1:1 logo sitting on the card's top rim (owner, 15 Nov 2026).
// Logos are 1:1 and shown round (Discover decision 13); the monogram stands in until real logos exist. A card, so no
// icons. Same face and frosted rim as All events.
function HostCard({ host, width, following }: { host: Host; width: number; following: boolean }) {
  return (
    <Pressable onPress={() => router.push(`/host/${host.id}`)} accessibilityRole="button" accessibilityLabel={host.name}>
      <SeatCard width={width} seat={<Monogram mark={host} size={SEAT} />}>
        <Text style={styles.hostCardName} numberOfLines={1}>{host.name}</Text>
        <Text style={styles.hostCardAbout} numberOfLines={1}>{host.about}</Text>
        {/* Hosts you already follow show it here (owner, 15 Nov 2026). Signed out, it asks to sign in first. */}
        <Pressable onPress={() => needsAccount(() => setFollowing(host.id, !following))} accessibilityRole="button" hitSlop={6} style={styles.followTap}>
          <Glass style={styles.followSmall}>
            <Text style={[styles.followSmallText, following && styles.followingText]}>{following ? 'Following' : 'Follow'}</Text>
          </Glass>
        </Pressable>
      </SeatCard>
    </Pressable>
  );
}

function Notice({ kind, area }: { kind: 'noLocation' | 'nothingNear'; area?: string }) {
  const noLocation = kind === 'noLocation';
  return (
    <View style={[styles.card, styles.notice]}>
      <Text style={styles.noticeTitle}>{noLocation ? 'See what’s near you' : `Nothing near ${area} yet`}</Text>
      <Text style={styles.noticeText}>
        {noLocation
          ? 'Set your location and Orbit shows what’s within 25 km. Until then, here’s everything coming up.'
          : 'Here’s everything coming up on Orbit instead, soonest first.'}
      </Text>
      {noLocation && (
        <Pressable onPress={() => router.push('/location')} accessibilityRole="button">
          <Glass style={styles.wideButton}>
            <Text style={styles.buttonText}>Set location</Text>
          </Glass>
        </Pressable>
      )}
    </View>
  );
}

// "All events": two columns of cards with a thin frosted glass rim around each card, the poster on top and
// date, title and price under it (owner, 15 Nov 2026: two columns, smaller, page margins with a 24px gap, a thin
// frosted rim, a card, "apply the rim to card", then "remove padding for poster"). The poster runs edge to edge across
// the top of the card face, which rounds its top corners; only the text is padded. A card, so no icons and no heart.
// The card face and rim use FACE and RIM, like every card.
function GridCard({ event: e, width }: { event: Event; width: number }) {
  return (
    <Pressable onPress={() => router.push(`/event/${e.id}`)} accessibilityRole="button">
      <Glass style={[styles.gridRim, { width }]}>
        <View style={styles.gridCard}>
          <Poster media={e.poster} width={width - 2 * FRAME} label={e.title} corner={0} />
          <View style={styles.gridBody}>
            <Text style={styles.gridMeta} numberOfLines={1}>{e.when}</Text>
            <Text style={styles.gridTitle} numberOfLines={2}>{e.title}</Text>
            <Text style={styles.gridPrice}>{formatPrice(e.pricePaise)}</Text>
          </View>
        </View>
      </Glass>
    </Pressable>
  );
}

// Every button is frosted glass with a white label (owner, 15 Nov 2026).
function Button({ label, small }: { label: string; small?: boolean }) {
  return (
    <Glass style={small ? styles.buttonSmall : styles.button}>
      <Text style={small ? styles.buttonSmallText : styles.buttonText}>{label}</Text>
    </Glass>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 12, pointerEvents: 'box-none' },
  grow: { flex: 1, minWidth: 0 },
  lines: { gap: 3 },

  header: { height: HEADER, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  place: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  area: { fontFamily: font.headline, fontSize: 17, color: color.text },
  city: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  profileRim: { width: 44, height: 44, borderRadius: 22, padding: FRAME },
  round: { flex: 1, borderRadius: 22 - FRAME, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: font.headline, fontSize: 17, color: color.text },

  stackToggle: { alignSelf: 'center', marginTop: 10 },
  // Very small (owner, 15 Nov 2026); hitSlop keeps the tap target near 44px.
  stackToggleGlass: { height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center' },
  stackToggleText: { fontFamily: font.title, fontSize: 11, color: color.text },

  card: { marginHorizontal: 20, backgroundColor: color.card },
  ticketTitle: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  ticketWhen: { fontFamily: font.medium, fontSize: 13, lineHeight: 17, color: color.text },
  ticketMeta: { fontFamily: font.text, fontSize: 12, lineHeight: 16, color: color.secondary },

  stack: { marginHorizontal: 20 },
  stackCard: { position: 'absolute', top: 0, left: 0, right: 0, transformOrigin: 'top' },
  stackVeil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: RIM, backgroundColor: color.ground, pointerEvents: 'none' },
  ticketCard: { height: TICKET_FACE, flexDirection: 'row', borderRadius: FACE, backgroundColor: color.card, padding: CARD_INSET, gap: space.small },
  ticketText: { justifyContent: 'space-between' },
  ticketFoot: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  feed: { marginHorizontal: 20, gap: 20 },
  pressed: { opacity: 0.7 },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  feedText: { gap: 2 },
  feedHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4, marginBottom: 2 },
  feedHost: { flexShrink: 1, fontFamily: font.medium, fontSize: 12, color: color.secondary },
  feedTitle: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  feedWhen: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  announced: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },


  hostCardName: { fontFamily: font.title, fontSize: 14, color: color.text, textAlign: 'center' },
  hostCardAbout: { fontFamily: font.text, fontSize: 11, color: color.secondary, textAlign: 'center' },
  // Fully round, like every action pill (owner: "even follow and following").
  followTap: { marginTop: 'auto', marginBottom: space.small },
  followSmall: { height: 32, paddingHorizontal: 16, borderRadius: 16, justifyContent: 'center' },
  followSmallText: { fontFamily: font.title, fontSize: 13, color: color.text },
  followingText: { color: color.secondary },

  notice: { marginTop: space.big, borderRadius: FACE, padding: CARD_INSET, gap: 4 },
  noticeTitle: { fontFamily: font.title, fontSize: 16, color: color.text },
  noticeText: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary },
  wideButton: { marginTop: space.small, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },

  small: { fontFamily: font.text, fontSize: 12, color: color.secondary },

  grid: { marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', columnGap: space.big, rowGap: space.big },
  cardRim: { padding: FRAME, borderRadius: RIM },
  gridRim: { padding: FRAME, borderRadius: RIM },
  gridCard: { borderRadius: FACE, backgroundColor: color.card, overflow: 'hidden' },
  gridBody: { padding: CARD_INSET, gap: 2 }, // padded on its own; the 2px is line spacing within the text
  gridMeta: { fontFamily: font.text, fontSize: 11, color: color.secondary },
  gridTitle: { fontFamily: font.title, fontSize: 13, lineHeight: 17, color: color.text },
  gridPrice: { fontFamily: font.price, fontSize: 13, color: color.text },
  // Fully round (owner: "rounded view ticket and view events and book ticket"). Pills are the exception to nested
  // corners: the card around them keeps its 14px face rather than growing to fit a pill.
  button: { height: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center' },
  buttonText: { fontFamily: font.title, fontSize: 14, color: color.text },
  buttonSmall: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  buttonSmallText: { fontFamily: font.title, fontSize: 13, color: color.text },
});
