// The round Inbox button with its unread count (owner, 22 Nov 2026: "Inbox"), lifted from Event Partner's tab bar for
// all three host apps (Notifications PR 5): beside the tabs on Event Partner and Play Partner, on Crew's one screen.
// While it shows, the inbox is read every minute (sign-in, coming back and a landed push read it too: src/push.tsx).
import { DARK_TINT as DARK, Glass } from '@orbit/mobile/glass';
import { BAR } from '@orbit/mobile/tabBar';
import { color, font } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Image, Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { badge } from './launch/inbox';
import { refreshInbox, useInbox } from './launch/inboxStore';
import { useSession } from './session';

const BELL = require('../assets/tabs/bell.png');

export function InboxButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { unread } = useInbox();
  const count = badge(unread);
  const me = useSession()?.me.id;
  useEffect(() => {
    if (!me) return;
    const every = setInterval(() => void refreshInbox(me), 60_000);
    return () => clearInterval(every);
  }, [me]);
  return (
    <Pressable
      onPress={() => router.push('/inbox')}
      accessibilityRole="button"
      accessibilityLabel={count ? `Inbox, ${unread} new` : 'Inbox'}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      <Glass tint={DARK} style={styles.ring}>
        <Image source={BELL} style={styles.bell} />
      </Glass>
      {count && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ring: { width: BAR, height: BAR, borderRadius: BAR / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bell: { width: 22, height: 22, tintColor: color.text },
  // The count on the accent (an element), Charcoal on Sage: Stone on Sage is only 2.3:1. Ringed in the ground colour.
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.ground,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.price, fontSize: 11, lineHeight: 14, color: color.onAccent },
  pressed: { opacity: 0.8 },
});
