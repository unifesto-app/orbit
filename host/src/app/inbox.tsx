// Each host app's Inbox (Event Partner's first; Play Partner and Crew since Notifications PR 5), from the round button
// beside the tabs (on Crew's screen). Inbox take 1, approved 22 Nov 2026
// (https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg): the Orbit app's Rows take (app/src/app/inbox.tsx), with the
// Notifications flow's messages to hosts. A heading per day, newest first, the last 180 days. Each row is the event's
// poster, the host's logo or Orbit's orb; who it's from and what it is; the whole message; the time; a Sage dot until
// it's opened. A tap marks it read; Mark all read sits by the title. The back circle and Settings stay pinned on top, with
// the app's bar glass fading in once the page scrolls under them; back goes back, or to the app's first screen when a
// push opened the Inbox with nothing under it.
// Messages come from GET /me/inbox (src/launch/inboxStore.ts), read again each time the Inbox opens.
// ponytail: no screen opens from a message yet (the refund request, the event's team, the link, the payout); each comes
// with its own take. Settings (which messages email you) waits for the account screens. A ScrollView suits the first
// page of 30; a SectionList when more pages load.
import { BarGlass, DARK_TINT, Glass } from '@orbit/mobile/glass';
import { ORB } from '@orbit/mobile/orbitSays';
import { color, font, space, stoneAt } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type Message, inboxDays, timeLabel } from '../launch/inbox';
import { markRead, refreshInbox, useInbox } from '../launch/inboxStore';
import { useSession } from '../session';
import { Monogram, Note, Pill, Section, styles as ui } from '../launch/ui';

const PICTURE = 44; // a logo or the orb; a poster is that wide at 3:4
const DAYS_APART = 40; // between days, as the Orbit app's sections
const BAR = 48; // the pinned bar: the 44pt back circle and a little room
const BACK = require('../../assets/tabs/chevron.png');

const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function Inbox() {
  const insets = useSafeAreaInsets();
  const [scrollY] = useState(() => new Animated.Value(0));
  const { loaded, messages, unread, error } = useInbox();
  const me = useSession()?.me.id;
  useEffect(() => {
    if (me) void refreshInbox(me);
  }, [me]);
  const days = inboxDays(messages, Date.now());
  const top = insets.top + 4;

  return (
    <View style={styles.page}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: top + BAR, paddingBottom: insets.bottom + space.big }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            Inbox
          </Text>
          {unread > 0 && <Pill label="Mark all read" onPress={() => markRead()} />}
        </View>
        {error && <Note>{error}</Note>}
        {!loaded ? null : days.length === 0 ? (
          !error && <Note>Nothing here yet.</Note>
        ) : (
          days.map((d, i) => (
            <View key={d.day} style={i > 0 && styles.dayGap}>
              <Section title={d.day} />
              <View style={styles.rows}>
                {d.items.map((m) => (
                  <MessageRow key={m.id} m={m} />
                ))}
              </View>
            </View>
          ))
        )}
      </Animated.ScrollView>

      {/* Pinned over the page: last, so it draws on top. */}
      <View style={[styles.bar, { paddingTop: top, height: top + BAR }]}>
        <BarGlass scrollY={scrollY} />
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={4} style={({ pressed }) => pressed && ui.pressed}>
          <Glass tint={DARK_TINT} style={styles.backCircle}>
            <Image source={BACK} style={styles.backMark} />
          </Glass>
        </Pressable>
        <Pill label="Settings" dark />
      </View>
    </View>
  );
}

function MessageRow({ m }: { m: Message }) {
  const at = timeLabel(m.at);
  return (
    <Pressable
      onPress={() => markRead([m.id])}
      accessibilityRole="button"
      accessibilityLabel={`${m.read ? '' : 'New. '}${m.from}, ${m.kind}. ${m.text} ${at}`}
      accessibilityHint={m.read ? undefined : 'Marks it read'}
      style={({ pressed }) => [styles.row, pressed && ui.pressed]}
    >
      <Picture of={m.picture} />
      <View style={styles.lines}>
        {/* Who gives way first, so what it is ("Refund request") always shows. */}
        <View style={styles.kickerRow}>
          <Text style={[styles.kicker, styles.from]} numberOfLines={1}>
            {m.from}
          </Text>
          <Text style={styles.kicker} numberOfLines={1}>{` · ${m.kind}`}</Text>
        </View>
        <Text style={[styles.text, m.read && styles.readText]}>{m.text}</Text>
        <Text style={styles.time}>{at}</Text>
      </View>
      <View style={styles.side}>{!m.read && <View style={styles.dot} />}</View>
    </Pressable>
  );
}

// The event's 3:4 poster (a grey card until posters come with the message), the host's 1:1 logo, or Orbit's orb for a
// message from Orbit.
function Picture({ of }: { of: Message['picture'] }) {
  if (of && 'event' in of) return <View style={styles.poster} />;
  if (of && 'host' in of) return <Monogram host={of.host} size={PICTURE} />;
  return <Image source={ORB} style={styles.orb} accessibilityIgnoresInvertColors />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backMark: { width: 18, height: 18, tintColor: color.text, transform: [{ scaleX: -1 }] }, // the > turned to face back
  // As tall as Mark all read, so the page doesn't jump when it goes.
  head: { minHeight: 32, marginTop: space.small, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.small },
  title: { flexShrink: 1, fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text },
  dayGap: { marginTop: DAYS_APART - space.big }, // Section brings a big gap of its own
  rows: { marginHorizontal: 20, gap: 20 }, // the Orbit app's feed rows: no rules between them, 20 apart
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  lines: { flex: 1, minWidth: 0, gap: 2 },
  // Who in a small grey label, the message leads, the time under it.
  kickerRow: { flexDirection: 'row' },
  kicker: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, color: color.secondary },
  from: { flexShrink: 1 },
  text: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  readText: { color: stoneAt(0.82) },
  time: { fontFamily: font.text, fontSize: 12, lineHeight: 16, color: color.secondary },
  side: { width: 12, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent }, // new: a dot, never accent text
  poster: { width: PICTURE, height: (PICTURE * 4) / 3, borderRadius: 6, backgroundColor: color.raised },
  orb: { width: PICTURE, height: PICTURE, borderRadius: PICTURE / 2 },
});
