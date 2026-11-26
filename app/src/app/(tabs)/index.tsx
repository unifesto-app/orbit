import { type CategorySlug, categories, formatPrice } from '@orbit/contract';
import { type ReactNode, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Carousel, type CarouselSlide } from '../../home/Carousel';
import { DARK_TINT, Glass } from '../../glass';
import { planHome, type Viewer } from '../../home/layout';
import { Icon } from '../../icons';
import { useAds, useFeatured, useOffered, usePromoted } from '../../content';
import { type Event, eventsApi, type Host, hostsOf, toEvent, whereOf } from '../../events';
import { useLoad } from '../../load';
import { hosts as mockHosts } from '../../mock';
import { useUnread } from '../../inboxStore';
import { OrbitAdStrip } from '../../orbitAd';
import { OrbitSays } from '../../orbitSays';
import { refreshPlace, usePlace } from '../../place';
import { meetups, tileFor } from '../../kinds';
import { promoteOne } from '../../labels';
import { EventRow, Failed, HostRow, isPromoted, loveIt, Monogram, Poster, SEAT, SeatCard, Section, StatusLine, Waiting } from '../../rows';
import { bookAction, eventStatus } from '../../status';
import { api, needsAccount, setFollowing, setInterests, skipInterests, useLoved, useTickets, useTicketsOnFocus, useViewer } from '../../session';
import { thanksOf } from '../../tickets';
import { useTabBarScroll, useTabBarSmall } from '../../tabBar';
import { around, color, font, radius, rim, space, stoneAt } from '../../theme';

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
// A text card's 16 in from its edges (owner, 19 Nov 2026: "remember for cards add proper padding"), for the words over
// the promoted card's poster. Home's other text cards are Orbit's bubbles now (OrbitSays). Ticket and All events cards
// keep CARD_INSET, their posters' 8.
const TEXT_PAD = 16;
// Between sections (owner, 19 Nov 2026: "feels like everything was clumpsed. add proper gaps b/w sections"): 40, as
// Search's sections, Orbit's strips and the promoted card already had; a heading is 16 above what it heads.
const SECTION = 40;

