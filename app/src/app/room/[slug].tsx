// inRoom (inRoom flow; owner, 19 Nov 2026: "After-check-in bits"): a meetup's room, for people let in at the door.
// Being let in doesn't put you in it: you tap Join, and nobody sees you till you do (inRoom 3). In the room, everyone
// who joined, each with Ask to connect; a yes swaps the ways to reach each other, and there's never a chat. It stays
// open a week after the meetup (inRoom 7). Opened from the meetup's page and Home's Thanks for coming.
// Since 27 Nov 2026 (R3) a real meetup's room is the API's (src/rooms.ts): its six states, the join card (a line and
// one to three ways to reach you; name and photo are the account's), asks, the swap once accepted, Host marks and
// Block. The old mock's meetups keep the phone-only room below.
// Since 19 Nov 2026 a page like the event page (owner approved Take 7 of the detail pages mockup): the back circle on
// the dark glass, inRoom at the title's size on the left, Orbit saying what the room is with Join the room as your
// answer, and everyone in it as plain rows like the event page's people, each with Ask to connect.
import { type Me, ROOM_LINE_MAX, ROOM_REACH_MAX, type RoomCard, type RoomMember, type RoomView } from '@orbit/contract';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { past as history } from '../../account/data';
import { Chips, Field, Pill } from '../../account/kit';
import { Photo } from '../../account/profile';
import type { Result } from '../../api';
import { dayLabel } from '../../booking';
import { meetups } from '../../kinds';
import type { Person } from '../../events';
import { useLoad } from '../../load';
import { events, now, people } from '../../mock';
import { OrbitSays } from '../../orbitSays';
import { actionOf, cardOf, keyboardOf, pickChip, REACH_CHIPS, rowChip, type ReachRow, roomSays, roomsApi } from '../../rooms';
import { BackBar, Failed, Monogram, NotFound, SECTION, Section, Tag, TOP, Waiting } from '../../rows';
import { api, askToConnect, needsAccount, real, setInRoom, useAsked, useInRoom, useLetIn, useSession, useViewer } from '../../session';
import { color, font, space } from '../../theme';

const PHOTO = 44; // as the event page's people

const OPEN_FOR = 3 * 3_600_000 + 7 * 86_400_000; // the meetup (about three hours) and a week after

export default function Room() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return real(slug) ? <LiveRoom eventId={slug} /> : <MockRoom slug={slug} />;
}

