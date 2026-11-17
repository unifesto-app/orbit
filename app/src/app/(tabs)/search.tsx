// The Search tab (owner, 15 Nov 2026: "build the Search Page"), from the Discover flow doc's Search section: one box,
// then four chips, When and Free (owner: "keep only four"). With nothing typed or picked, the categories follow as
// boxes under "Explore" in rows of three, three and four ("after that add the Types in boxes same as hosts in home",
// "replace types with Explore", "Explore Three Three Four"), then everything coming up, so the tab is never blank.
// Otherwise: a one-line count, hosts that match, and the events as Home's rows.
// No title (owner: "remove title search"): the frosted box and the chips under it sit at the top under an accent glow,
// pinned over the page, which scrolls under them; once it does, glass fades in behind them. The page's scroll view
// comes first in the tree, so the tab bar watches it to shrink on scroll. What matches is src/search.ts.
import { type CategorySlug, categories } from '@orbit/contract';
import { useDeferredValue, useState } from 'react';
import {
  Animated,
  Image,
  type ImageSourcePropType,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BarGlass, Glass } from '../../glass';
import { type Host, events, hosts, now } from '../../mock';
import { EventRow, Glow, Monogram, SEARCH_BOX, SearchBox, SeatCard } from '../../rows';
import { countLine, MAX_QUERY, search, WHEN, type When } from '../../search';
import { color, font, space } from '../../theme';

const BAR_BOTTOM = 12; // the glass bar's padding under the chips
// Each category's own colour (owner, 15 Nov 2026: "bring various accents to each explore", "also based on category
// give the accent"), for its 3D prop (src/props.tsx) and its card's glow: a terminal's cyan for hackathons, the
// spotlight's yellow for comedy, the pitch's green for sports, a screen's blue for film, and so on. Open Color's 8
// shades plus the brand blue.
const CATEGORY_COLOR: Record<CategorySlug, string> = {
  hackathons: '#1098AD', // terminal cyan: a bulb with code in it
  comedy: '#FCC419', // spotlight yellow: a laughing face
  music: '#D6336C', // pink: two notes
  meetups: '#E8590C', // warm orange: three people
  workshops: '#099268', // mint: a laptop
  fests: '#E03131', // red: a string of lights
  sports: '#2F9E44', // pitch green: a football and a cricket bat
  film: '#295EFF', // a screen's blue: a reel and a camera. Its own colour, like the others: the drawing is baked blue, and the brand accent is Sage since 18 Nov 2026
  startups: '#7048E8', // violet: a rocket on a growth line
  gaming: '#AE3EC9', // neon grape: a controller
};
// The approved drawings, done one by one (owner, 15 Nov 2026: "lets do one by one", "get approval and changes after
// going to next", "film approved"): Canva AI line art in the style of the owner's bulb, shaded ("add shade on it"),
// downloaded by the owner as SVG ("use svg's only"). Only the background around it is cleared; the drawing stays
// filled ("i dont want transparent b/w the image i need filled one same"), recoloured in its category's colour (deep
// lines, a light tint running from near white top left to stronger bottom right, as the props) and baked into the PNG
// ("add the same tint to the svg"). Every category has one, so the 3D props they replaced are gone.
const CATEGORY_ART: Record<CategorySlug, ImageSourcePropType> = {
  hackathons: require('../../../assets/explore/hackathons.png'),
  comedy: require('../../../assets/explore/comedy.png'),
  music: require('../../../assets/explore/music.png'),
  meetups: require('../../../assets/explore/meetups.png'),
  workshops: require('../../../assets/explore/workshops.png'),
  fests: require('../../../assets/explore/fests.png'),
  sports: require('../../../assets/explore/sports.png'),
  film: require('../../../assets/explore/film.png'),
  startups: require('../../../assets/explore/startups.png'),
  gaming: require('../../../assets/explore/gaming.png'),
};
// A lone shape fills its whole square where a scene doesn't, so it's drawn smaller ("music is large, make little
// small"), and Fests, wide and short, a little bigger ("increase its size little"); scaled about the centre, so the
// card and its seat keep their size.
const ART_SCALE: Partial<Record<CategorySlug, number>> = { music: 0.85, fests: 1.15 };
// Explore's rows: three, three, then four (owner, 15 Nov 2026: "Explore Three Three Four"); the last row takes the rest.
const exploreRows = [categories.slice(0, 3), categories.slice(3, 6), categories.slice(6)];

