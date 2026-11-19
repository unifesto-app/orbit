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
import { type Event, type Host, events, hosts, now, orbitAds } from '../../mock';
import { OrbitAdStrip } from '../../orbitAd';
import { CategoryGrid } from '../../categories';
import { tileFor } from '../../kinds';
import { isNewHost, promoteOne } from '../../labels';
import { EventRow, Glow, isPromoted, labelOf, Monogram, SEARCH_BOX, SearchBox } from '../../rows';
import { countLine, firstUnseen, MAX_QUERY, search, WHEN, type When } from '../../search';
import { color, font, space } from '../../theme';

const BAR_BOTTOM = 12; // the glass bar's padding under the chips
export default function Search() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [when, setWhen] = useState<When>();
  const [free, setFree] = useState(false);
  const [category, setCategory] = useState<CategorySlug>();
  // ponytail: filters the mock list on every key, kept smooth by React; the doc's "short pause" (a debounce) comes
  // with the API.
  const filters = { q: useDeferredValue(q), when, free, category };
  // Places to play sit under their tile: turfs and courts in Sports, gaming cafés in Gaming.
  const findable = hosts.map((h) => ({ ...h, tile: tileFor(h.id) }));
  const hostOf = (id: string) => hosts.find((h) => h.id === id) as Host;
  const result = search(filters, events, findable, now);
  // One promoted event leads what's found (Boost), only if it matched; nothing is added.
  const found = { ...result, events: promoteOne(result.events, (e) => isPromoted(e, hostOf(e.hostId))) };
  const nothing = found.events.length === 0 && found.hosts.length === 0;
  // Nothing typed or picked: the categories to explore, then everything coming up. Otherwise the results.
  const browsing = !filters.q.trim() && !when && !free && !category;
  // While browsing, sections between Explore and Coming up (owner, 19 Nov 2026: "add more sections in search screen"):
  // up to three events each, none repeated in a later section; places to play; hosts new on Orbit. Coming up keeps
  // everything.
  const everything = { q: '', free: false };
  const [choice, weekend, freeOnes] = browsing
    ? firstUnseen([
        found.events.filter((e) => labelOf(e, hostOf(e.hostId)) === 'People’s choice'),
        search({ ...everything, when: 'weekend' }, events, findable, now).events,
        search({ ...everything, free: true }, events, findable, now).events,
      ])
    : [[], [], []];
  const places = browsing ? findable.filter((h) => h.tile) : [];
  const newHosts = browsing
    ? hosts.filter((h) => !tileFor(h.id) && isNewHost(h, now)).sort((a, b) => Date.parse(b.joined) - Date.parse(a.joined)).slice(0, 4)
    : [];
  const picked = categories.find((c) => c.slug === category);
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
            <CategoryGrid onPress={setCategory} />
            <EventSection title="People’s choice" events={choice} hostOf={hostOf} />
            <EventSection title="This weekend" events={weekend} hostOf={hostOf} onMore={() => setWhen('weekend')} />
            {/* One of Orbit's own ads, before the places to play (owner, 19 Nov 2026: "add one strip in search"). */}
            {/* A link to Search itself goes nowhere from here, so the strip is only read. */}
            {orbitAds[1] && (
              <OrbitAdStrip ad={{ ...orbitAds[1], href: orbitAds[1].href === '/search' ? undefined : orbitAds[1].href }} width={width - 40} />
            )}
            {places.length > 0 && (
              <>
                <CenteredHeading title="Places to play" />
                <View style={styles.hosts}>
                  {places.map((h) => (
                    <HostRow key={h.id} host={h} />
                  ))}
                </View>
              </>
            )}
            <EventSection title="Free" events={freeOnes} hostOf={hostOf} onMore={() => setFree(true)} />
            {newHosts.length > 0 && (
              <>
                <CenteredHeading title="New on Orbit" />
                <View style={styles.hosts}>
                  {newHosts.map((h) => (
                    <HostRow key={h.id} host={h} />
                  ))}
                </View>
              </>
            )}
            <CenteredHeading title="Coming up" />
            {found.events.map((e) => (
              <EventRow key={e.id} event={e} host={hostOf(e.hostId)} labelled />
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
                <CenteredHeading title={filters.q.trim() ? 'Hosts' : 'Places to play'} />
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
              <EventRow key={e.id} event={e} host={hostOf(e.hostId)} labelled />
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

// A browsing section of event rows under a centred heading; nothing when it's empty. `onMore` adds a See all under it
// that turns on the matching chip.
function EventSection({ title, events: list, hostOf, onMore }: { title: string; events: Event[]; hostOf: (id: string) => Host; onMore?: () => void }) {
  if (list.length === 0) return null;
  return (
    <>
      <CenteredHeading title={title} />
      {list.map((e) => (
        <EventRow key={e.id} event={e} host={hostOf(e.hostId)} labelled />
      ))}
      {onMore && (
        <View style={styles.more}>
          <Chip label="See all" on={false} onPress={onMore} />
        </View>
      )}
    </>
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
  more: { alignItems: 'center' },
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
