import { categories, formatPrice } from '@orbit/contract';
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

import { past as history, ticketFor } from '../../account/data';
import { Pill } from '../../account/kit';
import { Carousel, type CarouselSlide } from '../../home/Carousel';
import { BarGlass, Glass } from '../../glass';
import { planHome, type Viewer } from '../../home/layout';
import { Icon } from '../../icons';
import { type Event, type Host, events, hosts, now } from '../../mock';
import { refreshPlace, usePlace } from '../../place';
import { meetups } from '../../kinds';
import { EventRow, loveIt, Monogram, Poster, SEAT, SeatCard, Section, StatusDot, Tag } from '../../rows';
import { bookAction, eventStatus, isNews } from '../../status';
import { needsAccount, setFollowing, skipInterests, useLoved, useViewer } from '../../session';
import { around, color, darkInkOn, font, groundAt, radius, rim, space } from '../../theme';

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
// Home's text cards (What do you like?, See what's near you, Coming soon, Nothing near) get the room every text card
// has, Account's and the event page's (owner, 15 Nov 2026: "add proper spacing and padding to cards"; 19 Nov: "add
// proper padding to pick interests card", then "remember for cards add proper padding … for Nothing near yet. similar
// to that all", "but not tickets and all events cards"): 16 inside, 16 from the words to the buttons, corner 6 + 16.
// Ticket and All events cards keep CARD_INSET, their posters' 8.
const TEXT_PAD = 16;

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
      ? { key: `e:${s.event.id}`, image: s.event.wide!.source, edge: s.event.wide!.edge, label: `Poster for ${s.event.title}`, action: slideAction(s.event), href: `/event/${s.event.id}` }
      : { key: `h:${s.host.id}`, image: s.host.banner!.source, edge: s.host.banner!.edge, label: `Banner for ${s.host.name}`, action: 'View events', href: `/host/${s.host.id}` },
  );

  // Drives the glass behind the pinned header (BarGlass in src/glass.tsx).
  const [scrollY] = useState(() => new Animated.Value(0));
  // The header's location reads in Charcoal over a light poster, Stone over a dark one, switching with the slide.
  const [active, setActive] = useState(0);
  const slide = slides[Math.min(active, slides.length - 1)];
  const darkInk = !!slide && darkInkOn(slide.edge, HEADER_WASH);

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
        {slides.length ? <Carousel slides={slides} top={posterTop} onActive={setActive} /> : <View style={{ height: headerTop + HEADER }} />}

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

        {/* Thanks for coming, for each event you were let in at in the last week, newest first (two at most). */}
        {v.signedIn &&
          thanksFor(now).map((e) => <Thanks key={e.id} event={e} host={hostOf(e.hostId)} />)}

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

        {plan.askInterests && <AskInterests />}

        {/* A section per kind of event you picked (Account › Interests), its events out of the list below. */}
        {plan.byInterest.map((k) => (
          <View key={k.category}>
            <Section title={`${categories.find((c) => c.slug === k.category)?.label ?? k.category} ${plan.near ? 'near you' : 'coming up'}`} />
            {k.events.map((e) => (
              <EventRow key={e.id} event={e} host={hostOf(e.hostId)} />
            ))}
          </View>
        ))}

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
        <Header viewer={v} dark={darkInk} scrollY={scrollY} />
      </View>
    </View>
  );
}

// The carousel's wash where the location sits: the ground at 50% at the top of the screen, 30% at the header's foot.
const HEADER_WASH = 0.4;

// The pin, area and city in one ink.
function Place({ viewer: v, text, soft, pin }: { viewer: Viewer; text: string; soft: string; pin: string }) {
  return (
    <View style={styles.place}>
      <Icon name="pin" size={22} color={pin} />
      <View>
        <View style={styles.areaRow}>
          <Text style={[styles.area, { color: text }]}>{v.place?.area ?? 'Set location'}</Text>
          <Icon name="caretDown" size={14} color={soft} />
        </View>
        <Text style={[styles.city, { color: soft }]}>{v.place?.city ?? 'Showing everywhere'}</Text>
      </View>
    </View>
  );
}