// The old mock's meetups, on this phone only (as before R3).
function MockRoom({ slug }: { slug: string }) {
  const insets = useSafeAreaInsets();
  const viewer = useViewer();
  const joined = useInRoom(slug);
  const atDoor = useLetIn(slug); // a real event: your ticket was checked in
  const e = events.find((x) => x.id === slug);
  if (!e || !meetups[e.id]?.inRoom) return <NotFound what="room" />;
  const letIn = viewer.signedIn && (real(e.id) ? atDoor : history.some((h) => h.eventId === e.id && h.status === 'Went'));
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
          <OrbitSays top={SECTION} text="The room opens at the door: once your ticket is checked in, you can join." />
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

// A real meetup's room, read from the API each visit and again after every tap (the answer is the room as it is now).
// Signed out, sign in first. A refusal (the 429 daily cap, a 409, a 403 with the room's new state) shows the API's own
// words, then the room is read again.
function LiveRoom({ eventId }: { eventId: string }) {
  const insets = useSafeAreaInsets();
  const me = useSession()?.me;
  // A failure comes back as a fresh object each time (the API hands out shared OFFLINE / BROKEN ones), so every read that
  // lands changes `room` and `seen` below lets go of busy, even after two failures alike.
  const room = useLoad(me ? `room|${me.id}|${eventId}` : null, () => roomsApi(api).get(eventId).then((r) => (r.ok ? r : { ...r, error: { ...r.error } })));
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  // Busy from the tap until the room is read again, so a second tap can't answer the same ask twice.
  const [seen, setSeen] = useState<unknown[]>([room.data, room.error]);
  if (seen[0] !== room.data || seen[1] !== room.error) {
    setSeen([room.data, room.error]);
    setBusy(false);
  }

  if (me && room.status === 404) return <NotFound what="room" />;
  if (me && !room.data) return room.error ? <Failed message={room.error.message} retry={room.reload} /> : <Waiting />;
  const v = room.data;

  async function act(failed: string, run: () => Promise<Result<unknown>>) {
    setBusy(true);
    const r = await run();
    if (!r.ok) Alert.alert(failed, r.error.message);
    room.reload();
    return r.ok;
  }
  const rooms = roomsApi(api);
  const putCard = async (card: RoomCard) => {
    if (await act('Couldn’t save your card', () => rooms.putCard(eventId, card))) setEditing(false);
  };
  const block = (m: RoomMember) =>
    Alert.alert(`Block ${m.name}?`, 'You won’t see each other in any room on Orbit again. If you’re connected, you both lose how to reach each other, and any asks between you go.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => void act('Couldn’t block them', () => rooms.block(eventId, m.id)) },
    ]);
  const says = v && roomSays(v.state, v.members.length);

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingTop: insets.top + TOP, paddingBottom: insets.bottom + space.big }}>
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            inRoom
          </Text>
          {v && (
            <Text style={styles.sub}>
              {v.event.title} · {dayLabel(Date.parse(v.event.startsAt))}
            </Text>
          )}
        </View>
        {!me || !v ? (
          <OrbitSays top={SECTION} text="Sign in to see the room." answers={[{ label: 'Sign in', onPress: () => needsAccount() }]} />
        ) : (
          <>
            {/* A read after a tap failed: what's below may be out of date, so say so. */}
            {room.error && (
              <OrbitSays top={SECTION} text={`Couldn’t refresh the room, so this may be out of date. ${room.error.message}`} answers={[{ label: 'Try again', onPress: room.reload }]} />
            )}
            {says && <OrbitSays top={SECTION} text={says} />}
            {v.state === 'door' && <CardForm me={me} card={v.me} submit="Join the room" busy={busy} onSubmit={putCard} />}
            {v.state === 'in' && v.me && (
              <>
                <Section top={SECTION} title={`Here · ${v.members.length + 1}`} />
                {editing ? (
                  <CardForm me={me} card={v.me} submit="Save card" busy={busy} onSubmit={putCard} onCancel={() => setEditing(false)} />
                ) : (
                  <View style={styles.people}>
                    <View style={styles.row}>
                      <Photo me={me} size={PHOTO} />
                      <View style={styles.grow}>
                        <Text style={styles.name}>You</Text>
                        <Text style={styles.meta}>{v.me.line}</Text>
                        <Reach reach={v.me.reach} />
                        <View style={styles.pills}>
                          <Pill label="Edit card" size="small" disabled={busy} onPress={() => setEditing(true)} />
                          <Pill label="Leave the room" size="small" muted disabled={busy} onPress={() => void act('Couldn’t leave the room', () => rooms.leave(eventId))} />
                        </View>
                      </View>
                    </View>
                  </View>
                )}
                <View style={[styles.people, styles.others]}>
                  {v.members.map((m) => (
                    <LiveMember
                      key={m.id}
                      member={m}
                      busy={busy}
                      onAsk={() => void act('Couldn’t ask', () => rooms.ask(eventId, m.id))}
                      onAnswer={(yes) => void act('Couldn’t answer', () => (yes ? rooms.accept : rooms.decline)(eventId, m.askId!))}
                      onBlock={() => block(m)}
                    />
                  ))}
                </View>
              </>
            )}
            {v.state === 'closed' && v.members.length > 0 && (
              <>
                <Section top={SECTION} title={`Connected · ${v.members.length}`} />
                <View style={styles.people}>
                  {v.members.map((m) => (
                    <LiveMember key={m.id} member={m} busy={busy} onBlock={() => block(m)} />
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
      <BackBar dark />
    </View>
  );
}

// The join card: your name and photo from your account (change them in Edit profile), a line, and one to three ways to
// reach you, each labelled Phone, Email or anything else (Other), shown only to people you connect with.
function CardForm({
  me,
  card,
  submit,
  busy,
  onSubmit,
  onCancel,
}: {
  me: Me;
  card: RoomView['me'];
  submit: string;
  busy: boolean;
  onSubmit: (card: RoomCard) => void;
  onCancel?: () => void;
}) {
  const [line, setLine] = useState(card?.line ?? '');
  const [rows, setRows] = useState<ReachRow[]>(card?.reach.length ? card.reach : [{ label: 'Phone', value: '' }]);
  const [error, setError] = useState<string | null>(null);
  const change = (i: number, row: Partial<ReachRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...row } : r)));
  const send = () => {
    const c = cardOf(line, rows);
    setError('error' in c ? c.error : null);
    if ('card' in c) onSubmit(c.card);
  };
  return (
    <View style={styles.form}>
      <View style={styles.row}>
        <Photo me={me} size={PHOTO} />
        <View style={styles.grow}>
          <Text style={styles.name} numberOfLines={1}>
            {me.name ?? 'You'}
          </Text>
          <Text style={styles.meta}>Your name and photo, from your profile</Text>
        </View>
      </View>
      <Field label="Your line" value={line} onChangeText={setLine} maxLength={ROOM_LINE_MAX} placeholder="What you do, or what you’re here for" />
      {rows.map((r, i) => (
        <View key={i} style={styles.reachRow}>
          <Chips options={REACH_CHIPS} value={rowChip(r)} onChange={(c) => setRows(rows.map((x, j) => (j === i ? pickChip(x, c) : x)))} />
          {rowChip(r) === 'Other' && <Field label="Label" value={r.label} onChangeText={(label) => change(i, { label })} maxLength={24} placeholder="Instagram" />}
          <Field
            label={r.label || 'How to reach you'}
            value={r.value}
            onChangeText={(value) => change(i, { value })}
            keyboardType={keyboardOf(r.label)}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={120}
          />
          {rows.length > 1 && <Pill label="Remove" size="small" muted onPress={() => setRows(rows.filter((_, j) => j !== i))} />}
        </View>
      ))}
      {rows.length < ROOM_REACH_MAX && <Pill label="Add a way to reach you" size="small" onPress={() => setRows([...rows, { label: 'Phone', value: '' }])} />}
      <Text style={styles.meta}>Only people you connect with see how to reach you.</Text>
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Pill label={busy ? 'Saving…' : submit} size="wide" disabled={busy} onPress={send} />
      {onCancel && <Pill label="Cancel" size="wide" muted disabled={busy} onPress={onCancel} />}
    </View>
  );
}

// One person in a real room, a plain row like the event page's people: their action from the ask between you (none
// once the room has closed), their reach once you're connected, and Block.
function LiveMember({
  member: m,
  busy,
  onAsk,
  onAnswer,
  onBlock,
}: {
  member: RoomMember;
  busy: boolean;
  onAsk?: () => void; // none once the room has closed
  onAnswer?: (yes: boolean) => void;
  onBlock: () => void;
}) {
  const action = actionOf(m.ask);
  return (
    <View style={styles.row}>
      <Photo me={m} size={PHOTO} />
      <View style={styles.grow}>
        <View style={styles.named}>
          <Text style={[styles.name, styles.shrink]} numberOfLines={1}>
            {m.name}
          </Text>
          {m.host && <Tag text="Host" />}
        </View>
        <Text style={styles.meta}>{m.line}</Text>
        {action === 'reach' && <Reach reach={m.reach} />}
        <View style={styles.pills}>
          {onAsk && action === 'ask' && <Pill label="Ask to connect" size="small" disabled={busy} onPress={onAsk} />}
          {onAsk && action === 'asked' && <Pill label="Asked" size="small" muted />}
          {onAnswer && action === 'answer' && m.askId && (
            <>
              <Pill label="Accept" size="small" disabled={busy} onPress={() => onAnswer(true)} />
              <Pill label="Decline" size="small" muted disabled={busy} onPress={() => onAnswer(false)} />
            </>
          )}
          {/* ponytail: Report comes with R2 (the person reports API); it goes here, beside Block, and must land before release. */}
          <Pill label="Block" size="small" muted disabled={busy} onPress={onBlock} accessibilityLabel={`Block ${m.name}`} />
        </View>
      </View>
    </View>
  );
}

function Reach({ reach }: { reach?: readonly { label: string; value: string }[] }) {
  return reach?.map((r, i) => (
    <Text key={i} style={styles.reach} selectable>
      {r.label} · {r.value}
    </Text>
  ));
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
  // The real room's (R3).
  others: { marginTop: 16 },
  named: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  shrink: { flexShrink: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small, marginTop: space.small },
  reach: { marginTop: 2, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.text },
  form: { marginHorizontal: 20, marginTop: space.big, gap: 16 },
  reachRow: { gap: space.small },
  error: { fontFamily: font.title, fontSize: 13, lineHeight: 18, color: color.text },
});