// Home B ("Orbit"), picked by the owner on 15 Nov 2026: the boards are on the Orbit canvas. Which blocks show
// comes from planHome (src/home/layout.ts); the state to look at is `viewer` in src/mock.ts.
// No icons inside cards (owner). The location opens the location screen (src/app/location.tsx); events open their page
// (src/app/event/[slug].tsx) and hosts theirs (src/app/host/[slug].tsx), and the profile opens Account
// (src/app/account). Signed out (src/session.ts), Home has no tickets or orbit and the profile shows a person outline;
// Follow asks to sign in first, then follows.
export default function Home() {
  const insets = useSafeAreaInsets();
  const onTabScroll = useTabBarScroll(); // shrinks the tab bar on the way down
  const { width } = useWindowDimensions();
  const signed = useViewer();
  const v: Viewer = { ...signed, place: usePlace() }; // the place chosen on the location screen, if any
  useEffect(() => {
    refreshPlace(); // once a launch, only if location is already allowed (src/place.ts)
  }, []);
  // What's coming up from the API, near the place and then the rest (GET /public/discover, src/events.ts); nothing sent
  // with no place, so everything is "elsewhere" and Home says to set a location.
  const where = whereOf(v.place);
  const page = useLoad(JSON.stringify(where), () => eventsApi(api).discover(where), { keep: true }); // keep: a new place never blanks the page
  const now = Date.now();
  // Your tickets (GET /me/tickets): an event you booked that discover doesn't list (link-only, or far away) still
  // joins Home's ticket stack; planHome keeps booked events out of every other section.
  useTicketsOnFocus();
  const mine = useTickets().data;
  const booked = (mine?.upcoming ?? []).map((t) => t.event);
  // Thanks for coming: the events you were let in at that ended in the last week (src/tickets.ts thanksOf).
  const went = thanksOf(mine, now);
  const listed = page.data ? [...page.data.near, ...page.data.elsewhere] : [];
  // Offline before discover's first answer, the tickets kept on the phone still draw the stack.
  const extra = [...new Map(booked.filter((c) => !listed.some((x) => x.id === c.id)).map((c) => [c.id, c])).values()];
  const events = [
    ...(page.data ? [...page.data.near.map((c) => toEvent(c, true)), ...page.data.elsewhere.map((c) => toEvent(c, false))] : []),
    ...extra.map((c) => toEvent(c, false)),
  ];
  // The hosts of those events, and the mock's places to play.
  // ponytail: Places to play stay on the mock venue hosts (with tileFor) until slots reach the API (P17).
  const apiHosts = hostsOf(listed);
  // Their nearness the old way (Hyderabad only), since the API doesn't know them.
  const hyderabad = v.place?.area === 'Hyderabad' || v.place?.city === 'Hyderabad';
  const hosts = [...apiHosts, ...mockHosts.filter((h) => tileFor(h.id)).map((h) => ({ ...h, near: hyderabad }))];
  const ticketHosts = hostsOf([...extra, ...went]);
  const hostOf = (id: string) => (apiHosts.find((h) => h.id === id) ?? ticketHosts.find((h) => h.id === id) ?? mockHosts.find((h) => h.id === id)) as Host;
  // Staff's picks from Galaxy's App content (src/content.ts): the events marked Promoted, the carousel's featured
  // slides, and Orbit's own strips.
  const promoted = usePromoted();
  const featured = useFeatured();
  const ads = useAds('home');
  const boosted = (e: Event) => isPromoted(e, hostOf(e.hostId), promoted, now);
  const plan = planHome(v, events, hosts.map((h) => ({ ...h, tile: tileFor(h.id) })), now, boosted, featured);
  const ticketOf = (id: string) => v.tickets?.find((t) => t.eventId === id);

  const headerTop = insets.top + 4;
  const posterTop = headerTop + HEADER + 4;
  const card = (width - 40 - space.big) / 2; // All events and host cards: two columns on the 20px margins, a big gap apart
  const slides: CarouselSlide[] = plan.slides.map((s, i) =>
    s.kind === 'event'
      ? { key: `e:${s.event.id}`, image: s.event.wide!.source, edge: s.event.wide!.edge, label: `${s.event === plan.lead ? 'Promoted. ' : ''}Poster for ${s.event.title}`, action: slideAction(s.event, now), href: `/event/${s.event.slug}`, mark: s.event === plan.lead ? 'Promoted' : undefined }
      : s.kind === 'host'
        ? { key: `h:${s.host.id}`, image: s.host.banner!.source, edge: s.host.banner!.edge, label: `Banner for ${s.host.name}`, action: 'View events', href: `/host/${s.host.slug}` }
        : // Orbit's own image slide: no mark (not a host's paid boost). A pill only with somewhere to go: its words, or
          // "Open"; with nowhere to go it's a still picture.
          { key: `c:${i}:${s.custom.image}`, image: { uri: s.custom.image }, edge: s.custom.edge!, label: s.custom.label!, action: s.custom.href ? (s.custom.action ?? 'Open') : undefined, href: s.custom.href },
  );


  // The ticket stack opens to show every ticket (owner, 15 Nov 2026: "need option to see the other tickets").
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const toggleTickets = () => setTicketsOpen((open) => !open);
  const ticketsAction =
    plan.tickets.length > 1 ? { label: ticketsOpen ? 'Show less' : `See all ${plan.tickets.length}`, onPress: toggleTickets } : undefined;

  // Your tickets, drawn with discover's events, or alone before its first answer (offline, from the phone's copies).
  const ticketStack = plan.tickets.length > 0 && (
    <>
      <Section top={SECTION} title="Your tickets" />
      <Stack
        items={plan.tickets}
        height={TICKET_FACE + 2 * FRAME}
        open={ticketsOpen}
        onOpen={ticketsAction && !ticketsOpen ? toggleTickets : undefined}
        openLabel={`Show all ${plan.tickets.length} tickets`}
        render={(e) => <TicketCard event={e} host={hostOf(e.hostId)} label={ticketOf(e.id)?.label ?? ''} ticketId={ticketOf(e.id)?.id} />}
      />
      {/* Under the stack (owner: "move see all to the bottom of stack"). */}
      {ticketsAction && (
        <Pressable onPress={ticketsAction.onPress} accessibilityRole="button" hitSlop={10} style={styles.stackToggle}>
          <Glass style={styles.stackToggleGlass} tint={DARK_TINT}>
            <Text style={styles.stackToggleText}>{ticketsAction.label}</Text>
          </Glass>
        </Pressable>
      )}
    </>
  );

  const hostCards = (
    <View style={styles.grid}>
      {plan.hosts.map((h) => (
        <HostCard key={h.id} host={h} width={card} following={v.follows.includes(h.id)} />
      ))}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false} // no side scroll line (owner, 15 Nov 2026)
        // Clear of the tab bar: under the tabs the bottom safe area includes it ((tabs)/_layout.tsx).
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        scrollEventThrottle={16}
        onScroll={onTabScroll}>
        {/* The header is pinned over the page (below); the carousel still starts at the top, under it. */}
        {slides.length ? <Carousel slides={slides} top={posterTop} dark /> : <View style={{ height: headerTop + HEADER }} />}

        {/* Until the first answer: the header and the featured slides above, then an empty ground, or the failure with a
            way to retry. */}
        {/* A failed read for a new place, with the last place's events still up: the failure over them. */}
        {page.error && page.data && <Failed message={page.error.message} retry={page.reload} />}
        {!page.data && ticketStack}
        {!page.data && <View style={{ marginTop: SECTION }}>{page.loading || !page.error ? <Waiting /> : <Failed message={page.error.message} retry={page.reload} />}</View>}
        {page.data && (
          <>

        {ticketStack}

        {/* Thanks for coming, for each event you were let in at in the last week, newest first (two at most). */}
        {v.signedIn &&
          // Two in a row read as one thread: the second sits a big gap under the first.
          went.map((c, i) => <Thanks key={c.id} event={toEvent(c, false)} host={hostOf(c.host.id)} top={i ? space.big : SECTION} />)}

        {plan.orbit.length > 0 && (
          <>
            <Section top={SECTION} title="Next from your orbit" />
            <View style={styles.feed}>
              {plan.orbit.map((e) => (
                <FeedRow key={e.id} event={e} host={hostOf(e.hostId)} now={now} />
              ))}
            </View>
          </>
        )}

        {plan.hostsFirst && plan.hosts.length > 0 && (
          <>
            <Section top={SECTION} title="Start your orbit" />
            {hostCards}
          </>
        )}

        {plan.askInterests && <AskInterests />}

        {plan.notice && <Notice kind={plan.notice} area={v.place?.area} />}

        {plan.list.events.length > 0 && (
          <>
            <Section top={SECTION} title={plan.list.title} />
            {/* One promoted event leads the list (Boost); it's still one of the list's own events, never an extra. The
                banner's event is the banner just below, so it isn't a row too. */}
            {promoteOne(plan.list.events.filter((e) => e !== plan.ad), boosted).map((e) => (
              <EventRow key={e.id} event={e} host={hostOf(e.hostId)} now={now} found />
            ))}
          </>
        )}

        {plan.ad && <AdBanner event={plan.ad} host={hostOf(plan.ad.hostId)} width={width - 40} />}

        {plan.places.length > 0 && (
          <>
            <Section top={SECTION} title={plan.near ? 'Places to play near you' : 'Places to play'} />
            <View style={styles.feed}>
              {plan.places.map((h) => (
                <HostRow key={h.id} host={h} />
              ))}
            </View>
          </>
        )}

        {/* Orbit's own ads, as strips at two breaks in the middle, apart from the promoted card above. */}
        {ads[0] && <OrbitAdStrip ad={ads[0]} width={width - 40} />}

        {!plan.hostsFirst && plan.hosts.length > 0 && (
          <>
            <Section top={SECTION} title="Hosts near you" />
            {hostCards}
          </>
        )}

        {/* Only with All events under it, so the two strips never sit back to back at the end of Home. */}
        {plan.all.length > 0 && ads[1] && <OrbitAdStrip ad={ads[1]} width={width - 40} />}

        {plan.all.length > 0 && (
          <>
            <Section top={SECTION} title="All events" />
            <View style={styles.grid}>
              {plan.all.map((e) => <GridCard key={e.id} event={e} width={card} />)}
            </View>
          </>
        )}
          </>
        )}
      </ScrollView>

      {/* Pinned over the page, with nothing behind it: the location and profile are on their own dark glass (owner, 19
          Nov 2026: "as cards are added, remove the header bg in both home and search"; it had glass fading in once the
          page scrolled). The gaps let taps through. */}
      <View style={[styles.bar, { paddingTop: headerTop }]}>
        <Header viewer={v} />
      </View>
    </View>
  );
}

