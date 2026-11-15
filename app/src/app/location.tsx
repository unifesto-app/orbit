// The location screen, a modal over Home (owner, 15 Nov 2026: "create a location modal screen. get functionality from
// website"). It works like the web's navbar picker (web/src/app/location-button.tsx): search, "Use my current
// location", Popular cities, then every city A to Z, from the one list in @orbit/contract. Only the cities scroll;
// the search and current location stay put above them. Choosing closes it, and Home shows events near the new place.
import { allCities, type City, popularCities, searchCities } from '@orbit/contract';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '../glass';
import { nearAreasFor, viewer } from '../mock';
import { Blocked, locate, setPlace, usePlace } from '../place';
import { CloseButton, GlassFill, SearchBox } from '../rows';
import { color, font, space } from '../theme';

type Status = 'idle' | 'locating' | 'blocked' | 'failed';

// Every city A to Z under its first letter, as the list's sections.
const byLetter = [
  ...allCities.reduce((m, c) => m.set(c.name[0], [...(m.get(c.name[0]) ?? []), c]), new Map<string, City[]>()),
].map(([title, data]) => ({ title, data }));

export default function LocationScreen() {
  const insets = useSafeAreaInsets();
  const place = usePlace(viewer.place);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const searching = query.trim() !== '';
  const results = searchCities(query).slice(0, 50);

  function choose(name: { area: string; city: string }, source: 'gps' | 'pick') {
    setPlace({ ...name, source, nearAreas: nearAreasFor(name) });
    if (router.canGoBack()) router.back(); // not if it was swiped away while locating
  }

  async function useCurrent() {
    setStatus('locating');
    try {
      choose(await locate(), 'gps');
    } catch (e) {
      setStatus(e instanceof Blocked ? 'blocked' : 'failed');
    }
  }

  const pick = (c: City) => choose({ area: c.name, city: c.state }, 'pick');
  const isChosen = (c: City) => place?.source === 'pick' && place.area === c.name && place.city === c.state;

  return (
    // A sheet on iOS, so a small gap at its top; full screen on Android, so clear of the status bar.
    <View style={[styles.screen, { paddingTop: Platform.OS === 'ios' ? space.big : insets.top + space.small }]}>
      <GlassFill />
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Your location
        </Text>
        <CloseButton />
      </View>

      {/* Not focused on open: the keyboard would cover the Popular cities (the web does the same on phones). */}
      <SearchBox
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => results[0] && pick(results[0])}
        placeholder="Search for your city"
        accessibilityLabel="Search for your city"
        autoCapitalize="words"
        maxLength={60}
      />

      <Pressable onPress={useCurrent} disabled={status === 'locating'} accessibilityRole="button">
        <Glass style={styles.current}>
          <Text style={styles.currentText}>{status === 'locating' ? 'Locating…' : 'Use my current location'}</Text>
        </Glass>
      </Pressable>
      {status === 'blocked' && (
        <View style={styles.note}>
          <Text style={[styles.noteText, styles.grow]}>Location is off for Orbit. Turn it on in Settings.</Text>
          <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button" hitSlop={8}>
            <Glass style={styles.close}>
              <Text style={styles.closeText}>Settings</Text>
            </Glass>
          </Pressable>
        </View>
      )}
      {status === 'failed' && (
        <Text style={[styles.noteText, styles.note]}>Couldn’t find where you are. Try again, or pick your city.</Text>
      )}

      <SectionList
        style={styles.list}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.big }}
        sections={searching ? (results.length ? [{ title: '', data: results }] : []) : byLetter}
        // The letters scroll with the list: pinned, each would need a solid strip behind it over the glass.
        stickySectionHeadersEnabled={false}
        keyExtractor={(c) => `${c.name}|${c.state}`}
        keyboardShouldPersistTaps="handled" // one tap on a city picks it, even with the keyboard up
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          searching ? undefined : (
            <>
              <Text style={styles.heading}>Popular cities</Text>
              <View style={styles.chips}>
                {popularCities.map((c) => (
                  <Pressable
                    key={c.name}
                    onPress={() => pick(c)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isChosen(c) }}
                  >
                    <Glass style={styles.chip}>
                      {isChosen(c) && <View style={styles.dot} />}
                      <Text style={styles.chipText}>{c.name}</Text>
                    </Glass>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.heading}>All cities</Text>
            </>
          )
        }
        ListEmptyComponent={<Text style={[styles.noteText, styles.empty]}>No city matches “{query.trim()}”.</Text>}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={styles.letter} accessibilityElementsHidden importantForAccessibility="no">
              {section.title}
            </Text>
          ) : null
        }
        renderItem={({ item: c }) => (
          <Pressable
            onPress={() => pick(c)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${c.name}, ${c.state}`}
            accessibilityState={{ selected: isChosen(c) }}
          >
            <Text style={styles.rowName} numberOfLines={1}>
              {c.name}
            </Text>
            <Text style={[styles.rowState, styles.grow]} numberOfLines={1}>
              {c.state}
            </Text>
            {isChosen(c) && <View style={styles.dot} />}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, // on the glass (GlassFill), owner: "Glass for all"
  grow: { flex: 1, minWidth: 0 },
  head: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: font.headline, fontSize: 20, color: color.text },
  // The Settings pill in the blocked note (the sheet's own close is an X, CloseButton in src/rows.tsx).
  close: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  closeText: { fontFamily: font.title, fontSize: 13, color: color.text },

  search: { marginTop: space.big, marginHorizontal: 20 },
  current: { marginTop: space.small, marginHorizontal: 20, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  currentText: { fontFamily: font.title, fontSize: 15, color: color.text },
  note: { marginTop: space.small, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: space.small },
  noteText: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },

  list: { marginTop: space.small },
  heading: { marginTop: space.big, marginBottom: space.small, marginHorizontal: 20, fontFamily: font.title, fontSize: 15, color: color.text },
  chips: { marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontFamily: font.medium, fontSize: 14, color: color.text },
  letter: {
    paddingHorizontal: 20,
    paddingTop: space.small,
    paddingBottom: 4,
    fontFamily: font.title,
    fontSize: 13,
    color: color.secondary,
  },
  row: { minHeight: 44, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: space.small },
  pressed: { backgroundColor: color.card },
  rowName: { flexShrink: 0, fontFamily: font.medium, fontSize: 15, color: color.text },
  rowState: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  // The chosen city: the accent goes on a dot, never on text.
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  empty: { marginTop: space.big, marginHorizontal: 20 },
});
