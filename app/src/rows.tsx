// Pieces more than one screen draws: the event row and what it's made of, a host's logo, the seat card, the search
// box, section headings, the top glow, and the back bar and not-found view of the pages pushed over the tabs.
import { formatPrice } from '@orbit/contract';
import { router } from 'expo-router';
import { type ComponentProps, type ComponentRef, type ReactNode, useId, useRef, useState } from 'react';
import {
  type Animated,
  Modal,
  Platform,
  Pressable,
  Share,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { BarGlass, DARK_TINT, Glass } from './glass';
import { Icon, type IconName } from './icons';
import { Media, type MediaItem } from './media';
import { acts, fromPricePaise, perHour, venues } from './kinds';
import { type Event, type Host, hosts, now } from './mock';
import { showNote } from './note';
import { followsNow, needsAccount, setFollowing, setLoved, tapSave, useFollowing, useLoved, useSaved, useViewer } from './session';
import { usePromoted } from './content';
import { eventLabel } from './labels';
import { OrbitSays } from './orbitSays';
import { BOOKINGS_OPEN, eventStatus, isNews, rowTag, seatsLine, type Status } from './status';
import { around, color, font, groundAt, radius, rim, space, stoneAt } from './theme';

export const SEAT = 48; // the 1:1 square on a seat card's top rim
// Every card's corners nest outward from its contents' corner (owner, 15 Nov 2026: "Inner Radius = Outer Radius -
// Padding"): a 6px corner and 8px padding make the face 14, the frosted rim 16.
const FACE = around(radius.sm, space.small);
const RIM = around(FACE, rim);

// A plain row (no card), so it keeps its Save star, on the app's frosted glass (owner, 15 Nov 2026). The poster and
// text open the event page; the star stays a target of its own. Its tag is the event's status when that's news (Sold
// out, Almost full, Just announced; rowTag in src/status.ts), else its repeat; `tag` takes their place (a person's
// role on their sheet, a refund); a row that isn't for booking only ever says Cancelled. A cancelled event drops its
// price; a `past` row drops the price and the star, and an event you `went` to gets Loved it's heart in its
// place. `onPress` replaces opening the event the usual way.
// `menu` adds a ⋯ after the star, as saved rows have (Saved events and lists doc: Add to a list, Remove from saved).
// `found` is a row where events are found, Home and Search (owner, 19 Nov 2026: picked "Clean" from the section takes):
// no grey tags. A quiet line on top with the host and its label (Promoted, People’s choice, New on Orbit; src/labels.ts,
// only here, never on your tickets, history or saved lists), the title, the date and area, then the status as a dot and
// words (StatusLine). The price at the top right, the star under it on the tab bar's dark glass. 20 between rows.
// `kicker` false drops that top line (and so the label) on a host's own page, where every row is theirs (its Take 2,
// owner, 19 Nov 2026); a string takes its place, with no label (a person's role there and the host, on their sheet:
// Take 3). A `past` found row drops the price and star, keeping Loved it for one you `went` to.
export function EventRow({
  event: e,
  host,
  tag,
  past = false,
  went = false,
  found = false,
  kicker = true,
  menu,
  onPress = () => router.push(`/event/${e.id}`),
}: {
  event: Event;
  host: Host;
  tag?: string;
  past?: boolean;
  went?: boolean;
  found?: boolean;
  kicker?: boolean | string;
  menu?: MenuAction[];
  onPress?: () => void;
}) {
  const st = eventStatus(e, now);
  const promoted = usePromoted();
  if (found) {
    const label = kicker === true ? eventLabel({ promoted: promoted.has(e.id) }, host, st, now) : undefined;
    const kick = typeof kicker === 'string' ? kicker : [host.name, label].filter(Boolean).join(' · ');
    return (
      <View style={[styles.row, styles.foundRow]}>
        <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.grow, styles.rowLink, styles.foundLink, pressed && styles.pressed]}>
          <Poster media={e.poster} width={64} label={e.title} />
          <View style={[styles.grow, styles.foundLines]}>
            {kicker !== false && <Text style={styles.kick} numberOfLines={1}>{kick}</Text>}
            <Text style={styles.rowTitle} numberOfLines={2}>{e.title}</Text>
            <Text style={styles.meta} numberOfLines={1}>{e.when} · {e.area}</Text>
            {/* A row that isn't for booking (past, or your ticket's) only ever says Cancelled (rowTag's rule). */}
            {(!past || st.kind === 'cancelled') && <StatusLine event={e} status={st} />}
          </View>
        </Pressable>
        <View style={styles.side}>
          {!past && st.kind !== 'cancelled' && <Text style={styles.sidePrice}>{formatPrice(e.pricePaise)}</Text>}
          {past ? went && <LoveButton event={e} dark /> : <SaveButton event={e} dark />}
        </View>
      </View>
    );
  }
  const shown = rowTag(st, e.repeats, !past, tag);
  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.grow, styles.rowLink, pressed && styles.pressed]}>
        <Poster media={e.poster} width={60} label={e.title} />
        <View style={[styles.grow, styles.lines]}>
          <View style={styles.whenRow}>
            <Text style={styles.meta}>{e.when}</Text>
            {shown && <Tag text={shown} />}
          </View>
          <Text style={styles.rowTitle}>{e.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{host.name} · {e.area}</Text>
          {!past && st.kind !== 'cancelled' && <Price event={e} status={st} />}
        </View>
      </Pressable>
      {past ? went && <LoveButton event={e} /> : <SaveButton event={e} />}
      {menu && <MenuButton actions={menu} label={`More for ${e.title}`} anchored />}
    </View>
  );
}