export default function Search() {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [when, setWhen] = useState<When>();
  const [free, setFree] = useState(false);
  const [category, setCategory] = useState<CategorySlug>();
  // ponytail: filters the mock list on every key, kept smooth by React; the doc's "short pause" (a debounce) comes
  // with the API.
  const filters = { q: useDeferredValue(q), when, free, category };
  const found = search(filters, events, hosts, now);
  const hostOf = (id: string) => hosts.find((h) => h.id === id) as Host;
  const nothing = found.events.length === 0 && found.hosts.length === 0;
  // Nothing typed or picked: the categories to explore, then everything coming up. Otherwise the results.
  const browsing = !filters.q.trim() && !when && !free && !category;
  const picked = categories.find((c) => c.slug === category);
  const { width } = useWindowDimensions();
  // The bar's height, first a guess (box, chips, padding) until it's measured; it grows when a category adds a line.
  const [bar, setBar] = useState(() => insets.top + space.small + SEARCH_BOX + 16 + 32 + BAR_BOTTOM);
  const [scrollY] = useState(() => new Animated.Value(0));
  const seeAll = () => {
    setQ('');
    setWhen(undefined);
    setFree(false);
    setCategory(undefined);
  };

  return (
    <View style={styles.screen}>
      {/* The accent from the top (owner, 15 Nov 2026: "add accent from top"), fixed behind the page. */}
      <Glow />
      <Animated.ScrollView
        keyboardShouldPersistTaps="handled" // one tap on a chip works with the keyboard up
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        contentContainerStyle={{
          // Starts under the pinned bar, less its bottom padding, which is only there for the glass.
          paddingTop: Math.max(0, bar - BAR_BOTTOM),
          // Clear of the tab bar, as on Home: on iOS the tab's safe area includes it; on Android the tabs pad the screen.
          paddingBottom: (Platform.OS === 'ios' ? insets.bottom : 0) + space.big,
        }}
      >
        {browsing ? (
          <View>
            <CenteredHeading title="Explore" script />
            <View style={styles.grid}>
              {exploreRows.map((row) => (
                <View key={row[0].slug} style={styles.gridRow}>
                  {row.map((c) => (
                    <CategoryCard
                      key={c.slug}
                      slug={c.slug}
                      label={c.label}
                      tint={CATEGORY_COLOR[c.slug]}
                      width={(width - 40 - (row.length - 1) * space.small) / row.length}
                      onPress={() => setCategory(c.slug)}
                    />
                  ))}
                </View>
              ))}
            </View>
            <CenteredHeading title="Coming up" />
            {found.events.map((e) => (
              <EventRow key={e.id} event={e} host={hostOf(e.hostId)} />
            ))}
          </View>
        ) : nothing ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyText}>Try a shorter word or another category.</Text>
            <Pressable onPress={seeAll} accessibilityRole="button">
              <Glass style={styles.wideButton}>
                <Text style={styles.buttonText}>See all events</Text>
              </Glass>
            </Pressable>
          </View>
        ) : (
          // One hierarchy with browsing: the count is the results' one-line summary, under the chips; then each section
          // under the same centred heading, and with only events, the rows straight after the count.
          <View>
            <Text style={styles.count} accessibilityLiveRegion="polite">
              {countLine(found.events.length, filters)}
            </Text>
            {found.hosts.length > 0 ? (
              <>
                <CenteredHeading title="Hosts" />
                <View style={styles.hosts}>
                  {found.hosts.map((h) => (
                    <HostRow key={h.id} host={h} />
                  ))}
                </View>
                {found.events.length > 0 && <CenteredHeading title="Events" />}
              </>
            ) : (
              <View style={styles.rowsTop} />
            )}
            {found.events.map((e) => (
              <EventRow key={e.id} event={e} host={hostOf(e.hostId)} />
            ))}
          </View>
        )}
      </Animated.ScrollView>
      {/* Over the page, so it can reach up behind the clock; measured, so the page starts under it. */}
      <View style={[styles.bar, { paddingTop: insets.top + space.small }]} onLayout={(e) => setBar(e.nativeEvent.layout.height)}>
        {/* Glass behind the box and chips once the page scrolls under them (owner, 15 Nov 2026: "while scrolling add
            the glass bg", "round the bottom and dark it"), shared with Home. */}
        <BarGlass scrollY={scrollY} />
        {/* Frosted like every control, so the glow shows through (owner: "search box bg is odd. blend everything and
            fix"). At the top of the page nothing is behind it (owner: "the page can be dragged so remove the bg of
            search box"); the glass above comes in only once the page scrolls. */}
        <SearchBox
          style={styles.field}
          value={q}
          onChangeText={setQ}
          placeholder="Events, hosts, areas or categories"
          accessibilityLabel="Search events, hosts, areas or categories"
          autoCapitalize="none"
          maxLength={MAX_QUERY}
        />
        {/* Pinned under the box, 16 below it (owner, 15 Nov 2026: "move the chips below the search with proper
            padding", after "move the chips from their to page" while the box still had a backdrop). Centred ("make
            the chips center"). */}
        <View style={styles.chips}>
          {WHEN.map((w) => (
            <Chip key={w.id} label={w.label} on={when === w.id} onPress={() => setWhen(when === w.id ? undefined : w.id)} />
          ))}
          <Chip label="Free" on={free} onPress={() => setFree(!free)} />
        </View>
        {/* The category picked from the boxes below, dotted, on a centred line of its own under the four (owner: "when
            any type is selected, free is going to next line instead the should be in line two"); tapping it goes
            back to all of them. */}
        {picked && (
          <View style={[styles.chips, styles.pickedRow]}>
            <Chip label={picked.label} on onPress={() => setCategory(undefined)} />
          </View>
        )}
      </View>
    </View>
  );
}

