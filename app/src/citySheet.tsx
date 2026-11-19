// The city pick two sheets share: the location screen (src/app/location.tsx) and Edit profile's city for new events
// (src/app/account/city.tsx). A title and its X, the search, whatever the sheet adds under it (`children`), then Popular
// cities and every city A to Z, from the one list in @orbit/contract. Only the cities scroll; the rest stays put.
// Only cities in Telangana and Andhra Pradesh can be picked; the rest say Coming soon (owner, 19 Nov 2026: "only ap &
// telangana. other than it unserviceable. or coming soon"). Popular cities are all open ones.
import { allCities, type City, isServedState, popularCities, searchCities } from '@orbit/contract';
import { type ReactNode, useState } from 'react';
import { Platform, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from './glass';
import { CloseButton, GlassFill, SearchBox } from './rows';
import { color, font, space, stoneAt } from './theme';

// Every city A to Z under its first letter, as the list's sections.
const byLetter = [
  ...allCities.reduce((m, c) => m.set(c.name[0], [...(m.get(c.name[0]) ?? []), c]), new Map<string, City[]>()),
].map(([title, data]) => ({ title, data }));

export function CitySheet({
  title,
  chosen,
  onPick,
  children,
}: {
  title: string;
  chosen: (c: City) => boolean; // marked with the accent dot
  onPick: (c: City) => void;
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const results = searchCities(query).slice(0, 50);

  return (
    // A sheet on iOS, so a small gap at its top; full screen on Android, so clear of the status bar.
    <View style={[styles.screen, { paddingTop: Platform.OS === 'ios' ? space.big : insets.top + space.small }]}>
      <GlassFill />
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <CloseButton />
      </View>

      {/* Not focused on open: the keyboard would cover the Popular cities (the web does the same on phones). */}
      <SearchBox
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => {
          const first = results.find((c) => isServedState(c.state));
          if (first) onPick(first);
        }}
        placeholder="Search for your city"
        accessibilityLabel="Search for your city"
        autoCapitalize="words"
        maxLength={60}
      />

      {children}

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
                  <Pressable key={c.name} onPress={() => onPick(c)} accessibilityRole="button" accessibilityState={{ selected: chosen(c) }}>
                    <Glass style={styles.chip}>
                      {chosen(c) && <View style={styles.dot} />}
                      <Text style={styles.chipText}>{c.name}</Text>
                    </Glass>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.heading}>All cities</Text>
            </>
          )
        }
        ListEmptyComponent={<Text style={styles.empty}>No city matches “{query.trim()}”.</Text>}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <Text style={styles.letter} accessibilityElementsHidden importantForAccessibility="no">
              {section.title}
            </Text>
          ) : null
        }
        renderItem={({ item: c }) => {
          const open = isServedState(c.state);
          return (
            <Pressable
              onPress={() => onPick(c)}
              disabled={!open}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${c.state}${open ? '' : ', coming soon'}`}
              accessibilityState={{ selected: chosen(c), disabled: !open }}
            >
              <Text style={[styles.rowName, !open && styles.soonName]} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={styles.rowState} numberOfLines={1}>
                {c.state}
              </Text>
              {open ? chosen(c) && <View style={styles.dot} /> : <Text style={styles.soon}>Coming soon</Text>}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, // on the glass (GlassFill), owner: "Glass for all"
  head: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: font.headline, fontSize: 20, color: color.text },
  search: { marginTop: space.big, marginHorizontal: 20 },

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
  pressed: { backgroundColor: stoneAt(0.08) }, // as a menu row's
  rowName: { flexShrink: 0, fontFamily: font.medium, fontSize: 15, color: color.text },
  rowState: { flex: 1, minWidth: 0, fontFamily: font.text, fontSize: 13, color: color.secondary },
  soonName: { color: color.secondary }, // not open yet: grey, and it can't be picked
  soon: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  // The chosen city: the accent goes on a dot, never on text.
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  empty: { marginTop: space.big, marginHorizontal: 20, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