// An event's status as a dot and words, or its repeat, with the seats left ("Almost full · 8 seats left"): the quiet line
// on found rows and Home's orbit rows, in place of grey tags. Nothing when there's nothing to say.
export function StatusLine({ event: e, status: st }: { event: Event; status: Status }) {
  const news = isNews(st);
  const words = [news ? st.short : e.repeats, seatsLine(e, st)].filter(Boolean).join(' · ');
  if (!words) return null;
  return (
    <View style={styles.statusLine}>
      {news && <StatusDot tone={st.tone} />}
      <Text style={[styles.small, styles.shrink]} numberOfLines={1}>{words}</Text>
    </View>
  );
}

// A place to play or a host as one row with its button (owner, 19 Nov 2026: picked "With a button" from the section
// takes): the logo, the name, its line and a place's cheapest hour; on the right Book for a place (its slot sheet, after
// signing in, as the host page's Book a slot) or Follow / Following for a host. The rest of the row opens its page.
// Home's Places to play, and Search's Places to play, New on Orbit and the hosts it finds.
export function HostRow({ host }: { host: Host }) {
  const venue = venues[host.id];
  const following = useViewer().follows.includes(host.id);
  // While bookings are off (src/status.ts) a place to play offers Follow, as any host.
  const action = venue && BOOKINGS_OPEN
    ? { label: 'Book', run: () => router.push(`/slot/${host.id}`) }
    : { label: following ? 'Following' : 'Follow', run: () => setFollowing(host.id, !following) };
  return (
    <View style={styles.hostRow}>
      <Pressable
        onPress={() => router.push(`/host/${host.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${host.name}, ${host.about}`}
        style={({ pressed }) => [styles.grow, styles.rowLink, pressed && styles.pressed]}>
        <Monogram mark={host} size={44} />
        <View style={[styles.grow, styles.hostLines]}>
          <Text style={styles.rowTitle} numberOfLines={1}>{host.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>{host.about}</Text>
          {venue && <Text style={styles.from}>From {perHour(fromPricePaise(venue))}</Text>}
        </View>
      </Pressable>
      <Pressable onPress={() => needsAccount(action.run)} accessibilityRole="button" accessibilityLabel={`${action.label}, ${host.name}`} hitSlop={6}>
        <Glass style={styles.smallPill}>
          <Text style={[styles.smallPillText, action.label === 'Following' && styles.mutedText]}>{action.label}</Text>
        </Glass>
      </Pressable>
    </View>
  );
}

// A host with Follow, as a row: the 1:1 logo, the name with its tick, one `line`, and Follow / Following on the right
// (signed out, sign in first). `onPress` opens the host. The event page's Hosted by and a fest item's On stage (the
// detail pages' Takes 1 and 3, owner, 19 Nov 2026), as Home's and Search's host rows. No margins: a page sets them.
export function FollowRow({ host, line, onPress }: { host: Host; line: string; onPress: () => void }) {
  const following = useFollowing(host.id);
  return (
    <View style={styles.hostRow}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${host.name}${host.verified ? ', verified' : ''}, ${line}`}
        style={({ pressed }) => [styles.grow, styles.rowLink, pressed && styles.pressed]}>
        <Monogram mark={host} size={44} />
        <View style={[styles.grow, styles.hostLines]}>
          <View style={styles.nameRow}>
            <Text style={[styles.rowTitle, styles.shrink]} numberOfLines={1}>{host.name}</Text>
            {host.verified && <Verified size={16} />}
          </View>
          <Text style={styles.meta} numberOfLines={1}>{line}</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => needsAccount(() => setFollowing(host.id, !following))}
        accessibilityRole="button"
        accessibilityLabel={`${following ? 'Following' : 'Follow'}, ${host.name}`}
        hitSlop={6}>
        <Glass style={styles.smallPill}>
          <Text style={[styles.smallPillText, following && styles.mutedText]}>{following ? 'Following' : 'Follow'}</Text>
        </Glass>
      </Pressable>
    </View>
  );
}

/**
 * An event's label right now (src/labels.ts), and whether it's Promoted, so a list can move it up (promoteOne).
 * `promoted` is the ids staff marked Promoted in Galaxy's App content (usePromoted in src/content.ts).
 */
export const labelOf = (e: Event, host: Host, promoted: ReadonlySet<string>) =>
  eventLabel({ promoted: promoted.has(e.id) }, host, eventStatus(e, now), now);
export const isPromoted = (e: Event, host: Host, promoted: ReadonlySet<string>) => labelOf(e, host, promoted) === 'Promoted';

function Price({ event: e, status }: { event: Event; status: Status }) {
  const seats = seatsLine(e, status);
  return (
    <View style={styles.priceRow}>
      <Text style={styles.price}>{formatPrice(e.pricePaise)}</Text>
      {seats && <Text style={styles.small}>{seats}</Text>}
    </View>
  );
}

// `corner` 0 for a poster that runs to a card's edge, where the card's own corners round it.
export function Poster({ media, width, label, corner = radius.sm }: { media: MediaItem; width: number; label: string; corner?: number }) {
  return (
    <View style={[styles.poster, { width, borderRadius: corner }]}>
      <Media media={media} label={`Poster for ${label}`} />
    </View>
  );
}

// A host's 1:1 logo (the monogram stands in until real logos exist). Rounded squares, not circles, for every 1:1
// image in the app: logos and people photos (owner, 15 Nov 2026: "use squares for 1:1 instead of circles").
// `mark` is a host, or anything with initials and colours (a category on Search).
// `round` is a person's photo, yours or anyone's, a circle (owner, 17 Nov 2026: "instead of squared profile use rounded
// one", then "round them too"); hosts' logos stay rounded squares.
export function Monogram({ mark, size, round = false }: { mark: Pick<Host, 'initials' | 'bg' | 'fg'>; size: number; round?: boolean }) {
  return (
    <View style={[styles.monogram, { width: size, height: size, borderRadius: round ? size / 2 : radius.md, backgroundColor: mark.bg }]}>
      <Text style={[styles.monogramText, { color: mark.fg, fontSize: Math.round(size * 0.34) }]}>{mark.initials}</Text>
    </View>
  );
}

// A 4:3 card with a 1:1 square seated on its top rim: hosts on Home (owner, 15 Nov 2026: "hosts near you, 4:3 card with
// 1:1 logo on top rim") and categories on Search ("in boxes same as hosts in home"). Card face and thin frosted rim like
// every card; the square sits half over the top edge. `seat` is a monogram, `size` across, in a frosted dome; or, with
// `dome` off, a prop on its own (Search's categories). `tint` makes the face that colour glowing from the bottom centre
// into the page's ground (owner, 15 Nov 2026: "update the card color to gradiant of Colour + App BG",
// then "card bg - dont use linear gradiants"), after tinted glass read as opaque.
export function SeatCard({
  width,
  seat,
  size = SEAT,
  dome = true,
  tint,
  children,
}: {
  width: number;
  seat: ReactNode;
  size?: number;
  dome?: boolean;
  tint?: string;
  children: ReactNode;
}) {
  const face = width - 2 * rim;
  const box = size + 2 * rim;
  const left = (width - box) / 2;
  return (
    <View style={{ width, paddingTop: box / 2 }}>
      <Glass style={styles.cardRim}>
        <View style={[styles.seatFace, { height: (face * 3) / 4, paddingTop: size / 2 + space.small }]}>
          {tint && <FaceWash tint={tint} />}
          {children}
        </View>
      </Glass>
      {/* The rim runs on over the square's top half (owner: "apply the rim to half top of logo"): a frosted rounded
          square the rim's width bigger than it, clipped to the half above the card, with the square seated in it. */}
      {dome && (
        <View style={[styles.domeClip, { left, width: box, height: box / 2 }]}>
          <Glass style={{ width: box, height: box, borderRadius: around(radius.md, rim) }} />
        </View>
      )}
      <View style={[styles.seat, { left: left + rim, top: rim }]}>{seat}</View>
    </View>
  );
}

// The search box, on Search and the location screen: a frosted pill like every control, so whatever is behind it shows
// through (owner, 15 Nov 2026: "also squared search", "search box bg is odd. blend everything and fix", then "in
// location screen, update the search box"). Takes the TextInput's props; `style` places the box, `tint` darkens its glass
// (Search's, on the tab bar's dark glass since 19 Nov 2026).
export const SEARCH_BOX = 44;
export function SearchBox({ style, tint, ...input }: Omit<TextInputProps, 'style'> & { style?: StyleProp<ViewStyle>; tint?: string }) {
  return (
    <Glass style={[styles.searchBox, style]} tint={tint}>
      <Icon name="search" size={18} color={color.secondary} />
      <TextInput
        style={styles.searchInput}
        placeholderTextColor={color.secondary}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        keyboardAppearance="dark"
        {...input}
      />
    </Glass>
  );
}

// A radial glow, not a linear fade: the colour at 75% from the bottom centre out to the ground (owner, 15 Nov 2026:
// "fip the card tint top and bottom"; it glowed from the top, behind the prop, before). The event page's cards use it
// faintly, in the poster's colour (`opacity`, and `corner` for their bigger face).
// Pinned to the face's four edges by its wrapper: sized 100% itself, it measured the face less its padding, so it
// filled only an inset box and stopped short of the bottom (owner's screenshot, 15 Nov 2026: "the card tint has an
// issue").
export function FaceWash({ tint, opacity = 0.75, corner = FACE }: { tint: string; opacity?: number; corner?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={styles.wash}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="0.5" cy="1" r="0.9">
            <Stop offset={0} stopColor={tint} stopOpacity={opacity} />
            <Stop offset={1} stopColor={tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" rx={corner} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

// Titles only, no descriptions under them (owner, 15 Nov 2026); 16 down to their content ("add gap after Your Tickets
// and apply to all"). `top` is the gap above, a big gap unless a screen spaces its sections wider (Home's 40).
// Home's and Search's gap between sections (owner, 19 Nov 2026: "add proper gaps b/w sections"), on the detail pages too.
export const SECTION = 40;
export function Section({ title, top = space.big }: { title: string; top?: number }) {
  return (
    <View style={[styles.section, { marginTop: top }]}>
      <Text style={styles.h2} accessibilityRole="header">{title}</Text>
    </View>
  );
}

// A colour from the top of the screen, fading into the page by GLOW: the accent on Search (owner, 15 Nov 2026: "add
// accent from top"), the host's own colour on its event and host pages, so a host's pages read as theirs. A wash
// fixed behind the page, never on text. Put it first in the screen.
const GLOW = 320;
const GLOW_STOPS = [
  [0, 0.35],
  [0.45, 0.12],
  [1, 0],
] as const; // [offset, opacity]
export function Glow({ tint = color.accent }: { tint?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width="100%" height={GLOW} style={styles.glow}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {GLOW_STOPS.map(([offset, opacity]) => (
            <Stop key={offset} offset={offset} stopColor={tint} stopOpacity={opacity} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

// Back, or Home when a link opened the page with nothing under it.
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

// The pinned bar on pages pushed over the tabs (event and host): a frosted back circle, as every icon-only button, with
// Home's glass fading in behind it once the page scrolls under (BarGlass). Nothing behind it at the top of the page,
// even over a poster (owner, 15 Nov 2026: "Remove the shade"). Put it last in the screen. TOP is how far down the page's
// content starts under it, after the top safe area; BAR is the bar's bottom.
export const BAR = 4 + 44;
export const TOP = BAR + space.small;
// `children` sit on the right: the page's own circles, such as Save and the menu (owner, 15 Nov 2026: "add top right,
// love and menu").
// `dark`: the circles on the tab bar's dark glass with nothing behind the bar, as Home's and Search's controls since
// "Both" (owner, 19 Nov 2026: "remove the header bg in both home and search"); the event page since its Take 1. Without
// `scrollY` no glass fades in behind it.
export function BackBar({ scrollY, dark = false, children }: { scrollY?: Animated.Value; dark?: boolean; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.backBar, { paddingTop: insets.top + 4 }]}>
      {scrollY && <BarGlass scrollY={scrollY} />}
      <CircleButton icon="back" label="Back" onPress={goBack} tint={dark ? DARK_TINT : undefined} />
      {children && <View style={styles.barRight}>{children}</View>}
    </View>
  );
}

// The star, Save, on every upcoming event row and the event page (`bar`, a 44pt circle like its neighbours; a heart
// until 19 Nov 2026, owner: "saved love with star"). One tap saves and opens the list modal; on a saved event it opens
// the modal, where Remove from saved unsaves (src/session.ts; owner, 16 Nov 2026: "instead of toast use modal, when
// clicked on love"). Signed out, the sign-in sheet comes first. Filled Stone when saved, else the duotone outline. It
// says what a tap will do, its state exposed to screen readers (Saved events and lists doc).
export function SaveButton({ event: e, bar = false, dark = false }: { event: Pick<Event, 'id' | 'title'>; bar?: boolean; dark?: boolean }) {
  const saved = useSaved(e.id);
  return (
    <Pressable
      onPress={() => tapSave(e.id, !saved)}
      style={bar ? undefined : styles.rowCircle}
      hitSlop={bar ? 4 : 0}
      accessibilityRole="button"
      accessibilityLabel={saved ? `Saved, ${e.title}` : `Save ${e.title}`}
      accessibilityHint={saved ? 'Opens its lists and Remove from saved' : 'Saves it and opens your lists'}
      accessibilityState={{ selected: saved }}>
      <Glass style={bar ? styles.backGlass : styles.rowGlass} tint={dark ? DARK_TINT : undefined}>
        <Icon name={saved ? 'starFill' : 'star'} size={20} color={color.text} />
      </Glass>
    </Pressable>
  );
}

// Loved it, or taking it back; signed out, sign in first. After a love, one tap follows the acts on the bill you don't
// follow yet (Performer 10: the ticket offers Follow for each act), as a note at the bottom.
export function loveIt(eventId: string, on: boolean) {
  needsAccount(() => {
    setLoved(eventId, on);
    const unfollowed = on ? (acts[eventId] ?? []).filter((id) => !followsNow().includes(id)) : [];
    const names = unfollowed.map((id) => hosts.find((h) => h.id === id)?.name).filter(Boolean);
    if (names.length) {
      showNote({
        text: `Loved it. Follow ${names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ')}?`,
        action: { label: 'Follow', run: () => unfollowed.forEach((id) => setFollowing(id, true)) },
        ms: 6000,
      });
    }
  });
}

