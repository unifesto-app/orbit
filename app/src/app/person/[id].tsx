// A person on an event: a speaker, a guest, a judge, anyone. One sheet for all of them, over whatever opened it, as
// the location sheet is (registered in src/app/_layout.tsx). Their 1:1 photo (a circle, as your own; the monogram
// until photos exist), name and line, a short bio and links, then every event they're at with their role there.
// Redrawn 19 Nov 2026 like the host page (owner approved Take 3 of the detail pages mockup,
// https://claude.ai/artifact/5dDmrmZ6soDjoe8kro1xAq): the photo, name, line, bio and links on the left; no role tags on
// top, since each row under Appears at names the role there, as a Clean row of Home's ("Judge · CircuitFeed").
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { past as history } from '../../account/data';
import { appearances } from '../../detail';
import { Glass } from '../../glass';
import { events, type Host, hosts, now, people } from '../../mock';
import { CloseButton, EventRow, GlassFill, Monogram, NotFound, SECTION, Section } from '../../rows';
import { useSignedIn } from '../../session';
import { around, color, font, rim, space } from '../../theme';

const PHOTO = 80; // the host page's logo size

export default function PersonSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const signedIn = useSignedIn();
  const p = people.find((x) => x.id === id);
  if (!p) return <NotFound what="person" />;

  const shows = appearances(p.id, events, now);
  const went = (eventId: string) => signedIn && history.some((h) => h.eventId === eventId && h.status === 'Went');
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
            <Monogram mark={p} size={PHOTO} round />
          </Glass>
          <Text style={styles.name} accessibilityRole="header">
            {p.name}
          </Text>
          <Text style={styles.headline}>{p.headline}</Text>
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
            <Section top={SECTION} title="Appears at" />
            {shows.map((a) => (
              <EventRow
                key={a.event.id}
                event={a.event}
                host={hostOf(a.event.hostId)}
                found
                kicker={`${a.role} · ${hostOf(a.event.hostId).name}`}
                past={a.past}
                went={a.past && went(a.event.id)}
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
  // Left, like the host page's head. Under the X, not beside it: the scroll would clip a photo pulled up into its row.
  top: { marginHorizontal: 20, alignItems: 'flex-start' },
  // A circle in a thin frosted rim (owner, 17 Nov 2026: "instead of squared profile use rounded one", then people's
  // photos too; it was a rounded square from 15 Nov's "use squares for 1:1 instead of circles"). Host logos stay square.
  photoRim: { padding: rim, borderRadius: around(PHOTO / 2, rim) },
  name: { marginTop: 12, fontFamily: font.headline, fontSize: 26, lineHeight: 32, color: color.text },
  headline: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  row: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  bio: { marginTop: 16, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  link: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  linkText: { fontFamily: font.title, fontSize: 13, color: color.text },
});
