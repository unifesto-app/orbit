// A person on an event: a speaker, a guest, a judge, anyone. One sheet for all of them, over whatever opened it, as
// the location sheet is (registered in src/app/_layout.tsx). Their 1:1 photo (a rounded square; the monogram until
// photos exist), name and line, their roles, a short bio and links, then every event they're at with their role there.
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appearances } from '../../detail';
import { Glass } from '../../glass';
import { events, type Host, hosts, now, people } from '../../mock';
import { CloseButton, EventRow, GlassFill, Monogram, NotFound, Section, Tag } from '../../rows';
import { around, color, font, radius, rim, space } from '../../theme';

const PHOTO = 96;

export default function PersonSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const p = people.find((x) => x.id === id);
  if (!p) return <NotFound what="person" />;

  const shows = appearances(p.id, events, now);
  const roles = [...new Set(shows.map((a) => a.role))];
  const hostOf = (hostId: string) => hosts.find((h) => h.id === hostId) as Host;

  return (
    // A sheet on iOS, so a small gap at its top; full screen on Android, so clear of the status bar (as the location
    // sheet).
    <View style={[styles.screen, { paddingTop: Platform.OS === 'ios' ? space.big : insets.top + space.small }]}>
      <GlassFill />
      <View style={styles.head}>
        <CloseButton />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + space.big }}>
        <View style={styles.top}>
          <Glass style={styles.photoRim}>
            <Monogram mark={p} size={PHOTO} />
          </Glass>
          <Text style={styles.name} accessibilityRole="header">
            {p.name}
          </Text>
          <Text style={styles.headline}>{p.headline}</Text>
          {roles.length > 0 && (
            <View style={styles.row}>
              {roles.map((r) => (
                <Tag key={r} text={r} />
              ))}
            </View>
          )}
          <Text style={styles.bio}>{p.bio}</Text>
          {/* Frosted pills with white labels, never accent text. */}
          {p.links.length > 0 && (
            <View style={styles.row}>
              {p.links.map((l) => (
                <Pressable key={l.url} onPress={() => Linking.openURL(l.url)} accessibilityRole="link">
                  <Glass style={styles.link}>
                    <Text style={styles.linkText}>{l.label}</Text>
                  </Glass>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {shows.length > 0 && (
          <>
            <Section title="Appears at" />
            {shows.map((a) => (
              <EventRow
                key={a.event.id}
                event={a.event}
                host={hostOf(a.event.hostId)}
                tag={a.role}
                past={a.past}
                // Back to that event if it's under this sheet; otherwise the event takes the sheet's place, so the page
                // never opens inside the sheet. Event pages match by slug (dangerouslySingular in src/app/_layout.tsx).
                onPress={() => router.dismissTo(`/event/${a.event.id}`)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, // on the glass (GlassFill), owner: "Glass for all"
  head: { marginHorizontal: 20, flexDirection: 'row', justifyContent: 'flex-end' },
  top: { marginHorizontal: 20, alignItems: 'center' },
  // A rounded square, never a circle (owner, 15 Nov 2026: "use squares for 1:1 instead of circles"), in a thin
  // frosted rim (photo 6 + rim 2).
  photoRim: { padding: rim, borderRadius: around(radius.md, rim) },
  name: { marginTop: space.small, fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text, textAlign: 'center' },
  headline: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary, textAlign: 'center' },
  row: { marginTop: space.small, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.small },
  bio: { marginTop: space.small, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary, textAlign: 'center' },
  link: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  linkText: { fontFamily: font.title, fontSize: 13, color: color.text },
});
