// Notifications, the inbox (Notifications doc, "The inbox and where each message opens"), from the bell in Home's
// header. The owner picked the Rows take on 19 Nov 2026 (https://claude.ai/artifact/4H6dp7ssrQbNXCJ4kSBj2b): Home's feed
// rows, a heading per day, newest first, the last 180 days (the API keeps them). Each row is the event's poster, the
// host's logo or Orbit's orb; an icon for what it is, then what it is (the sender's name only for screen readers; owner,
// 25 Nov 2026: "in notifications, instead of name, use icon"); the message; the time; a Sage dot until it's opened. A
// tap marks it read and opens its own screen (src/inbox.ts); one with no screen of its own shows the whole message in
// place. Mark all read sits by the title, a gear for Settings (Account › Notifications) at the top right. It fills even
// with push off.
// The messages are the API's (src/inboxStore.ts): read again on opening and on a pull, the next 30 near the end.
import { type Href, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Note, Page, Pill, SignInNote, styles as kit } from '../account/kit';
import { type IconName, Icon } from '../icons';
import { inboxDays, type InboxItem, timeLabel } from '../inbox';
import { loadInbox, loadMore, markRead, type Message, useInbox, useUnread } from '../inboxStore';
import { events, hosts } from '../mock';
import { ORB } from '../orbitSays';
import { CircleButton, Monogram, Poster, Section } from '../rows';
import { useSignedIn } from '../session';
import { color, font, space, stoneAt } from '../theme';

const PICTURE = 44; // a logo or the orb; a poster is that wide at 3:4
const DAYS_APART = 40; // between days, as Home's sections (owner, 19 Nov 2026: "add proper gaps b/w sections")
// Account's icon where it has one: Tickets, Following, Location, Refunds, Sign-in and security.
const ICON: Record<InboxItem['type'], IconName> = {
  announcement: 'megaphone',
  reminder: 'alarm',
  follow: 'following',
  near: 'pin',
  ticket: 'ticket',
  refund: 'refund',
  inRoom: 'group',
  thanks: 'heart', // Loved it
  account: 'key',
};

export default function Inbox() {
  const signedIn = useSignedIn();
  const { messages, loaded, more } = useInbox();
  const unread = useUnread(); // the API's count: pages not read in yet count too
  const [shown, setShown] = useState<string | null>(null); // a message with no screen, opened in place
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now); // the day headings', taken again each time the inbox comes into view
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      void loadInbox();
    }, []),
  );
  const refresh = () => {
    setRefreshing(true);
    void loadInbox().finally(() => setRefreshing(false));
  };
  if (!signedIn)
    return (
      <Page title="Notifications">
        <SignInNote>Sign in to see your notifications.</SignInNote>
      </Page>
    );

  const days = inboxDays(messages, now);
  const open = (m: Message) => {
    if (m.unread) markRead([m.id]);
    if (m.href) router.push(m.href as Href);
    else setShown(shown === m.id ? null : m.id); // a second tap folds it again
  };

  return (
    <Page
      refresh={{ refreshing, onRefresh: refresh }}
      onEnd={more ? () => void loadMore() : undefined}
      bar={<CircleButton icon="gear" label="Notification settings" onPress={() => router.push('/account/notifications')} />}>
      <View style={styles.head}>
        <Text style={[kit.title, styles.title]} accessibilityRole="header">
          Notifications
        </Text>
        {unread && <Pill label="Mark all read" size="small" onPress={() => markRead()} />}
      </View>
      {days.length === 0 ? (
        loaded && <Note>Nothing here yet.</Note>
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
        <View style={styles.kickerRow}>
          <Icon name={ICON[m.type]} size={16} color={color.secondary} />
          <Text style={[styles.kicker, styles.shrink]} numberOfLines={1}>
            {m.kind}
          </Text>
        </View>
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
// An id this build doesn't know (the API sends none yet, notification-emails.ts opensFor) falls through to the orb.
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
  rows: { marginHorizontal: 20, gap: 20 }, // Home's feed rows: no rules between them, 20 apart
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pressed: { opacity: 0.7 },
  lines: { flex: 1, minWidth: 0, gap: 2 },
  // As Home's feed rows: what it is in a small grey label, the message leads, the time under it.
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shrink: { flexShrink: 1 },
  kicker: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, color: color.secondary },
  text: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  readText: { color: stoneAt(0.82) },
  time: { fontFamily: font.text, fontSize: 12, lineHeight: 16, color: color.secondary },
  side: { width: 12, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent }, // unread: a dot, never accent text
  orb: { width: PICTURE, height: PICTURE, borderRadius: PICTURE / 2 },
});
