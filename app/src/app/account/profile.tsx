// Your profile, its own screen (owner, 16 Nov 2026: "the profile should be a seperate screen"; User doc, decision 6:
// kept): photo, name, member since, going and been counts, Edit profile, and the hosts you follow. Only you see it.
// Opened from Account by pulling its panel down or tapping the chevrons. Its top is Account's glass panel fully grown,
// REVEAL taller than at rest with the head grown, so as it fades in (src/app/_layout.tsx) it carries on from the panel
// you pulled. The back circle returns to Account, as on every Account screen.
// The account is the API's (/me, src/session.ts); the hosts you follow are the Following screen's (useFollows). Going
// and Been still count the mock's tickets and past bookings until bookings reach the API.
import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { Note, Page, Panel, Pill, REVEAL, SignInNote } from '../../account/kit';
import { ProfileHead, useFollows } from '../../account/profile';
import { markOf } from '../../hosts';
import { Monogram, Section, Verified } from '../../rows';
import { useSignedIn } from '../../session';
import { color, font, space } from '../../theme';

export default function Profile() {
  const signedIn = useSignedIn();
  const { real, data, mock, count } = useFollows();
  const following = [
    ...(data ?? []).map((h) => ({ id: h.id, to: `/host/${h.slug}` as Href, mark: markOf(h), name: h.name, verified: h.verified })),
    ...mock.map((h) => ({ id: h.id, to: `/host/${h.id}` as Href, mark: h, name: h.name, verified: h.verified })),
  ];
  const [grown] = useState(() => new Animated.Value(1).interpolate({ inputRange: [0, 1], outputRange: [0, 1] }));
  // Signed out while here (on another device, or the session ended): nothing of the account stays on screen.
  if (!signedIn)
    return (
      <Page title="Profile">
        <SignInNote>Sign in to see your profile.</SignInNote>
      </Page>
    );
  return (
    <Page>
      <Panel extra={REVEAL} settled>
        <ProfileHead p={grown} following={count} />
      </Panel>
      {/* Moved here from Account's head (owner, 15 Nov 2026: "move edit to profile screen"). */}
      <View style={styles.edit}>
        <Pill label="Edit profile" size="small" onPress={() => router.push('/account/edit')} />
      </View>
      {(following.length > 0 || real.error) && (
        <>
          <Section title="Hosts you follow" />
          {real.error && (
            <View style={styles.failed}>
              <Note>{real.error.message}</Note>
              <View style={styles.retry}>
                <Pill label="Try again" size="small" onPress={real.reload} />
              </View>
            </View>
          )}
          <View style={styles.list}>
            {following.map((h) => (
              <Pressable
                key={h.id}
                onPress={() => router.push(h.to)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Monogram mark={h.mark} size={40} />
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
  failed: { gap: space.small, marginBottom: space.big },
  retry: { marginHorizontal: 20, flexDirection: 'row' },
  list: { marginHorizontal: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pressed: { opacity: 0.7 },
  nameRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  host: { flexShrink: 1, fontFamily: font.title, fontSize: 15, color: color.text },
});