// The location and the profile on the tab bar's dark glass (owner, 19 Nov 2026: "Both" from the Home and Search mockup,
// its Capsule take), so they read the same over every poster; it replaced the Stone and Charcoal switch with each slide.
// The location opens the location screen; the profile opens Account (src/app/account), signed out too.
function Header({ viewer: v }: { viewer: Viewer }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.push('/location')}
        accessibilityRole="button"
        accessibilityLabel={v.place ? `Location: ${[v.place.area, v.place.city].filter(Boolean).join(', ')}. Change location` : 'Set location'}
        style={styles.shrink}
      >
        <Glass tint={DARK_TINT} style={styles.place}>
          <Icon name="pin" size={20} color={color.accent} />
          <View style={styles.shrink}>
            <View style={styles.areaRow}>
              <Text style={[styles.area, styles.shrink]} numberOfLines={1}>{v.place?.area ?? 'Set location'}</Text>
              <Icon name="caretDown" size={12} color={color.secondary} />
            </View>
            <City text={v.place?.city ?? 'Showing everywhere'} />
          </View>
        </Glass>
      </Pressable>
      {v.signedIn && <Bell />}
      <Pressable onPress={() => router.push('/account')} accessibilityRole="button" accessibilityLabel={v.signedIn ? 'Account' : 'Sign in'}>
        <Glass tint={DARK_TINT} style={styles.profileRim}>
          <View style={styles.round}>
            {v.signedIn && v.initial ? <Text style={styles.initial}>{v.initial}</Text> : <Icon name="user" size={20} color={color.text} />}
          </View>
        </Glass>
      </Pressable>
    </View>
  );
}