// "Loved it", the heart, on an event you went to, once it's over (owner, 19 Nov 2026: "replace the love with loved
// it"): on its History row and in place of Save on its page. A tap says you loved it, red; another takes it back.
// Signed out, it asks to sign in first. `dark` as SaveButton's.
export function LoveButton({ event: e, bar = false, dark = false }: { event: Pick<Event, 'id' | 'title'>; bar?: boolean; dark?: boolean }) {
  const loved = useLoved(e.id);
  return (
    <Pressable
      onPress={() => loveIt(e.id, !loved)}
      style={bar ? undefined : styles.rowCircle}
      hitSlop={bar ? 4 : 0}
      accessibilityRole="button"
      accessibilityLabel={loved ? `Loved it, ${e.title}` : `Loved it? ${e.title}`}
      accessibilityHint={loved ? 'Takes your Loved it back' : 'Says you loved it'}
      accessibilityState={{ selected: loved }}>
      <Glass style={bar ? styles.backGlass : styles.rowGlass} tint={dark ? DARK_TINT : undefined}>
        {loved ? <Icon name="heartFill" size={20} color={color.love} /> : <Icon name="heart" size={20} color={color.text} />}
      </Glass>
    </Pressable>
  );
}

// A frosted 44pt circle holding one icon, as every icon-only button in a bar (owner, 15 Nov 2026: "never use squared
// buttons"). Without `onPress` it isn't a button yet and only says what it is.
// `children` replaces the icon, for one that changes, like a saved event's star. `tint`: the dark glass (DARK_TINT).
export function CircleButton({
  icon,
  label,
  onPress,
  tint,
  children,
}: {
  icon?: IconName;
  label: string;
  onPress?: () => void;
  tint?: string;
  children?: ReactNode;
}) {
  const face = <Glass style={styles.backGlass} tint={tint}>{children ?? (icon && <Icon name={icon} size={20} color={color.text} />)}</Glass>;
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}>
      {face}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label}>
      {face}
    </View>
  );
}

