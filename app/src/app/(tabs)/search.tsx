// The Search tab (owner, 15 Nov 2026: "build the Search Page"), from the Discover flow doc's Search section: one box,
// then the four chips, When and Free (owner: "keep only four"; since 19 Nov the three When chips are one capsule). With nothing typed or picked, the categories follow as
// boxes under "Explore" in rows of three, three and four ("after that add the Types in boxes same as hosts in home",
// "replace types with Explore", "Explore Three Three Four"), then everything coming up, so the tab is never blank.
// Otherwise: a one-line count, hosts that match, and the events as Home's rows.
// No title (owner: "remove title search"): the box and the chips under it sit at the top under a glow, on their own
// dark glass, pinned over the page, which scrolls under them with nothing behind the bar. The page's scroll view comes
// first in the tree, so the tab bar watches it to shrink on scroll. What matches is src/search.ts.
import { type CategorySlug, categories } from '@orbit/contract';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { DARK_TINT, Glass } from '../../glass';
import { useAds, useContent, usePromoted } from '../../content';
import { type Event, eventsApi, type Host, hostsOf, toEvent, toHost, toPlace, whereOf } from '../../events';
import { useLoad } from '../../load';
import { hosts as mockHosts } from '../../mock';
import { usePlace } from '../../place';
import { OrbitAdStrip } from '../../orbitAd';
import { askOrbit, OrbitSays } from '../../orbitSays';
import { CategoryGrid } from '../../categories';
import { isNewHost, promoteOne } from '../../labels';
import { EventRow, Failed, HostRow, isPromoted, labelOf, SEARCH_BOX, SearchBox, Waiting } from '../../rows';
import { countLine, firstUnseen, MAX_QUERY, search, WHEN, type When } from '../../search';
import { api } from '../../session';
import { useTabBarScroll, useTabBarSmall } from '../../tabBar';
import { color, font, space, stoneAt } from '../../theme';

