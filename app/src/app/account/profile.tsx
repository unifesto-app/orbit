// Your profile, its own screen (owner, 16 Nov 2026: "the profile should be a seperate screen"; User doc, decision 6:
// kept): photo, name, member since, going and been counts, Edit profile, and the hosts you follow. Only you see it.
// Opened from Account by pulling its panel down or tapping the chevrons. Its top is Account's glass panel fully grown,
// REVEAL taller than at rest with the head grown, so as it fades in (src/app/_layout.tsx) it carries on from the panel
// you pulled. The back circle returns to Account, as on every Account screen.
import { router } from 'expo-router';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { Page, Panel, Pill, REVEAL } from '../../account/kit';
import { ProfileHead } from '../../account/profile';
import { hosts } from '../../mock';
import { Monogram, Section, Verified } from '../../rows';
import { useViewer } from '../../session';
import { color, font, space } from '../../theme';

export default function Profile() {
  const { follows } = useViewer(); // the follows made on this phone (src/session.ts)
  const following = hosts.filter((h) => follows.includes(h.id));
  const [grown] = useState(() => new Animated.Value(1).interpolate({ inputRange: [0, 1], outputRange: [0, 1] }));
  return (
    <Page>
      <Panel extra={REVEAL} settled>
        <ProfileHead p={grown} />
      </Panel>
      {/* Moved here from Account's head (owner, 15 Nov 2026: "move edit to profile screen"). */}
      <View style={styles.edit}>
        <Pill label="Edit profile" size="small" onPress={() => router.push('/account/edit')} />
      </View>
      {following.length > 0 && (
        <>
          <Section title="Hosts you follow" />
          <View style={styles.list}>
            {following.map((h) => (
              <Pressable
                key={h.id}
                onPress={() => router.push(`/host/${h.id}`)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Monogram mark={h} size={40} />
                <View style={styles.nameRow}>
                  <Text style={styles.host} numberOfLines={1}>
                    {h.name}
                  </Text>
                  {h.verified && <Verified size={16} />}
                </View>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  edit: { marginTop: space.big, alignItems: 'center' },
  list: { marginHorizontal: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pressed: { opacity: 0.7 },
  nameRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  host: { flexShrink: 1, fontFamily: font.title, fontSize: 15, color: color.text },
});