// The location in two inks laid one on the other (owner, 19 Nov 2026: "the location text should adapt the bg and switch
// colors"): Stone, and Charcoal for a light poster's edge, cross-faded as the slides change. Once the page scrolls
// under the header's dark glass (BarGlass, over its first 16pt) it's Stone again. Opacity only, so it runs on the
// native driver with the scroll.
function Header({ viewer: v, dark, scrollY }: { viewer: Viewer; dark: boolean; scrollY: Animated.Value }) {
  const [shade] = useState(() => new Animated.Value(dark ? 1 : 0));
  useEffect(() => {
    Animated.timing(shade, { toValue: dark ? 1 : 0, duration: 300, useNativeDriver: true }).start();
  }, [dark, shade]);
  const [ink] = useState(() => {
    const onPoster = scrollY.interpolate({ inputRange: [0, 16], outputRange: [1, 0], extrapolate: 'clamp' });
    const charcoal = Animated.multiply(shade, onPoster);
    return { charcoal, stone: charcoal.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) };
  });
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.push('/location')}
        accessibilityRole="button"
        accessibilityLabel={v.place ? `Location: ${[v.place.area, v.place.city].filter(Boolean).join(', ')}. Change location` : 'Set location'}
      >
        <Animated.View style={{ opacity: ink.stone }}>
          <Place viewer={v} text={color.text} soft={color.secondary} pin={color.accent} />
        </Animated.View>
        <Animated.View style={[styles.inkOver, { opacity: ink.charcoal }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Place viewer={v} text={color.ground} soft={groundAt(0.64)} pin={color.ground} />
        </Animated.View>
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
  const st = eventStatus(e, now); // news (Just announced, Almost full…) beats the repeat tag
  return (
    <Pressable
      onPress={() => router.push(`/event/${e.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.feedRow, pressed && styles.pressed]}>
      <Monogram mark={host} size={40} />
      <View style={[styles.grow, styles.feedText]}>
        <View style={styles.feedHead}>
          <Text style={styles.feedHost} numberOfLines={1}>{host.name}</Text>
          {isNews(st) ? (
            <View style={styles.announced}>
              <StatusDot tone={st.tone} />
              <Text style={styles.small}>{st.short}</Text>
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

// Home asks once what you like, signed in (owner, 19 Nov 2026: "add interest cards for events", all four): Pick
// interests opens Account › Interests; Not now stops the asking, and Interests stays on Account for later.
// An event slide's pill follows its status: Book ticket or Register while open, Join waitlist, else View event.
function slideAction(e: Event) {
  const book = bookAction(eventStatus(e, now), !e.pricePaise);
  return book.can ? book.label : 'View event';
}

// Thanks for coming (owner, 19 Nov 2026: "After-check-in bits"; Performer and inRoom docs): after an event you were let
// in at, for a week. A meetup's card opens its room, to see who was there (inRoom 12); any other offers Loved it, and a
// love offers to follow the acts (Performer 10). A text card, so words and a pill only.
const WEEK = 3 * 3_600_000 + 7 * 86_400_000; // the event (about three hours), then a week
function thanksFor(at: number): Event[] {
  return history
    .filter((h) => h.status === 'Went')
    .map((h) => events.find((e) => e.id === h.eventId))
    .filter((e): e is Event => !!e && at >= Date.parse(e.startsAt) && at < Date.parse(e.startsAt) + WEEK)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .slice(0, 2);
}
function Thanks({ event: e, host }: { event: Event; host: Host }) {
  const loved = useLoved(e.id);
  const room = meetups[e.id]?.inRoom;
  return (
    <View style={[styles.card, styles.notice]}>
      <Text style={styles.noticeTitle}>Thanks for coming to {e.title}</Text>
      <Text style={styles.noticeText}>
        {room ? 'See who was there, and connect. The room’s open for a week after.' : loved ? `You loved it. ${host.name} will hear.` : `Loved it? Let ${host.name} know.`}
      </Text>
      <View style={styles.askButtons}>
        {room ? (
          <Pill label="See who was there" onPress={() => router.push(`/room/${e.id}`)} />
        ) : (
          <Pill label={loved ? 'You loved it' : 'Loved it'} muted={loved} onPress={() => loveIt(e.id, !loved)} />
        )}
      </View>
    </View>
  );
}

function AskInterests() {
  return (
    <View style={[styles.card, styles.notice]}>
      <Text style={styles.noticeTitle}>What do you like?</Text>
      <Text style={styles.noticeText}>Pick a few kinds of event and Home shows more of them.</Text>
      <View style={styles.askButtons}>
        <Pill label="Pick interests" onPress={() => router.push('/account/interests')} />
        <Pill label="Not now" muted onPress={skipInterests} />
      </View>
    </View>
  );
}

// Coming soon (owner, 19 Nov 2026: "only ap & telangana. other than it unserviceable. or coming soon"): somewhere
// outside Telangana and Andhra Pradesh, Home says so and shows what's on there, with Pick a city to look around one.
function Notice({ kind, area }: { kind: 'noLocation' | 'comingSoon' | 'nothingNear'; area?: string }) {
  const noLocation = kind === 'noLocation';
  const soon = kind === 'comingSoon';
  return (
    <View style={[styles.card, styles.notice]}>
      <Text style={styles.noticeTitle}>{noLocation ? 'See what’s near you' : soon ? `Coming soon to ${area}` : `Nothing near ${area} yet`}</Text>
      <Text style={styles.noticeText}>
        {noLocation
          ? 'Set your location and Orbit shows what’s within 25 km. Until then, here’s everything coming up.'
          : soon
            ? 'Orbit is in Telangana and Andhra Pradesh for now. Here’s what’s on there, soonest first.'
            : 'Here’s everything coming up on Orbit instead, soonest first.'}
      </Text>
      {(noLocation || soon) && (
        <Pressable onPress={() => router.push('/location')} accessibilityRole="button">
          <Glass style={styles.wideButton}>
            <Text style={styles.buttonText}>{soon ? 'Pick a city' : 'Set location'}</Text>
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
  inkOver: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  area: { fontFamily: font.headline, fontSize: 17 },
  city: { fontFamily: font.text, fontSize: 13 },
  profileRim: { width: 44, height: 44, borderRadius: 22, padding: FRAME },
  round: { flex: 1, borderRadius: 22 - FRAME, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' },
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


  hostCardName: { fontFamily: font.title, fontSize: 14, color: color.text, textAlign: 'center' },
  hostCardAbout: { fontFamily: font.text, fontSize: 11, color: color.secondary, textAlign: 'center' },
  // Fully round, like every action pill (owner: "even follow and following").
  followTap: { marginTop: 'auto', marginBottom: space.small },
  followSmall: { height: 32, paddingHorizontal: 16, borderRadius: 16, justifyContent: 'center' },
  followSmallText: { fontFamily: font.title, fontSize: 13, color: color.text },
  followingText: { color: color.secondary },

  notice: { marginTop: space.big, borderRadius: around(radius.sm, TEXT_PAD), borderWidth: 1, borderColor: color.border, padding: TEXT_PAD, gap: 4 }, // no rim, so an outline
  noticeTitle: { fontFamily: font.title, fontSize: 16, color: color.text },
  askButtons: { marginTop: TEXT_PAD - 4, flexDirection: 'row', gap: space.small }, // 16 from the words, the 4 gap included
  noticeText: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary },
  wideButton: { marginTop: TEXT_PAD - 4, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },

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
