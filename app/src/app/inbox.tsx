// Notifications, the inbox (Notifications doc, "The inbox and where each message opens"), from the bell in Home's
// header. The owner picked the Rows take on 19 Nov 2026 (https://claude.ai/artifact/4H6dp7ssrQbNXCJ4kSBj2b): Home's feed
// rows, a heading per day, newest first, the last 180 days. Each row is the event's poster, the host's logo or Orbit's
// orb; who it's from and what it is; the message; the time; a Sage dot until it's opened. A tap marks it read and opens
// its own screen (src/inbox.ts); one with no screen of its own shows the whole message in place. Mark all read sits by
// the title, Settings (Account › Notifications) at the top right. It fills even with push off.
// ponytail: the mock's messages (src/inboxStore.ts); the API's inbox, refreshed on open and every minute, replaces them.
import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Note, Page, Pill, SignInNote, styles as kit } from '../account/kit';
import { inboxDays, timeLabel } from '../inbox';
import { type Message, useInbox } from '../inboxStore';
import { events, hosts, now } from '../mock';
import { ORB } from '../orbitSays';
import { Monogram, Poster, Section } from '../rows';
import { markRead, useSignedIn } from '../session';
import { color, font, space, stoneAt } from '../theme';

const PICTURE = 44; // a logo or the orb; a poster is that wide at 3:4
const DAYS_APART = 40; // between days, as Home's sections (owner, 19 Nov 2026: "add proper gaps b/w sections")

export default function Inbox() {
  const signedIn = useSignedIn();
  const messages = useInbox();
  const [shown, setShown] = useState<string | null>(null); // a message with no screen, opened in place
  if (!signedIn)
    return (
      <Page title="Notifications">
        <SignInNote>Sign in to see your notifications.</SignInNote>
      </Page>
    );

  const unread = messages.filter((m) => m.unread).map((m) => m.id);
  const days = inboxDays(messages, now);
  const open = (m: Message) => {
    markRead([m.id]);
    if (m.href) router.push(m.href as Href);
    else setShown(shown === m.id ? null : m.id); // a second tap folds it again
  };

  return (
    <Page
      bar={
        <View style={styles.barPill}>
          <Pill label="Settings" size="small" onPress={() => router.push('/account/notifications')} />
        </View>
      }>
      <View style={styles.head}>
        <Text style={[kit.title, styles.title]} accessibilityRole="header">
          Notifications
        </Text>
        {unread.length > 0 && <Pill label="Mark all read" size="small" onPress={() => markRead(unread)} />}
      </View>
      {days.length === 0 ? (
        <Note>Nothing here yet.</Note>
      ) : (
        days.map((d, i) => (
          <View key={d.day}>
            <Section title={d.day} top={i ? DAYS_APART : space.big} />
            <View style={styles.rows}>
              {d.items.map((m) => (
                <MessageRow key={m.id} m={m} whole={shown === m.id} onPress={() => open(m)} />
              ))}
            </View>
          </View>
        ))
      )}
    </Page>
  );
}

function MessageRow({ m, whole, onPress }: { m: Message; whole: boolean; onPress: () => void }) {
  const at = timeLabel(m.at);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={m.href ? undefined : { expanded: whole }}
      accessibilityLabel={`${m.unread ? 'New. ' : ''}${m.from}, ${m.kind}. ${m.text} ${at}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Picture of={m.picture} />
      <View style={styles.lines}>
        <Text style={styles.kicker} numberOfLines={1}>
          {m.from} · {m.kind}
        </Text>
        <Text style={[styles.text, !m.unread && styles.readText]} numberOfLines={whole ? undefined : 2}>
          {m.text}
        </Text>
        <Text style={styles.time}>{at}</Text>
      </View>
      <View style={styles.side}>{m.unread && <View style={styles.dot} />}</View>
    </Pressable>
  );
}

// The event's 3:4 poster, the host's 1:1 logo, or Orbit's orb for a message from Orbit (or about an event that's gone).
function Picture({ of }: { of: Message['picture'] }) {
  const e = of && 'event' in of ? events.find((x) => x.id === of.event) : undefined;
  if (e) return <Poster media={e.poster} width={PICTURE} label={e.title} />;
  const h = of && 'host' in of ? hosts.find((x) => x.id === of.host) : undefined;
  if (h) return <Monogram mark={h} size={PICTURE} />;
  return <Image source={ORB} style={styles.orb} accessibilityIgnoresInvertColors />;
}

const styles = StyleSheet.create({
  head: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.small },
  title: { marginHorizontal: 0, flexShrink: 1 },
  barPill: { height: 44, justifyContent: 'center' },
  rows: { marginHorizontal: 20, gap: 20 }, // Home's feed rows: no rules between them, 20 apart
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pressed: { opacity: 0.7 },
  lines: { flex: 1, minWidth: 0, gap: 2 },
  // As Home's feed rows: who in a small grey label, the message leads, the time under it.
  kicker: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, color: color.secondary },
  text: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  readText: { color: stoneAt(0.82) },
  time: { fontFamily: font.text, fontSize: 12, lineHeight: 16, color: color.secondary },
  side: { width: 12, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent }, // unread: a dot, never accent text
  orb: { width: PICTURE, height: PICTURE, borderRadius: PICTURE / 2 },
});
