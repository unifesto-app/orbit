// The categories as Explore's boxes: Search's Explore, and Account › Interests, where you pick the kinds of event you
// like (owner, 19 Nov 2026: "add interest cards for events"). One drawing and one colour each.
import { type CategorySlug, categories } from '@orbit/contract';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { SeatCard } from './rows';
import { color, font, space } from './theme';

// Each category's own colour (owner, 15 Nov 2026: "bring various accents to each explore", "also based on category
// give the accent"), for its 3D prop (src/props.tsx) and its card's glow: a terminal's cyan for hackathons, the
// spotlight's yellow for comedy, the pitch's green for sports, a screen's blue for film, and so on. Open Color's 8
// shades plus the brand blue.
export const CATEGORY_COLOR: Record<CategorySlug, string> = {
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
  hackathons: require('../assets/explore/hackathons.png'),
  comedy: require('../assets/explore/comedy.png'),
  music: require('../assets/explore/music.png'),
  meetups: require('../assets/explore/meetups.png'),
  workshops: require('../assets/explore/workshops.png'),
  fests: require('../assets/explore/fests.png'),
  sports: require('../assets/explore/sports.png'),
  film: require('../assets/explore/film.png'),
  startups: require('../assets/explore/startups.png'),
  gaming: require('../assets/explore/gaming.png'),
};
// A lone shape fills its whole square where a scene doesn't, so it's drawn smaller ("music is large, make little
// small"), and Fests, wide and short, a little bigger ("increase its size little"); scaled about the centre, so the
// card and its seat keep their size.
const ART_SCALE: Partial<Record<CategorySlug, number>> = { music: 0.85, fests: 1.15 };
// Explore's rows: three, three, then four (owner, 15 Nov 2026: "Explore Three Three Four"); the last row takes the rest.
const exploreRows = [categories.slice(0, 3), categories.slice(3, 6), categories.slice(6)];

// A category as a box like Home's host cards (owner, 15 Nov 2026: "add the Types in boxes same as hosts in home"): its
// drawing on the top rim where a host's logo sits, and its name, nothing else (owner: "from 1 event from card").
// Sized to its box, since a row of four is narrow: the drawing is about 62% of the width. `picked` (Interests) puts
// an accent dot before the name, as a chip's pick: an element, never accent text.
function CategoryCard({
  slug,
  label,
  width,
  picked,
  onPress,
}: {
  slug: CategorySlug;
  label: string;
  width: number;
  picked?: boolean;
  onPress: () => void;
}) {
  const size = Math.round(width * 0.62);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={picked === undefined ? undefined : { selected: picked }}>
      <SeatCard
        width={width}
        size={size}
        tint={CATEGORY_COLOR[slug]}
        dome={false}
        seat={<Image source={CATEGORY_ART[slug]} style={{ width: size, height: size, transform: [{ scale: ART_SCALE[slug] ?? 1 }] }} />}>
        <View style={styles.text}>
          {picked && <View style={styles.dot} />}
          <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {label}
          </Text>
        </View>
      </SeatCard>
    </Pressable>
  );
}

// Every category in Explore's rows of three, three and four, on the page's 20pt margins. `picked`, when given, marks
// the ones chosen; a tap calls `onPress` with the category.
export function CategoryGrid({ onPress, picked }: { onPress: (slug: CategorySlug) => void; picked?: readonly CategorySlug[] }) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.grid}>
      {exploreRows.map((row) => (
        <View key={row[0].slug} style={styles.row}>
          {row.map((c) => (
            <CategoryCard
              key={c.slug}
              slug={c.slug}
              label={c.label}
              width={(width - 40 - (row.length - 1) * space.small) / row.length}
              picked={picked && picked.includes(c.slug)}
              onPress={() => onPress(c.slug)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // 8 between boxes so three and four fit across; 16 between rows, room for each drawing poking over the edge.
  grid: { marginHorizontal: 20, gap: 16 },
  row: { flexDirection: 'row', gap: space.small },
  // Centred in the face below the drawing, since a category card has no button at the bottom.
  text: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: space.small },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  // Home's host card name, shrinking a little in the narrow row of four.
  name: { flexShrink: 1, fontFamily: font.title, fontSize: 14, color: color.text, textAlign: 'center' },
});
