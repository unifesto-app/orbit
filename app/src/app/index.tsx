import { formatPrice } from '@orbit/contract';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../icons';
import { Media } from '../media';
import { type EventCard, place, spotlight, thisWeek } from '../mock';
import { color, font } from '../theme';

// Same browse tiles as the web (web/src/app/discover.tsx). Categories are browse tiles only,
// with no alcohol or nightlife (plan, section 4).
const categories: { slug: string; label: string; icon: IconName }[] = [
  { slug: 'hackathons', label: 'Hackathons', icon: 'code' },
  { slug: 'comedy', label: 'Comedy', icon: 'comedy' },
  { slug: 'music', label: 'Music', icon: 'music' },
  { slug: 'meetups', label: 'Meetups', icon: 'group' },
  { slug: 'workshops', label: 'Workshops', icon: 'workshop' },
  { slug: 'fests', label: 'Fests', icon: 'fest' },
  { slug: 'sports', label: 'Sports', icon: 'sports' },
  { slug: 'theatre', label: 'Theatre', icon: 'theatre' },
  { slug: 'art', label: 'Art', icon: 'art' },
  { slug: 'film', label: 'Film', icon: 'film' },
  { slug: 'startups', label: 'Startups', icon: 'startup' },
  { slug: 'gaming', label: 'Gaming', icon: 'gaming' },
];

// Home, from the approved "Location first" header board. Search, tiles, cards and profile have
// no screens to open yet, so none of them are buttons until those screens exist.
export default function Home() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      {/* Keeps scrolled posters out from under the clock and notch. */}
      <View style={{ height: insets.top }} />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.header}>
          <View style={styles.place}>
            <Icon name="pin" size={22} color={color.accent} />
            <View>
              <View style={styles.areaRow}>
                <Text style={styles.area}>{place.area}</Text>
                <Icon name="caretDown" size={14} color={color.secondary} />
              </View>
              <Text style={styles.city}>{place.city}</Text>
            </View>
          </View>
          <View style={styles.profile}>
            <Icon name="user" size={20} color={color.text} />
          </View>
        </View>
  
        {/* "Spaces" became "hosts" on 14 Nov 2026, so the board's placeholder is reworded. */}
        <View style={styles.search}>
          <Icon name="search" size={20} color={color.secondary} />
          <Text style={styles.searchText}>Search events and hosts</Text>
        </View>
  
        <Text style={[styles.h2, styles.firstH2]} accessibilityRole="header">Explore</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
          {categories.map((c) => (
            <View key={c.slug} style={styles.tile}>
              <View style={styles.tileIcon}>
                <Icon name={c.icon} size={28} color={color.text} />
              </View>
              <Text style={styles.tileLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>{c.label}</Text>
            </View>
          ))}
        </ScrollView>
  
        <Text style={styles.h2} accessibilityRole="header">In the spotlight</Text>
        <View style={[styles.card, styles.gutter]}>
          <Media media={spotlight.media} frame="4:3" label={`Poster for ${spotlight.title}`} />
          <View style={styles.spotBody}>
            <View style={styles.status}>
              <View style={styles.dot} />
              <Text style={styles.statusText}>{spotlight.status}</Text>
            </View>
            <Text style={styles.spotTitle}>{spotlight.title}</Text>
            <Text style={styles.meta}>
              {spotlight.host} · {spotlight.area} · {spotlight.date}, {spotlight.time}
            </Text>
            <Text style={styles.spotPrice}>
              {formatPrice(spotlight.pricePaise)}
              {spotlight.pricePaise > 0 && <Text style={styles.meta}> per ticket</Text>}
            </Text>
          </View>
        </View>
  
        <Text style={styles.h2} accessibilityRole="header">This week</Text>
        <View style={[styles.list, styles.gutter]}>
          {thisWeek.map((e) => (
            <EventRow key={e.slug} event={e} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// Same layout as the web's event card: a 4:3 frame so the list stays even, then the details.
function EventRow({ event: e }: { event: EventCard }) {
  return (
    <View style={styles.card}>
      <Media media={e.media} frame="4:3" />
      <View style={styles.cardBody}>
        <View style={styles.when}>
          <Text style={[styles.meta, styles.shrink]}>{e.date} · {e.time}</Text>
          {/* Hosts with a following run things again and again: say so on the card. */}
          {e.repeats && (
            <View style={styles.repeat}>
              <Icon name="repeat" size={14} color={color.text} />
              <Text style={styles.repeatText}>{e.repeats}</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardTitle}>{e.title}</Text>
        <Text style={styles.meta}>{e.host} · {e.area}</Text>
        <Text style={styles.cardPrice}>{formatPrice(e.pricePaise)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  gutter: { marginHorizontal: 20 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  area: { fontFamily: font.headline, fontSize: 17, color: color.text },
  city: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  profile: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },

  search: {
    marginTop: 18,
    marginHorizontal: 20,
    minHeight: 48,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: color.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchText: { fontFamily: font.text, fontSize: 15, color: color.secondary },

  h2: { marginTop: 28, marginBottom: 12, marginHorizontal: 20, fontFamily: font.headline, fontSize: 20, color: color.text },
  firstH2: { marginTop: 26 },

  tiles: { paddingHorizontal: 20, gap: 10 },
  tile: { width: 80, alignItems: 'center', gap: 8 },
  tileIcon: { width: 80, height: 80, borderRadius: 18, backgroundColor: color.card, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: font.text, fontSize: 12, color: color.text },

  card: { borderRadius: 22, backgroundColor: color.card, overflow: 'hidden' },
  spotBody: { padding: 18, gap: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.accent },
  statusText: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  spotTitle: { fontFamily: font.headline, fontSize: 22, color: color.text },
  spotPrice: { marginTop: 6, fontFamily: font.price, fontSize: 22, color: color.text },
  meta: { fontFamily: font.text, fontSize: 14, color: color.secondary },

  list: { gap: 16 },
  cardBody: { padding: 16, gap: 4 },
  // Wraps the repeat pill under the date when large text makes the row too wide.
  when: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  shrink: { flexShrink: 1 },
  repeat: { minHeight: 24, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, backgroundColor: color.raised, flexDirection: 'row', alignItems: 'center', gap: 4 },
  repeatText: { fontFamily: font.medium, fontSize: 12, color: color.text },
  cardTitle: { fontFamily: font.title, fontSize: 17, color: color.text },
  cardPrice: { marginTop: 4, fontFamily: font.price, fontSize: 16, color: color.text },
});
