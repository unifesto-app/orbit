// inRoom (inRoom flow; owner, 19 Nov 2026: "After-check-in bits"): a meetup's room, for people let in at the door.
// Being let in doesn't put you in it: you tap Join, and nobody sees you till you do (inRoom 3). In the room, everyone
// who joined, each with Ask to connect; a yes swaps the ways to reach each other, and there's never a chat. It stays
// open a week after the meetup (inRoom 7). Opened from the meetup's page and Home's Thanks for coming.
// ponytail: on this phone only, with the mock's people as the room; the API's room, the swap itself, Host marks and
// blocking come with inRoom (P16).
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { past as history } from '../../account/data';
import { Group, Note, Page, Pill, Row } from '../../account/kit';
import { meetups } from '../../kinds';
import { events, now, people, type Person } from '../../mock';
import { Monogram, NotFound } from '../../rows';
import { askToConnect, setInRoom, useAsked, useInRoom, useViewer } from '../../session';
import { color, font, space } from '../../theme';

const OPEN_FOR = 3 * 3_600_000 + 7 * 86_400_000; // the meetup (about three hours) and a week after

export default function Room() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const viewer = useViewer();
  const joined = useInRoom(slug);
  const e = events.find((x) => x.id === slug);
  if (!e || !meetups[e.id]?.inRoom) return <NotFound what="room" />;
  const letIn = viewer.signedIn && history.some((h) => h.eventId === e.id && h.status === 'Went');
  const open = now < Date.parse(e.startsAt) + OPEN_FOR;
  // ponytail: the mock's people stand in for whoever joined.
  const here = people.slice(0, 5);

  return (
    <Page title="inRoom">
      <Text style={styles.sub}>
        {e.title} · {e.when}
      </Text>
      {!letIn ? (
        <Note>The room opens to people let in at the door.</Note>
      ) : !open ? (
        <Note>This room has closed. Rooms stay open a week after the meetup.</Note>
      ) : !joined ? (
        <View style={styles.intro}>
          <Text style={styles.prose}>
            Join to see who else was here, and let them see you. Ask anyone to connect: if they say yes, you swap the ways
            to reach each other. There’s no chat.
          </Text>
          <Pill label="Join the room" size="wide" onPress={() => setInRoom(e.id, true)} />
        </View>
      ) : (
        <>
          <Group title={`Here · ${here.length + 1}`}>
            <Row label="You" note="Others in the room can see you now" />
            {here.map((p) => (
              <Member key={p.id} eventId={e.id} person={p} />
            ))}
          </Group>
          <View style={styles.leave}>
            <Pill label="Leave the room" size="wide" muted onPress={() => setInRoom(e.id, false)} />
          </View>
        </>
      )}
    </Page>
  );
}

function Member({ eventId, person: p }: { eventId: string; person: Person }) {
  const asked = useAsked(eventId, p.id);
  return (
    <Row
      lead={<Monogram mark={p} size={40} round />}
      label={p.name}
      note={p.headline}
      right={<Pill label={asked ? 'Asked' : 'Ask to connect'} size="small" muted={asked} onPress={asked ? undefined : () => askToConnect(eventId, p.id)} />}
    />
  );
}

const styles = StyleSheet.create({
  sub: { marginHorizontal: 20, marginTop: 4, fontFamily: font.medium, fontSize: 14, color: color.secondary },
  intro: { marginHorizontal: 20, marginTop: space.big, gap: space.big },
  prose: { fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  leave: { marginHorizontal: 20, marginTop: space.big },
});
