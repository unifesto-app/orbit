// Following: the hosts the viewer follows (Discover doc, Save and follow: "Profile › Following"). Plain rows like the
// event page's people: the 1:1 logo, name and kind, opening the host; Following turns back to Follow on a tap, and the
// row stays until you leave, so it can be followed again. Signed out, a line and Sign in.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Note, Page, Pill, SignInNote } from '../../account/kit';
import { hosts } from '../../mock';
import { Monogram, Verified } from '../../rows';
import { setFollowing, useViewer } from '../../session';
import { color, font, space } from '../../theme';

export default function Following() {
  const viewer = useViewer();
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set()); // unfollowed here, kept on screen
  const list = hosts.filter((h) => viewer.follows.includes(h.id) || dropped.has(h.id));
  const toggle = (id: string) => {
    const on = !viewer.follows.includes(id);
    setFollowing(id, on);
    if (!on) setDropped((s) => new Set([...s, id]));
  };
  return (
    <Page title="Following">
      {!viewer.signedIn && <SignInNote>Sign in to see the hosts you follow.</SignInNote>}
      {viewer.signedIn && list.length === 0 && <Note>Not following any hosts yet.</Note>}
      <View style={styles.list}>
        {list.map((h) => (
          <View key={h.id} style={styles.row}>
            <Pressable
              onPress={() => router.push(`/host/${h.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
              <Monogram mark={h} size={48} />
              <View style={styles.grow}>
                {/* The owner's tick beside a verified host's name, as on the event page's Hosted by. */}
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {h.name}
                  </Text>
                  {h.verified && <Verified size={16} />}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {h.kind}
                </Text>
              </View>
            </Pressable>
            <Pill label={viewer.follows.includes(h.id) ? 'Following' : 'Follow'} muted={viewer.follows.includes(h.id)} size="small" onPress={() => toggle(h.id)} />
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