const CHIP = 40; // the When capsule's and Free's height
export default function Search() {
  const insets = useSafeAreaInsets();
  const onTabScroll = useTabBarScroll(); // shrinks the tab bar on the way down
  const { width } = useWindowDimensions();
  const content = useContent(); // Ask Orbit's chips, from Galaxy's App content (src/content.ts)
  const ad = useAds('search')[0];
  const promoted = usePromoted(); // events staff marked Promoted (src/content.ts)
  const [q, setQ] = useState('');
  const [when, setWhen] = useState<When>();
  const [free, setFree] = useState(false);
  const [category, setCategory] = useState<CategorySlug>();
  // What's typed goes to the API after a 300 ms pause (the doc's "short pause"); chips go at once.
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTyped(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const filters = { q: typed, when, free, category };
  const q0 = filters.q.trim();
  // Nothing typed or picked: the categories to explore, then everything coming up. Otherwise the results.
  const browsing = !q0 && !when && !free && !category;
  const place = usePlace();
  const where = whereOf(place);
  const now = Date.now();
  // Browsing reads the same call as Home; anything typed or picked reads /public/search, the last results staying up
  // while the next load (src/events.ts).
  const discover = useLoad(browsing ? JSON.stringify(where) : null, () => eventsApi(api).discover(where), { keep: true });
  const searched = useLoad(browsing ? null : JSON.stringify([filters, where]), () => eventsApi(api).search(filters, where), { keep: true });
  const cards = browsing
    ? [...(discover.data?.near ?? []), ...(discover.data?.elsewhere ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    : (searched.data?.events ?? []);
  const events = cards.map((c) => toEvent(c));
  // Places to play (GET /public/places) sit under their tile: turfs and courts in Sports, gaming cafés in Gaming; `search`
  // finds them by what's typed.
  const placeList = useLoad(JSON.stringify(where), () => eventsApi(api).places(where), { keep: true });
  const findable = (placeList.data?.places ?? []).map(toPlace);
  const apiHosts = hostsOf(cards);
  const hostOf = (id: string) => (apiHosts.find((h) => h.id === id) ?? mockHosts.find((h) => h.id === id)) as Host;
  // Hosts the API found by what you typed, then the places to play that match.
  const result = {
    events,
    hosts: [...new Map([...(browsing ? [] : (searched.data?.hosts ?? []).map(toHost)), ...search(filters, [], findable, now).hosts].map((h) => [h.id, h])).values()],
  };
  // One promoted event leads what's found (Boost), only if it matched; nothing is added.
  const found = { ...result, events: promoteOne(result.events, (e) => isPromoted(e, hostOf(e.hostId), promoted, now)) };
  const answer = browsing ? discover : searched;
  const nothing = !!answer.data && !answer.loading && found.events.length === 0 && found.hosts.length === 0;
  // The first answer still on its way, or failed with nothing to show: one line in place of the events.
  const pending = !answer.data && (answer.loading || !answer.error ? <Waiting /> : <Failed message={answer.error.message} retry={answer.reload} />);
  // While browsing, sections between Explore and Coming up (owner, 19 Nov 2026: "add more sections in search screen"):
  // up to three events each, none repeated in a later section; places to play; hosts new on Orbit. Coming up keeps
  // everything.
  const everything = { q: '', free: false };
  const [choice, weekend, freeOnes] = browsing
    ? firstUnseen([
        found.events.filter((e) => labelOf(e, hostOf(e.hostId), promoted, now) === 'People’s choice'),
        search({ ...everything, when: 'weekend' }, events, [], now).events,
        search({ ...everything, free: true }, events, [], now).events,
      ])
    : [[], [], []];
  const places = browsing ? findable.filter((h) => h.tile) : [];
  const newHosts = browsing
    ? apiHosts.filter((h) => isNewHost(h, now)).sort((a, b) => Date.parse(b.joined) - Date.parse(a.joined)).slice(0, 4)
    : [];
  const picked = categories.find((c) => c.slug === category);
  // The chips' full height under the box, first a guess until it's measured; it grows when a category adds a line.
  const [chips, setChips] = useState(16 + CHIP);
  // Whether you're typing, so the chips don't fold then (Fold). Android's Back hides the keyboard without leaving the box.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => sub.remove();
  }, []);
  const seeAll = () => {
    setQ('');
    setWhen(undefined);
    setFree(false);
    setCategory(undefined);
  };

  return (
    <View style={styles.screen}>
      {/* A glow from the top (owner, 15 Nov 2026: "add accent from top"), fixed behind the page, in the orb's colours. */}
      <OrbGlow />
      <ScrollView
        keyboardShouldPersistTaps="handled" // one tap on a chip works with the keyboard up
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onTabScroll}
        contentContainerStyle={{
          // Starts under the pinned bar at its full height, so it doesn't move when the chips fold.
          paddingTop: insets.top + space.small + SEARCH_BOX + chips,
          // Clear of the tab bar, as on Home: under the tabs the bottom safe area includes it ((tabs)/_layout.tsx).
          paddingBottom: insets.bottom + space.big,
        }}
      >
        {/* A failed read with last results still up: the failure over them, with a way to retry. */}
        {answer.error && answer.data && <Failed message={answer.error.message} retry={answer.reload} />}
        {browsing ? (
          <View>
            {/* Orbit offers the chat first, its own four questions as your answers (the Orbit speaks take, 19 Nov). */}
            <OrbitSays
              title="Not sure yet?"
              text="Ask me about events, places to play and hosts near you."
              answers={content.asks.map((ask) => ({ label: ask, onPress: () => askOrbit(ask) }))}
            />
            <CenteredHeading title="Explore" script />
            <CategoryGrid onPress={setCategory} />
            <EventSection title="People’s choice" events={choice} hostOf={hostOf} now={now} />
            <EventSection title="This weekend" events={weekend} hostOf={hostOf} now={now} onMore={() => setWhen('weekend')} />
            {/* One of Orbit's own ads, before the places to play (owner, 19 Nov 2026: "add one strip in search"). */}
            {/* A link to Search itself goes nowhere from here, so the strip is only read. */}
            {ad && <OrbitAdStrip ad={{ ...ad, href: ad.href === '/search' ? undefined : ad.href }} width={width - 40} />}
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
            <EventSection title="Free" events={freeOnes} hostOf={hostOf} now={now} onMore={() => setFree(true)} />
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
            {answer.data ? <CenteredHeading title="Coming up" /> : pending}
            {found.events.map((e) => (
              <EventRow key={e.id} event={e} host={hostOf(e.hostId)} now={now} found />
            ))}
          </View>
        ) : !answer.data ? (
          pending
        ) : nothing ? (
          // Orbit says so, as in the chat, 40 under the bar as a section; what you typed can go to the chat as it is.
          <OrbitSays
            top={40}
            title="Nothing here yet"
            text={q0 ? `Nothing for “${q0}” on Orbit yet. Try a shorter word or another category.` : 'Try another day, or another category.'}
            answers={[{ label: 'See all events', onPress: seeAll }, ...(q0 ? [{ label: 'Ask Orbit', onPress: () => askOrbit(q0) }] : [])]}
          />
        ) : (
          // What was found (owner, 19 Nov 2026: picked "Left summary" from the section takes): the count on the left with
          // Clear on the right, which turns every filter off; then Hosts (or Places to play, for a category alone) and
          // Events under left headings with their numbers. With only events, the rows straight after the count.
          <View>
            <View style={styles.summary}>
              <Text style={styles.summaryText} accessibilityLiveRegion="polite">
                {answer.loading ? 'Searching…' : countLine(found.events.length, filters)}
              </Text>
              <Pressable onPress={seeAll} accessibilityRole="button" accessibilityLabel="Clear the search" hitSlop={6}>
                <Glass style={styles.chip} tint={DARK_TINT}>
                  <Text style={styles.chipText}>Clear</Text>
                </Glass>
              </Pressable>
            </View>
            {found.hosts.length > 0 ? (
              <>
                <FoundHeading title={q0 ? 'Hosts' : 'Places to play'} count={found.hosts.length} />
                <View style={styles.hosts}>
                  {found.hosts.map((h) => (
                    <HostRow key={h.id} host={h} />
                  ))}
                </View>
                {found.events.length > 0 && <FoundHeading title="Events" count={found.events.length} />}
              </>
            ) : (
              <View style={styles.rowsTop} />
            )}
            {found.events.map((e) => (
              <EventRow key={e.id} event={e} host={hostOf(e.hostId)} now={now} found />
            ))}
          </View>
        )}
      </ScrollView>
      {/* Over the page, so it can reach up behind the clock. */}
      <View style={[styles.bar, { paddingTop: insets.top + space.small }]}>
        {/* Nothing behind the box and chips: they're on their own dark glass (owner, 19 Nov 2026: "as cards are added,
            remove the header bg in both home and search"; glass faded in behind them once the page scrolled). */}
        {/* Glass like every control, so the glow shows through (owner: "search box bg is odd. blend everything and
            fix"), dark like the tab bar's since 19 Nov 2026. Nothing is behind it (owner: "the page can be dragged so
            remove the bg of search box"). */}
        <SearchBox
          style={styles.field}
          tint={DARK_TINT}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          value={q}
          onChangeText={setQ}
          placeholder="Events, hosts, areas or categories"
          accessibilityLabel="Search events, hosts, areas or categories"
          autoCapitalize="none"
          maxLength={MAX_QUERY}
        />
        {/* Pinned under the box, 16 below it (owner, 15 Nov 2026: "move the chips below the search with proper
            padding", after "move the chips from their to page" while the box still had a backdrop). Centred ("make
            the chips center"). One line, always (owner: "free is going to next line"): the When capsule's words shrink to
            fit before anything wraps. */}
        <Fold hold={typing || !!category} onHeight={setChips}>
          <View style={styles.chips}>
            <WhenCapsule when={when} onPick={setWhen} />
            {/* Free: its own capsule, the tab bar's lighter pill inside it when on, so it never changes width. */}
            <Pressable onPress={() => setFree(!free)} accessibilityRole="button" accessibilityState={{ selected: free }}>
              <Glass tint={DARK_TINT} style={styles.capsule}>
                <View style={[styles.segment, styles.freeIn, free && styles.on]}>
                  <Text style={styles.chipText} numberOfLines={1}>Free</Text>
                </View>
              </Glass>
            </Pressable>
          </View>
          {/* The category picked from the boxes below, dotted, on a centred line of its own under the four (owner:
              "when any type is selected, free is going to next line instead the should be in line two"); tapping it
              goes back to all of them. */}
          {picked && (
            <View style={[styles.chips, styles.pickedRow]}>
              <Chip label={picked.label} on onPress={() => setCategory(undefined)} />
            </View>
          )}
        </Fold>
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
function EventSection({ title, events: list, hostOf, now, onMore }: { title: string; events: Event[]; hostOf: (id: string) => Host; now: number; onMore?: () => void }) {
  if (list.length === 0) return null;
  return (
    <>
      <CenteredHeading title={title} />
      {list.map((e) => (
        <EventRow key={e.id} event={e} host={hostOf(e.hostId)} now={now} found />
      ))}
      {onMore && (
        <View style={styles.more}>
          <Chip label="See all" on={false} onPress={onMore} />
        </View>
      )}
    </>
  );
}

// Search's top glow in the orb's own colours (owner, 19 Nov 2026: "Both", the Orbit speaks take), in place of flat
// Sage: the chat's colour disc (assets/orb-field.png) centred on the screen's top edge, faded into the ground by GLOW.
// Fixed behind the page, never on text.
const GLOW = 320;
function OrbGlow() {
  const { width } = useWindowDimensions();
  const size = width * 1.6;
  return (
    <View style={styles.glow}>
      <Image source={require('../../../assets/orb-field.png')} style={[styles.orbField, { width: size, height: size, left: (width - size) / 2, top: -size / 2 }]} />
      <Svg width="100%" height={GLOW} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="orbFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor={color.ground} stopOpacity={0} />
            <Stop offset={0.45} stopColor={color.ground} stopOpacity={0.6} />
            <Stop offset={1} stopColor={color.ground} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height={GLOW} fill="url(#orbFade)" />
      </Svg>
    </View>
  );
}

// The When chips as one capsule on the tab bar's dark glass, with the bar's lighter pill sliding under the picked one
// (owner, 19 Nov 2026: "Both", the Capsule take). One at a time, as before; tapping the picked one clears it. The pill
// appears in place on a first pick and slides between chips after; the chips aren't equal widths, so it moves on the JS
// thread (left and width). At larger text sizes, or on a small phone, the capsule shrinks and its words with it
// (down to three quarters) rather than letting Free wrap.
function WhenCapsule({ when, onPick }: { when?: When; onPick: (w?: When) => void }) {
  const { width } = useWindowDimensions();
  const pad = width >= 380 ? 12 : 8;
  const [frames, setFrames] = useState<Partial<Record<When, { x: number; width: number }>>>({});
  const [left] = useState(() => new Animated.Value(0));
  const [wide] = useState(() => new Animated.Value(0));
  const showing = useRef(false);
  const at = when && frames[when];
  useEffect(() => {
    if (!at) {
      showing.current = false;
      return;
    }
    if (!showing.current) {
      left.setValue(at.x);
      wide.setValue(at.width);
      showing.current = true;
      return;
    }
    const to = (v: Animated.Value, toValue: number) => Animated.timing(v, { toValue, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: false });
    Animated.parallel([to(left, at.x), to(wide, at.width)]).start();
  }, [at, left, wide]);
  return (
    <Glass tint={DARK_TINT} style={[styles.capsule, styles.shrink]}>
      {at && <Animated.View style={[styles.slider, { left, width: wide }]} />}
      {WHEN.map((w) => (
        <Pressable
          key={w.id}
          onLayout={(e) => {
            const { x, width: wd } = e.nativeEvent.layout;
            setFrames((f) => (f[w.id]?.x === x && f[w.id]?.width === wd ? f : { ...f, [w.id]: { x, width: wd } }));
          }}
          onPress={() => onPick(when === w.id ? undefined : w.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: when === w.id }}
          style={[styles.segment, styles.shrink, { paddingHorizontal: pad }]}>
          <Text style={styles.chipText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
            {w.label}
          </Text>
        </Pressable>
      ))}
    </Glass>
  );
}

// The chips fold away with the tab bar on the way down and come back with it (owner, 19 Nov 2026: "Both", the Capsule
// take), unless `hold`: while you type (the tab bar hides under the keyboard, so nothing would bring them back) or while
// a category is picked (its chip is how you clear it). They stay mounted and this wrapper clips them to nothing, so the
// bar's LayoutAnimation moves a frame instead of fading glass in and out, and the capsule's pill keeps its place.
// `onHeight` is their full height, folded or not, for the page under them. Only this re-renders when the bar changes.
function Fold({ hold, onHeight, children }: { hold: boolean; onHeight: (height: number) => void; children: ReactNode }) {
  const folded = useTabBarSmall() && !hold;
  return (
    <View
      collapsable={false}
      style={[styles.fold, folded && styles.folded]}
      accessibilityElementsHidden={folded}
      importantForAccessibility={folded ? 'no-hide-descendants' : 'auto'}>
      <View style={styles.fold} onLayout={(e) => onHeight(e.nativeEvent.layout.height)}>
        {children}
      </View>
    </View>
  );
}

// A filter: the tab bar's dark glass like Search's other controls, the accent on a dot when it's picked, never on the
// text (as the location screen's chips). See all under a section, and the picked category.
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Glass style={styles.chip} tint={DARK_TINT}>
        {on && <View style={styles.dot} />}
        <Text style={styles.chipText}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

// A left-aligned heading over what was found, its number beside it in grey (the Left summary take, 19 Nov 2026).
function FoundHeading({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.foundHeading} accessible accessibilityRole="header" accessibilityLabel={`${title}, ${count}`}>
      <Text style={styles.foundTitle}>{title}</Text>
      <Text style={styles.foundCount}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  // Pinned over the page; only the box and chips take touches, so the page under the gaps stays tappable.
  bar: { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'box-none' },
  field: { marginHorizontal: 20 },
  // 16 down from the box (owner: "no gap after search box").
  fold: { pointerEvents: 'box-none' },
  folded: { height: 0, overflow: 'hidden' },
  chips: { marginTop: 16, marginHorizontal: 20, flexDirection: 'row', justifyContent: 'center', gap: space.small, pointerEvents: 'box-none' },
  pickedRow: { marginTop: space.small },
  // The tab bar's shape: a capsule with 4 round its pill.
  capsule: { height: CHIP, padding: 4, borderCurve: 'continuous', borderRadius: CHIP / 2, flexDirection: 'row' },
  slider: { position: 'absolute', top: 4, bottom: 4, borderCurve: 'continuous', borderRadius: CHIP / 2 - 4, backgroundColor: stoneAt(0.14), borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.24) },
  segment: { justifyContent: 'center' },
  shrink: { flexShrink: 1 },
  // A hairline always, clear when off, so turning Free on doesn't change its width.
  freeIn: { paddingHorizontal: 10, borderCurve: 'continuous', borderRadius: CHIP / 2 - 4, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  on: { backgroundColor: stoneAt(0.14), borderColor: stoneAt(0.24) },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: GLOW, overflow: 'hidden', pointerEvents: 'none' },
  orbField: { position: 'absolute', opacity: 0.45 },
  // The small button's size, so the four fit on one line on a 390pt phone.
  chip: { height: 32, paddingHorizontal: 12, borderCurve: 'continuous', borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontFamily: font.price, fontSize: 13, color: color.text }, // DM Sans 600, as the tab bar's labels
  dot: { width: 6, height: 6, borderCurve: 'continuous', borderRadius: 3, backgroundColor: color.accent },

  hosts: { marginHorizontal: 20, gap: 20 }, // as Home's rows
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
  summary: { marginTop: space.big, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  summaryText: { flexShrink: 1, fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  foundHeading: { marginTop: 32, marginBottom: 16, marginHorizontal: 20, flexDirection: 'row', alignItems: 'baseline', gap: space.small },
  foundTitle: { fontFamily: font.headline, fontSize: 18, color: color.text },
  foundCount: { fontFamily: font.medium, fontSize: 14, color: color.secondary },
  rowsTop: { height: space.big },

});