// The phone's share sheet with a line about the thing and its link on the website (Discover doc, Links and sharing:
// "Open Mic Night · Fri 21 Nov, 8 pm · Jubilee Hills · ₹299" and the link). `path` is "/event/<slug>" or "/host/<slug>".
export const shareLink = (line: string, path: string) => Share.share({ message: `${line}\nhttps://heyorbit.in${path}` });

// A page's ⋯ button and its dropdown (owner, 15 Nov 2026: "instead of alert menu use dropdown menu"): a frosted panel
// opening just under the button at the bar's right end, darkened like the bars so its white labels read over a poster.
// Its corners nest round the items' (6 + the small gap = 14). A tap outside closes it; an item closes it, then runs, so
// a share sheet never opens over the closing menu. An action without `onPress` isn't built yet and only closes it.
// Each item has its icon on the right of its label, as iOS's own pull-down menus do (owner: "add icons in menu").
// React Native's own Modal, so no native module: expo-router's native menus open only from a long press on a link or
// from the system header, and these pages draw their own.
// `anchored`, on a row: a 36pt circle like the row's star, its menu opening under it, or over it near the bottom.
export type MenuAction = { label: string; icon: IconName; onPress?: () => void };
// `tint`: the bar's circle on the dark glass (DARK_TINT), as the event page's.
export function MenuButton({
  actions,
  label = 'More',
  anchored = false,
  tint,
}: {
  actions: MenuAction[];
  label?: string;
  anchored?: boolean;
  tint?: string;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const button = useRef<ComponentRef<typeof View>>(null);
  const show = () => {
    if (!anchored) return setOpen(true);
    button.current?.measureInWindow((_x, y, _w, h) => {
      const tall = actions.length * 44 + 2 * space.small;
      const below = y + h + space.small;
      setTop(below + tall > height - insets.bottom - space.big ? y - space.small - tall : below);
      setOpen(true);
    });
  };
  const picked = useRef<(() => void) | undefined>(undefined);
  const run = () => {
    const action = picked.current;
    picked.current = undefined;
    action?.();
  };
  const pick = (a: MenuAction) => {
    picked.current = a.onPress;
    setOpen(false);
    if (Platform.OS !== 'ios') run(); // iOS runs it once the menu has gone (onDismiss)
  };
  return (
    <>
      {anchored ? (
        <Pressable ref={button} onPress={show} style={styles.rowCircle} accessibilityRole="button" accessibilityLabel={label}>
          <Glass style={styles.rowGlass}>
            <Icon name="more" size={20} color={color.text} />
          </Glass>
        </Pressable>
      ) : (
        <CircleButton icon="more" label={label} onPress={show} tint={tint} />
      )}
      {/* Under the status bar on Android too, so `top` is measured from the screen's top as on iOS. */}
      <Modal
        transparent
        statusBarTranslucent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        onDismiss={run}>
        <Pressable style={styles.menuScrim} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />
        <View style={[styles.menu, { top: anchored ? top : insets.top + BAR + space.small }]} accessibilityViewIsModal>
          <Glass style={styles.menuFill} />
          <View style={[styles.menuFill, styles.menuShade]} />
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => pick(a)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
              <Text style={styles.menuText}>{a.label}</Text>
              <Icon name={a.icon} size={20} color={color.text} />
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}

// The frosted glass every modal sits on (owner, 15 Nov 2026: "modal is glass one ( same as cta )", then "Glass for
// all"): the ticket bar's glass, darkened by the ground at half. It runs BLEED past its frame's bottom, so a sheet that
// is a little taller than what's in it shows no line where the glass stops (owner: "in venue modal why bottom divider
// ?"); the sheet clips it. Put it first in the modal's frame, which paints no background of its own (its screen's
// contentStyle is transparent, src/app/_layout.tsx).
const BLEED = 200;
export function GlassFill() {
  return (
    <>
      <Glass style={styles.glassFill} />
      <View style={[styles.glassFill, styles.glassShade]} />
    </>
  );
}

// A modal's frame (venue, agenda, FAQ, terms), on the glass: its title, an optional grey line under it, and an X on
// top, then what's in it. The short venue sheet fits its contents, so nothing in it may stretch; a `full` modal fills
// the screen like the person and location sheets: a gap at its top on iOS, clear of the status bar on Android.
export function Sheet({ title, note, full = false, children }: { title: string; note?: string; full?: boolean; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const top = full && Platform.OS !== 'ios' ? insets.top + space.small : space.big;
  return (
    <View style={[styles.sheet, full && styles.fullSheet, { paddingTop: top, paddingBottom: Math.max(insets.bottom, space.big) }]}>
      <GlassFill />
      <View style={styles.sheetHead}>
        <View style={styles.grow}>
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {title}
          </Text>
          {note && <Text style={styles.sheetNote}>{note}</Text>}
        </View>
        <CloseButton />
      </View>
      {children}
    </View>
  );
}

// Orbit's bubble inside a Sheet, which already has the page's margins: the booking sheets' rules, notes and answers
// (the Tickets and Slot sheets' Takes 4 and 5, owner, 19 Nov 2026).
export function SheetSays(props: Omit<ComponentProps<typeof OrbitSays>, 'top'>) {
  return (
    <View style={styles.sheetSays}>
      <OrbitSays top={0} {...props} />
    </View>
  );
}

// A host talking, in the chat's bubble with its 1:1 logo at the foot, as Orbit's are (src/orbitSays.tsx) but from the
// host: the FAQ's answers (the detail pages' Take 3) and a ticket's announcement (Take 7), with `line` (who and when)
// above it. No margins: a page sets them.
export function HostSays({ host, text, line }: { host: Pick<Host, 'initials' | 'bg' | 'fg'>; text: string; line?: string }) {
  return (
    <View>
      {line && <Text style={[styles.kick, styles.saysLine]}>{line}</Text>}
      <View style={styles.saysRow}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Monogram mark={host} size={28} />
        </View>
        <View style={styles.theirs}>
          <Text style={styles.saysText}>{text}</Text>
        </View>
      </View>
    </View>
  );
}

// A page whose link names nothing on Orbit (a stale or mistyped link): one line and a way back.
export function NotFound({ what }: { what: string }) {
  return (
    <View style={styles.missing}>
      <Text style={styles.missingTitle}>{`This ${what} isn’t on Orbit`}</Text>
      <Text style={styles.missingText}>It may have been taken down, or the link has a typo.</Text>
      <Pressable onPress={goBack} accessibilityRole="button">
        <Glass style={styles.wideButton}>
          <Text style={styles.buttonText}>Go back</Text>
        </Glass>
      </Pressable>
    </View>
  );
}

// A page whose request failed: the API's own message, which says what to do, and Try again. A link to something that
// isn't there (404) is NotFound instead. A whole mode that failed (Console) also offers Back to Home, since its own tabs,
// and the re-tap on Home, aren't drawn.
export function Failed({ message, retry, home = false }: { message: string; retry: () => void; home?: boolean }) {
  return (
    <View style={styles.missing}>
      <Text style={styles.missingText}>{message}</Text>
      {[
        { label: 'Try again', onPress: retry },
        ...(home ? [{ label: 'Back to Home', onPress: () => router.dismissAll() }] : []),
      ].map((b) => (
        <Pressable key={b.label} onPress={b.onPress} accessibilityRole="button">
          <Glass style={styles.wideButton}>
            <Text style={styles.buttonText}>{b.label}</Text>
          </Glass>
        </Pressable>
      ))}
    </View>
  );
}

// The empty ground while a page's first answer is on its way, usually well under a second.
export const Waiting = () => <View style={styles.missing} />;

// The tick beside a verified host's name, in place of the word (owner, 15 Nov 2026: "instead verified use tick mark
// beside, where unverified stays unverified"), filled ("also use filled verifed instead of duotone"): Phosphor's filled
// seal in the accent, an element, never text. Its check is cut out of the seal, so a white disc behind it, half the
// seal across and hidden by the seal everywhere else, makes the check white.
export function Verified({ size = 18 }: { size?: number }) {
  return (
    <View style={[styles.verified, { width: size, height: size }]} accessible accessibilityRole="image" accessibilityLabel="Verified">
      <View style={[styles.verifiedDisc, { width: size / 2, height: size / 2, borderRadius: size / 4 }]} />
      <Icon name="verified" size={size} color={color.accent} />
    </View>
  );
}

// Closes a sheet (owner, 15 Nov 2026: "in modals instead of close use x icons"): an X on a 32pt frosted circle, as every
// icon-only button.
export function CloseButton() {
  return (
    <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
      <Glass style={styles.closeGlass}>
        <Icon name="close" size={16} color={color.text} />
      </Glass>
    </Pressable>
  );
}

// A title in Explore's script, centred (owner, 15 Nov 2026: "use Sacramento"): "Switch" on the mode switcher, "Galaxy" on
// Galaxy's lock (owner, 16 Nov 2026: "Galaxy ( explore font )"). Sacramento comes in one thin weight and iOS won't
// thicken a custom font, so a second copy 0.8pt lower, each with a crisp shadow 0.8pt right, fills the strokes out, as
// Search's Explore title does. No lineHeight: anything under Sacramento's natural height clips its capitals.
// `size` makes it smaller where it heads a tab, as on Galaxy's dashboard (owner, 16 Nov 2026: "make it small").
export function ScriptTitle({ title, size = 44 }: { title: string; size?: number }) {
  return (
    <View>
      <Text style={[styles.script, { fontSize: size }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.script, styles.scriptCopy, { fontSize: size }]} accessible={false} importantForAccessibility="no">
        {title}
      </Text>
    </View>
  );
}

// A status's dot (src/status.ts): Sage while there's something to book, a Sage ring while booking hasn't opened, grey
// once there's nothing to book. An element, so the accent is allowed; the words beside it stay grey.
export function StatusDot({ tone }: { tone: Status['tone'] }) {
  return <View style={[styles.statusDot, tone === 'soon' && styles.statusSoon, tone === 'closed' && styles.statusClosed]} />;
}

export function Tag({ text }: { text: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  script: {
    fontFamily: font.script,
    fontSize: 44,
    color: color.text,
    textAlign: 'center',
    textShadowColor: color.text,
    textShadowOffset: { width: 0.8, height: 0 },
    textShadowRadius: 0.1, // Android draws no shadow at 0
  },
  scriptCopy: { position: 'absolute', top: 0.8, left: 0, right: 0 },
  grow: { flex: 1, minWidth: 0 },
  lines: { gap: 3 },
  row: { marginHorizontal: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLink: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pressed: { opacity: 0.7 },
  whenRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  rowTitle: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  foundRow: { marginBottom: 20, alignItems: 'stretch' },
  foundLink: { alignItems: 'stretch' },
  foundLines: { justifyContent: 'center', gap: 4 },
  kick: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  side: { alignItems: 'flex-end', justifyContent: 'space-between' },
  sidePrice: { paddingTop: 2, fontFamily: font.price, fontSize: 15, color: color.text },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hostLines: { gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  from: { fontFamily: font.medium, fontSize: 13, color: color.text },
  // Fully round, as every action pill (the 32pt small one).
  smallPill: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  smallPillText: { fontFamily: font.title, fontSize: 13, color: color.text },
  mutedText: { color: color.secondary },
  meta: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  small: { fontFamily: font.text, fontSize: 12, color: color.secondary },
  rowCircle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Circles (owner, 15 Nov 2026: "circle for love and user profile"), the two exceptions to the one corner.
  rowGlass: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  priceRow: { marginTop: 2, flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  price: { fontFamily: font.price, fontSize: 15, color: color.text },
  poster: { overflow: 'hidden' },
  monogram: { alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: font.headline },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  statusSoon: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color.accent },
  statusClosed: { backgroundColor: color.secondary },
  tag: { minHeight: 22, paddingHorizontal: 8, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: color.raised, justifyContent: 'center' },
  tagText: { fontFamily: font.medium, fontSize: 12, color: color.text },
  searchBox: {
    height: SEARCH_BOX,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.small,
    borderRadius: SEARCH_BOX / 2, // a pill, like every button
  },
  searchInput: { flex: 1, height: '100%', fontFamily: font.text, fontSize: 15, color: color.text },
  cardRim: { padding: rim, borderRadius: RIM },
  seatFace: { borderRadius: FACE, backgroundColor: color.card, paddingHorizontal: space.small, alignItems: 'center', gap: 2 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
  domeClip: { position: 'absolute', top: 0, overflow: 'hidden' },
  seat: { position: 'absolute' },

  section: { marginBottom: 16, marginHorizontal: 20 },
  h2: { fontFamily: font.headline, fontSize: 18, color: color.text },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none' },
  backBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: space.small,
    flexDirection: 'row',
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  barRight: { flexDirection: 'row', gap: space.small },
  sheet: { paddingHorizontal: 20, gap: space.big },
  fullSheet: { flex: 1 },
  // No hairline: the glass's fallback edge would draw one round the whole modal.
  glassFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: -BLEED, borderWidth: 0 },
  glassShade: { backgroundColor: `${color.ground}80` },
  sheetSays: { marginHorizontal: -20 },
  saysLine: { marginLeft: 28 + space.small, marginBottom: 6 },
  saysRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.small },
  // 20 round with the 6 tail corner on the speaker's side, Charcoal (src/orbitSays.tsx).
  theirs: { maxWidth: '80%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth, backgroundColor: groundAt(0.6), borderColor: stoneAt(0.12) },
  saysText: { fontFamily: font.text, fontSize: 16, lineHeight: 22, color: color.text },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: font.headline, fontSize: 20, color: color.text },
  sheetNote: { marginTop: 2, fontFamily: font.medium, fontSize: 14, color: color.secondary },
  menuScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  menu: { position: 'absolute', right: 20, minWidth: 200, padding: space.small, borderRadius: FACE, overflow: 'hidden' },
  menuFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: FACE },
  menuShade: { backgroundColor: `${color.ground}80` },
  menuItem: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  menuItemPressed: { backgroundColor: stoneAt(0.08) },
  menuText: { fontFamily: font.medium, fontSize: 15, color: color.text },
  // A circle, as every icon-only button (owner, 15 Nov 2026: "never use squared buttons").
  backGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  closeGlass: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  verified: { alignItems: 'center', justifyContent: 'center' },
  verifiedDisc: { position: 'absolute', backgroundColor: color.text },
  // Centred, with Home's notice type, as Search's empty state.
  missing: { flex: 1, justifyContent: 'center', paddingHorizontal: 20, gap: 4, backgroundColor: color.ground },
  missingTitle: { fontFamily: font.title, fontSize: 16, color: color.text, textAlign: 'center' },
  missingText: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary, textAlign: 'center' },
  wideButton: { marginTop: space.small, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: font.title, fontSize: 14, color: color.text },
});
