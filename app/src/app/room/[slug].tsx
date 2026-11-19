// inRoom (inRoom flow; owner, 19 Nov 2026: "After-check-in bits"): a meetup's room, for people let in at the door.
// Being let in doesn't put you in it: you tap Join, and nobody sees you till you do (inRoom 3). In the room, everyone
// who joined, each with Ask to connect; a yes swaps the ways to reach each other, and there's never a chat. It stays
// open a week after the meetup (inRoom 7). Opened from the meetup's page and Home's Thanks for coming.
// ponytail: on this phone only, with the mock's people as the room; the API's room, the swap itself, Host marks and
// blocking come with inRoom (P16).
// Since 19 Nov 2026 a page like the event page (owner approved Take 7 of the detail pages mockup): the back circle on
// the dark glass, inRoom at the title's size on the left, Orbit saying what the room is with Join the room as your
// answer, and everyone in it as plain rows like the event page's people, each with Ask to connect.
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { past as history } from '../../account/data';
import { Pill } from '../../account/kit';
import { meetups } from '../../kinds';
import { events, now, people, type Person } from '../../mock';
import { OrbitSays } from '../../orbitSays';
import { BackBar, Monogram, NotFound, SECTION, Section, TOP } from '../../rows';
import { askToConnect, setInRoom, useAsked, useInRoom, useViewer } from '../../session';
import { color, font, space } from '../../theme';

const PHOTO = 44; // as the event page's people

const OPEN_FOR = 3 * 3_600_000 + 7 * 86_400_000; // the meetup (about three hours) and a week after

export default function Room() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const viewer = useViewer();
  const joined = useInRoom(slug);
  const e = events.find((x) => x.id === slug);
  if (!e || !meetups[e.id]?.inRoom) return <NotFound what="room" />;
  const letIn = viewer.signedIn && history.some((h) => h.eventId === e.id && h.status === 'Went');
  const open = now < Date.parse(e.startsAt) + OPEN_FOR;
  // ponytail: the mock's people stand in for whoever joined.
  const here = people.slice(0, 5);

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + TOP, paddingBottom: insets.bottom + space.big }}>
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            inRoom
          </Text>
          <Text style={styles.sub}>
            {e.title} · {e.when}
          </Text>
        </View>
        {!letIn ? (
          <OrbitSays top={SECTION} text="The room opens to people let in at the door." />
        ) : !open ? (
          <OrbitSays top={SECTION} text="This room has closed. Rooms stay open a week after the meetup." />
        ) : !joined ? (
          <OrbitSays
            top={SECTION}
            text="Join to see who else was here, and let them see you. Ask anyone to connect: if they say yes, you swap the ways to reach each other. There’s no chat."
            answers={[{ label: 'Join the room', onPress: () => setInRoom(e.id, true) }]}
          />
        ) : (
          <>
            <Section top={SECTION} title={`Here · ${here.length + 1}`} />
            <View style={styles.people}>
              {/* You first, in your own circle (Forest, as the profile's). */}
              <View style={styles.row}>
                <Monogram mark={{ initials: viewer.initial ?? 'Y', bg: color.fill, fg: color.text }} size={PHOTO} round />
                <View style={styles.grow}>
                  <Text style={styles.name}>You</Text>
                  <Text style={styles.meta}>Others in the room can see you now</Text>
                </View>
              </View>
              {here.map((p) => (
                <Member key={p.id} eventId={e.id} person={p} />
              ))}
            </View>
            <View style={styles.leave}>
              <Pill label="Leave the room" size="wide" muted onPress={() => setInRoom(e.id, false)} />
            </View>
          </>
        )}
      </ScrollView>
      <BackBar dark />
    </View>
  );
}

// One person in the room, a plain row like the event page's people, with Ask to connect (Asked once sent).
function Member({ eventId, person: p }: { eventId: string; person: Person }) {
  const asked = useAsked(eventId, p.id);
  return (
    <View style={styles.row}>
      <Monogram mark={p} size={PHOTO} round />
      <View style={styles.grow}>
        <Text style={styles.name} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {p.headline}
        </Text>
      </View>
      <Pill label={asked ? 'Asked' : 'Ask to connect'} size="small" muted={asked} onPress={asked ? undefined : () => askToConnect(eventId, p.id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  // Left, as the event page's head; the event title's size.
  head: { marginHorizontal: 20 },
  title: { fontFamily: font.headline, fontSize: 26, lineHeight: 32, color: color.text },
  sub: { marginTop: 4, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  people: { marginHorizontal: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  leave: { marginHorizontal: 20, marginTop: SECTION },
});