// Notifications (src/app/inbox.tsx), signed in only: a bell on the same dark glass, beside the profile, with a Sage dot
// while anything is unread (owner, 19 Nov 2026: "Rows, bell in header").
function Bell() {
  const unread = useUnread();
  return (
    <Pressable onPress={() => router.push('/inbox')} accessibilityRole="button" accessibilityLabel={unread ? 'Notifications, new' : 'Notifications'} style={styles.bell}>
      <Glass tint={DARK_TINT} style={styles.bellGlass}>
        <Icon name="bell" size={22} color={color.text} />
      </Glass>
      {unread && <View style={styles.unread} />}
    </Pressable>
  );
}

// The city line folds away while the tab bar is small, and back with it, inside the bar's own LayoutAnimation.
function City({ text }: { text: string }) {
  return useTabBarSmall() ? null : <Text style={styles.city} numberOfLines={1}>{text}</Text>;
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
function TicketCard({ event: e, host, label, ticketId }: { event: Event; host: Host; label: string; ticketId?: string }) {
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
              onPress={() => ticketId && router.push(`/ticket/${ticketId}`)}
              disabled={!ticketId}
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

// "Next from your orbit" (owner, 15 Nov 2026: host feed rows; 19 Nov: picked "Logo on poster" from the section takes):
// one plain row per followed host, its next event's 3:4 poster with the host's 1:1 logo seated on the poster's corner,
// so the row reads like an event row: the host as a small grey label, the title, the date, then the status as a dot
// and words (StatusLine). 20 between rows, no rules. Not a card, but kept icon-free like one.
function FeedRow({ event: e, host, now }: { event: Event; host: Host; now: number }) {
  return (
    <Pressable
      onPress={() => router.push(`/event/${e.slug}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.feedRow, pressed && styles.pressed]}>
      <View>
        <Poster media={e.poster} width={60} label={e.title} />
        {/* A ring of the page round the logo, so it reads as sitting on the poster's corner. */}
        <View style={styles.logoOnPoster}>
          <Monogram mark={host} size={24} />
        </View>
      </View>
      <View style={[styles.grow, styles.feedText]}>
        <Text style={styles.feedHost} numberOfLines={1}>{host.name}</Text>
        <Text style={styles.feedTitle} numberOfLines={2}>{e.title}</Text>
        <Text style={styles.feedWhen}>{e.when}</Text>
        <StatusLine event={e} status={eventStatus(e, now)} />
      </View>
    </Pressable>
  );
}

// Hosts as two columns of 4:3 cards, the host's 1:1 logo sitting on the card's top rim (owner, 15 Nov 2026).
// Logos are 1:1 and shown round (Discover decision 13); the monogram stands in until real logos exist. A card, so no
// icons. Same face and frosted rim as All events.
function HostCard({ host, width, following }: { host: Host; width: number; following: boolean }) {
  return (
    <Pressable onPress={() => router.push(`/host/${host.slug}`)} accessibilityRole="button" accessibilityLabel={host.name}>
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

// An event slide's pill follows its status: Book ticket or Register while open, Join waitlist, else View event.
function slideAction(e: Event, now: number) {
  const book = bookAction(eventStatus(e, now), !e.pricePaise);
  return book.can ? book.label : 'View event';
}

// Thanks for coming (owner, 19 Nov 2026: "After-check-in bits"; Performer and inRoom docs): after an event you were let
// in at, for a week after it ended (X6: a ticket with anyone let in at the door, from GET /me/tickets). A meetup's card opens its room, to see who was there (inRoom 12); any other offers Loved it, and a
// love offers to follow the acts (Performer 10). Orbit says it, as in the chat (owner, 19 Nov 2026: "Both", the Orbit
// speaks take); a love shows as your answer and Orbit's reply, with Take it back to undo it.
function Thanks({ event: e, host, top }: { event: Event; host: Host; top: number }) {
  const loved = useLoved(e.id);
  const title = `Thanks for coming to ${e.title}`;
  if (meetups[e.id]?.inRoom) {
    return (
      <OrbitSays
        top={top}
        title={title}
        text="See who was there, and connect. The room’s open for a week after."
        answers={[{ label: 'See who was there', onPress: () => router.push(`/room/${e.id}`) }]}
      />
    );
  }
  return (
    <OrbitSays
      top={top}
      title={title}
      text={`Loved it? Let ${host.name} know.`}
      then={loved ? { mine: 'Loved it', reply: `${host.name} will hear.` } : undefined}
      answers={[loved ? { label: 'Take it back', onPress: () => loveIt(e.id, false) } : { label: 'Loved it', onPress: () => loveIt(e.id, true) }]}
    />
  );
}

// Home asks once what you like, signed in (owner, 19 Nov 2026: "add interest cards for events", all four), answered
// right here since the Orbit speaks take ("Both", 19 Nov): tap the kinds of event to pick them, then Done saves them
// and the ask goes (picks are held here until then, since the first saved one ends the asking). Not now stops the
// asking; Interests stays on Account for later. The kinds offered are staff's (Galaxy App content, orbit-pm X13).
function AskInterests() {
  const offered = useOffered();
  const [picks, setPicks] = useState<CategorySlug[]>([]);
  const toggle = (slug: CategorySlug) => setPicks((all) => (all.includes(slug) ? all.filter((s) => s !== slug) : [...all, slug]));
  return (
    <OrbitSays
      top={SECTION}
      title="What do you like?"
      text="Pick a few kinds of event and Home puts them first."
      answers={[
        ...offered.flatMap((slug) => categories.filter((c) => c.slug === slug)).map((c) => ({ label: c.label, picked: picks.includes(c.slug), onPress: () => toggle(c.slug) })),
        picks.length > 0 ? { label: 'Done', onPress: () => setInterests(picks) } : { label: 'Not now', onPress: skipInterests },
      ]}
    />
  );
}

// No location, or nothing near it: Home says so and shows everything coming up. Orbit says it, as in the chat (the
// Orbit speaks take, 19 Nov).
function Notice({ kind, area }: { kind: 'noLocation' | 'nothingNear'; area?: string }) {
  const noLocation = kind === 'noLocation';
  return (
    <OrbitSays
      top={SECTION}
      title={noLocation ? 'See what’s near you' : `Nothing near ${area} yet`}
      text={
        noLocation
          ? 'Set your location and Orbit shows what’s within 25 km. Until then, here’s everything coming up.'
          : 'Here’s everything coming up on Orbit instead, soonest first.'
      }
      answers={noLocation ? [{ label: 'Set location', onPress: () => router.push('/location') }] : []}
    />
  );
}

// "All events": two columns of cards with a thin frosted glass rim around each card, the poster on top and
// date, title and price under it (owner, 15 Nov 2026: two columns, smaller, page margins with a 24px gap, a thin
// frosted rim, a card, "apply the rim to card", then "remove padding for poster"). The poster runs edge to edge across
// the top of the card face, which rounds its top corners; only the text is padded. A card, so no icons and no heart.
// The card face and rim use FACE and RIM, like every card.
// A promoted event in the middle of Home (owner, 19 Nov 2026: "even that promoted is good"): one wide card, its 4:3
// poster with Promoted, the date, title, host and price over it ("hover content on poster") on a fade to the ground at
// the bottom. The whole card opens the event. planHome picks it: the second promoted event, the first leading the
// carousel.
function AdBanner({ event: e, host, width }: { event: Event; host: Host; width: number }) {
  const inner = width - 2 * FRAME;
  const tall = (inner * 3) / 4;
  return (
    <Pressable
      onPress={() => router.push(`/event/${e.slug}`)}
      accessibilityRole="button"
      accessibilityLabel={`Promoted. ${e.title}, ${e.when}, by ${host.name}`}
      style={({ pressed }) => [styles.ad, pressed && styles.pressed]}>
      <Glass style={[styles.gridRim, { width }]}>
        <View style={styles.gridCard}>
          <Image source={e.wide!.source} style={{ width: inner, height: tall }} />
          <Svg style={StyleSheet.absoluteFill} width={inner} height={tall} pointerEvents="none">
            <Defs>
              <LinearGradient id="adFade" x1="0" y1="0" x2="0" y2="1">
                {/* Dark by halfway, where the words start on a two-line title, so they read on a light poster too. */}
                <Stop offset={0.25} stopColor={color.ground} stopOpacity={0} />
                <Stop offset={0.5} stopColor={color.ground} stopOpacity={0.72} />
                <Stop offset={1} stopColor={color.ground} stopOpacity={0.94} />
              </LinearGradient>
            </Defs>
            <Rect width={inner} height={tall} fill="url(#adFade)" />
          </Svg>
          <View style={styles.adOver}>
            <View style={styles.adHead}>
              <Glass style={styles.adMark}>
                <Text style={styles.adMarkText}>Promoted</Text>
              </Glass>
              <Text style={styles.adMeta} numberOfLines={1}>{e.when}</Text>
            </View>
            <Text style={styles.adTitle} numberOfLines={2}>{e.title}</Text>
            <Text style={styles.adMeta} numberOfLines={1}>
              {host.name} · {formatPrice(e.pricePaise)}
            </Text>
          </View>
        </View>
      </Glass>
    </Pressable>
  );
}

function GridCard({ event: e, width }: { event: Event; width: number }) {
  return (
    <Pressable onPress={() => router.push(`/event/${e.slug}`)} accessibilityRole="button">
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
  bar: { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  grow: { flex: 1, minWidth: 0 },
  lines: { gap: 3 },

  header: { height: HEADER, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.small },
  // A capsule like the tab bar's, the bar's height (taller with big text); its words hug it, so it narrows when the city
  // folds away, and a long name ends in … before it reaches the profile.
  place: { minHeight: HEADER, paddingVertical: 4, borderRadius: HEADER / 2, paddingLeft: 10, paddingRight: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  shrink: { flexShrink: 1 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  area: { fontFamily: font.headline, fontSize: 15, color: color.text },
  city: { fontFamily: font.text, fontSize: 12, color: color.secondary },
  // A ring like the chat orb's round your own circle.
  profileRim: { width: HEADER, height: HEADER, borderRadius: HEADER / 2, padding: 4 },
  bell: { marginLeft: 'auto' }, // beside the profile, the location keeping the rest
  bellGlass: { width: HEADER, height: HEADER, borderRadius: HEADER / 2, alignItems: 'center', justifyContent: 'center' },
  unread: { position: 'absolute', top: 6, right: 7, width: 10, height: 10, borderRadius: 5, backgroundColor: color.accent, borderWidth: 2, borderColor: color.ground },
  round: { flex: 1, borderRadius: HEADER / 2 - 4, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: font.headline, fontSize: 17, color: color.text },

  stackToggle: { alignSelf: 'center', marginTop: 10 },
  // Very small (owner, 15 Nov 2026); hitSlop keeps the tap target near 44px.
  stackToggleGlass: { height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center' },
  stackToggleText: { fontFamily: font.title, fontSize: 11, color: color.text },

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
  // 20 from the poster to the words: the logo overhangs the poster's corner by 6.
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  feedText: { gap: 3 },
  // The logo's 6 corner plus a 2 ring of the page, 6 over the poster's bottom right.
  logoOnPoster: { position: 'absolute', right: -6, bottom: -6, padding: 2, borderRadius: around(radius.md, 2), backgroundColor: color.ground },
  feedHost: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  feedTitle: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  feedWhen: { fontFamily: font.text, fontSize: 13, color: color.secondary },


  hostCardName: { fontFamily: font.title, fontSize: 14, color: color.text, textAlign: 'center' },
  hostCardAbout: { fontFamily: font.text, fontSize: 11, color: color.secondary, textAlign: 'center' },
  // Fully round, like every action pill (owner: "even follow and following").
  followTap: { marginTop: 'auto', marginBottom: space.small },
  followSmall: { height: 32, paddingHorizontal: 16, borderRadius: 16, justifyContent: 'center' },
  followSmallText: { fontFamily: font.title, fontSize: 13, color: color.text },
  followingText: { color: color.secondary },



  grid: { marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', columnGap: space.big, rowGap: space.big },
  cardRim: { padding: FRAME, borderRadius: RIM },
  gridRim: { padding: FRAME, borderRadius: RIM },
  gridCard: { borderRadius: FACE, backgroundColor: color.card, overflow: 'hidden' },
  gridBody: { padding: CARD_INSET, gap: 2 }, // padded on its own; the 2px is line spacing within the text
  // 40 above, as a section; the poster card's own padding (a poster card keeps 8, not the text cards' 16).
  ad: { marginTop: 40, marginHorizontal: 20 },
  // The words over the promoted poster, a text card's 16 in from its edges.
  adOver: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: TEXT_PAD, gap: 4 },
  adHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adMark: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: 'center' },
  adMarkText: { fontFamily: font.medium, fontSize: 11, color: color.text },
  adTitle: { fontFamily: font.title, fontSize: 18, lineHeight: 23, color: color.text },
  adMeta: { flexShrink: 1, fontFamily: font.text, fontSize: 13, color: stoneAt(0.8) },
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