// A centred section heading (owner, 15 Nov 2026: "move the explore center", "even coming up too"; side lines tried,
// then "remove side lines").
// `script` sets it in Sacramento, for Explore (owner, 15 Nov 2026: "for explore title use handelson three font", then
// "use Sacramento").
// Sacramento comes in one thin weight and iOS won't thicken a custom font, so the script is made bolder by hand
// ("increase the boldness of explore"): a second copy 0.8pt lower, each with a crisp shadow 0.8pt right, fills the
// strokes out on all four corners.
function CenteredHeading({ title, script = false }: { title: string; script?: boolean }) {
  if (!script) {
    return (
      <Text style={styles.centered} accessibilityRole="header">
        {title}
      </Text>
    );
  }
  return (
    <View style={styles.centered}>
      <Text style={styles.script} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.script, styles.scriptCopy]} accessible={false} importantForAccessibility="no">
        {title}
      </Text>
    </View>
  );
}

// A filter: frosted glass like every button, the accent on a dot when it's picked, never on the text (as the location
// screen's chips).
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Glass style={styles.chip}>
        {on && <View style={styles.dot} />}
        <Text style={styles.chipText}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

// A category as a box like Home's host cards (owner, 15 Nov 2026: "add the Types in boxes same as hosts in home"): its
// prop on the top rim where a host's logo sits, and its name, nothing else (owner: "from 1 event from card"). Tapping
// it picks the category.
// Sized to its box, since a row of four is narrow: the prop is about 46% of the width.
function CategoryCard({
  slug,
  label,
  tint,
  width,
  onPress,
}: {
  slug: CategorySlug;
  label: string;
  tint: string;
  width: number;
  onPress: () => void;
}) {
  const size = Math.round(width * 0.62);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <SeatCard
        width={width}
        size={size}
        tint={tint}
        dome={false}
        seat={<Image source={CATEGORY_ART[slug]} style={{ width: size, height: size, transform: [{ scale: ART_SCALE[slug] ?? 1 }] }} />}
      >
        <View style={styles.categoryText}>
          <Text style={styles.categoryName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {label}
          </Text>
        </View>
      </SeatCard>
    </Pressable>
  );
}

// A host that matches; it opens the host page (Discover doc).
function HostRow({ host }: { host: Host }) {
  return (
    <Pressable
      onPress={() => router.push(`/host/${host.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${host.name}, ${host.about}`}
      style={({ pressed }) => [styles.hostRow, pressed && styles.pressed]}>
      <Monogram mark={host} size={40} />
      <View style={styles.grow}>
        <Text style={styles.hostName} numberOfLines={1}>
          {host.name}
        </Text>
        <Text style={styles.note} numberOfLines={1}>
          {host.about}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  // Pinned over the page; only the box and chips take touches, so the page under the gaps stays tappable.
  bar: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: BAR_BOTTOM, pointerEvents: 'box-none' },
  field: { marginHorizontal: 20 },
  // 16 down from the box (owner: "no gap after search box").
  chips: { marginTop: 16, marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.small, pointerEvents: 'box-none' },
  pickedRow: { marginTop: space.small },
  // The small button's size, so the four fit on one line on a 390pt phone.
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontFamily: font.medium, fontSize: 13, color: color.text },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },

  hosts: { marginHorizontal: 20, gap: 16 },
  // 40 above each section and 24 under its heading (owner: "add space after explore and coming up and sections gap
  // also add").
  // Sacramento is thin and small for its size, so it runs larger.
  // No lineHeight: Sacramento's tall capitals reach the font's full ascent, and anything under its natural line height
  // (about 1.46 times the size) clips the top of the E.
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
  centered: { marginTop: 40, marginBottom: space.big, marginHorizontal: 20, fontFamily: font.headline, fontSize: 18, color: color.text, textAlign: 'center' },
  // 8 between boxes so three and four fit across; 16 between rows, room for each monogram poking over the edge.
  grid: { marginHorizontal: 20, gap: 16 },
  gridRow: { flexDirection: 'row', gap: space.small },
  // Centred in the face below the monogram, since a category card has no button at the bottom.
  categoryText: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space.small },
  // Home's host card name, shrinking a little in the narrow row of four.
  categoryName: { fontFamily: font.title, fontSize: 14, color: color.text, textAlign: 'center' },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pressed: { opacity: 0.7 },
  hostName: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  count: { marginTop: space.big, marginHorizontal: 20, fontFamily: font.medium, fontSize: 13, color: color.secondary, textAlign: 'center' },
  rowsTop: { height: space.big },
  note: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },

  // Centred like the section headings; type as Home's notice.
  empty: { marginTop: 40, marginHorizontal: 20, gap: 4 },
  emptyTitle: { fontFamily: font.title, fontSize: 16, color: color.text, textAlign: 'center' },
  emptyText: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary, textAlign: 'center' },
  wideButton: { marginTop: space.small, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: font.title, fontSize: 14, color: color.text },
});
