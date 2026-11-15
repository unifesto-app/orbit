// Pieces more than one screen draws: the event row and what it's made of, a host's logo, the seat card and the search
// box.
import { formatPrice } from '@orbit/contract';
import { type ReactNode, useId } from 'react';
import { type StyleProp, StyleSheet, Text, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Glass } from './glass';
import { Icon } from './icons';
import { Media, type MediaItem } from './media';
import type { Event, Host } from './mock';
import { around, color, font, radius, rim, space } from './theme';

export const SEAT = 48; // the 1:1 square on a seat card's top rim
// Every card's corners nest outward from its contents' corner (owner, 15 Nov 2026: "Inner Radius = Outer Radius -
// Padding"): a 6px corner and 8px padding make the face 14, the frosted rim 16.
const FACE = around(radius.sm, space.small);
const RIM = around(FACE, rim);

// A plain row (no card), so it keeps its Save heart, on the app's frosted glass (owner, 15 Nov 2026).
export function EventRow({ event: e, host }: { event: Event; host: Host }) {
  return (
    <View style={styles.row}>
      <Poster media={e.poster} width={60} label={e.title} />
      <View style={[styles.grow, styles.lines]}>
        <View style={styles.whenRow}>
          <Text style={styles.meta}>{e.when}</Text>
          {e.repeats && <Tag text={e.repeats} />}
        </View>
        <Text style={styles.rowTitle}>{e.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{host.name} · {e.area}</Text>
        <Price event={e} />
      </View>
      <View style={styles.heart} accessible accessibilityLabel={`Save ${e.title}`}>
        <Glass style={styles.heartGlass}>
          <Icon name="heart" size={20} color={color.text} />
        </Glass>
      </View>
    </View>
  );
}

function Price({ event: e }: { event: Event }) {
  return (
    <View style={styles.priceRow}>
      <Text style={styles.price}>{formatPrice(e.pricePaise)}</Text>
      {e.seats && <Text style={styles.small}>{e.seats}</Text>}
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
export function Monogram({ mark, size }: { mark: Pick<Host, 'initials' | 'bg' | 'fg'>; size: number }) {
  return (
    <View style={[styles.monogram, { width: size, height: size, borderRadius: radius.md, backgroundColor: mark.bg }]}>
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
        <View style={[styles.seatFace, tint !== undefined && styles.groundFace, { height: (face * 3) / 4, paddingTop: size / 2 + space.small }]}>
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
// location screen, update the search box"). Takes the TextInput's props; `style` places the box.
export const SEARCH_BOX = 44;
export function SearchBox({ style, ...input }: Omit<TextInputProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  return (
    <Glass style={[styles.searchBox, style]}>
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
// "fip the card tint top and bottom"; it glowed from the top, behind the prop, before).
// Pinned to the face's four edges by its wrapper: sized 100% itself, it measured the face less its padding, so it
// filled only an inset box and stopped short of the bottom (owner's screenshot, 15 Nov 2026: "the card tint has an
// issue").
function FaceWash({ tint }: { tint: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View style={styles.wash}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="0.5" cy="1" r="0.9">
            <Stop offset={0} stopColor={tint} stopOpacity={0.75} />
            <Stop offset={1} stopColor={tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" rx={FACE} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export function Tag({ text }: { text: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  lines: { gap: 3 },
  row: { marginHorizontal: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  whenRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  rowTitle: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  small: { fontFamily: font.text, fontSize: 12, color: color.secondary },
  heart: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Circles (owner, 15 Nov 2026: "circle for love and user profile"), the two exceptions to the one corner.
  heartGlass: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  priceRow: { marginTop: 2, flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  price: { fontFamily: font.price, fontSize: 15, color: color.text },
  poster: { overflow: 'hidden' },
  monogram: { alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: font.headline },
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
  groundFace: { backgroundColor: color.ground },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' },
  domeClip: { position: 'absolute', top: 0, overflow: 'hidden' },
  seat: { position: 'absolute' },
});
