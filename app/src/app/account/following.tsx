// Following: the hosts the viewer follows (Discover doc, Save and follow: "Profile › Following"). Plain rows like the
// event page's people: the 1:1 logo, name and kind, opening the host; Following turns back to Follow on a tap, and the
// row stays until you leave, so it can be followed again. Signed out, a line and Sign in.
// Hosts on the API come from GET /me/follows, newest first (any that went private or stopped are hidden there, never
// dropped); the mock's hosts follow on this phone until events reach the API (src/session.ts).
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Note, Page, Pill, SignInNote } from '../../account/kit';
import { hostsApi, markOf } from '../../hosts';
import { useLoad } from '../../load';
import { hosts } from '../../mock';
import { Monogram, Verified } from '../../rows';
import { api, setFollowing, useMe, useViewer } from '../../session';
import { color, font, space } from '../../theme';

type Line = { id: string; to: string; mark: { initials: string; bg: string; fg: string }; name: string; verified: boolean; meta: string };

export default function Following() {
  const viewer = useViewer();
  const me = useMe();
  const real = useLoad(viewer.signedIn ? `follows|${me.id}` : null, () => hostsApi(api).follows());
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set()); // unfollowed here, kept on screen
  const [off, setOff] = useState<ReadonlySet<string>>(new Set()); // API hosts unfollowed here

  const mock = hosts.filter((h) => viewer.follows.includes(h.id) || dropped.has(h.id));
  const lines: (Line & { following: boolean; toggle: () => void })[] = [
    ...(real.data ?? []).map((h) => ({
      id: h.id,
      to: `/host/${h.slug}`,
      mark: markOf(h),
      name: h.name,
      verified: h.verified,
      meta: h.city,
      following: !off.has(h.id),
      toggle: async () => {
        const on = off.has(h.id);
        const flip = (yes: boolean) => setOff((s) => (yes ? new Set([...s].filter((x) => x !== h.id)) : new Set([...s, h.id])));
        flip(on);
        const r = await hostsApi(api).follow(h.id, on);
        if (!r.ok) {
          flip(!on);
          Alert.alert(on ? 'Couldn’t follow' : 'Couldn’t unfollow', r.error.message);
        }
      },
    })),
    ...mock.map((h) => ({
      id: h.id,
      to: `/host/${h.id}`,
      mark: h,
      name: h.name,
      verified: h.verified,
      meta: h.kind,
      following: viewer.follows.includes(h.id),
      toggle: () => {
        const on = !viewer.follows.includes(h.id);
        setFollowing(h.id, on);
        if (!on) setDropped((s) => new Set([...s, h.id]));
      },
    })),
  ];
  return (
    <Page title="Following">
      {!viewer.signedIn && <SignInNote>Sign in to see the hosts you follow.</SignInNote>}
      {viewer.signedIn && !real.loading && lines.length === 0 && <Note>Not following any hosts yet.</Note>}
      {real.error && <Note>{real.error.message}</Note>}
      <View style={styles.list}>
        {lines.map((h) => (
          <View key={h.id} style={styles.row}>
            <Pressable onPress={() => router.push(h.to)} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
              <Monogram mark={h.mark} size={48} />
              <View style={styles.grow}>
                {/* The owner's tick beside a verified host's name, as on the event page's Hosted by. */}
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {h.name}
                  </Text>
                  {h.verified && <Verified size={16} />}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {h.meta}
                </Text>
              </View>
            </Pressable>
            <Pill label={h.following ? 'Following' : 'Follow'} muted={h.following} size="small" onPress={h.toggle} />
          </View>
        ))}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: space.big, marginHorizontal: 20, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  link: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flexShrink: 1, fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
