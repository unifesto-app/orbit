// A person on an event: a speaker, a guest, a judge, anyone. One sheet for all of them, over whatever opened it, as
// the location sheet is (registered in src/app/_layout.tsx). Their 1:1 photo (a circle, as your own; the monogram
// until photos exist), name and line, a short bio and links, then every event they're at with their role there.
// Redrawn 19 Nov 2026 like the host page (owner approved Take 3 of the detail pages mockup,
// https://claude.ai/artifact/5dDmrmZ6soDjoe8kro1xAq): the photo, name, line, bio and links on the left; no role tags on
// top, since each row under Appears at names the role there, as a Clean row of Home's ("Judge · CircuitFeed").
// A uuid is a real person (orbit-pm X14), read from GET /public/people/:id; anything else stays on the mock.
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { past as history } from '../../account/data';
import { appearances } from '../../detail';
import { Glass } from '../../glass';
import { type Event, eventsApi, type Host, toEvent, toHost } from '../../events';
import { markOf } from '../../hosts';
import { useLoad } from '../../load';
import { events, hosts, now, people } from '../../mock';
import { CloseButton, EventRow, Failed, GlassFill, Monogram, NotFound, SECTION, Section, Waiting } from '../../rows';
import { api, useSignedIn } from '../../session';
import { around, color, font, rim, space } from '../../theme';

const PHOTO = 80; // the host page's logo size

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Shown = { event: Event; host: Host; role: string; past: boolean; went: boolean };
type Face = { id: string; name: string; headline: string; bio: string | null; links: { label: string; url: string }[] };

export default function PersonSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return UUID.test(id) ? <LivePerson id={id} /> : <MockPerson id={id} />;
}

function LivePerson({ id }: { id: string }) {
  const page = useLoad(`person|${id}`, () => eventsApi(api).person(id));
  if (page.status === 404) return <NotFound what="person" />;
  if (!page.data) return page.error ? <Failed message={page.error.message} retry={page.reload} /> : <Waiting />;
  const at = Date.now();
  const shows = page.data.appearances.map((a): Shown => {
    const event = toEvent(a.event);
    return { event, host: toHost(a.event.host), role: a.role, past: Date.parse(a.event.endsAt) <= at, went: false };
  });
  return <PersonView p={page.data} mark={markOf(page.data)} shows={shows} now={at} />;
}

function MockPerson({ id }: { id: string }) {
  const signedIn = useSignedIn();
  const p = people.find((x) => x.id === id);
  if (!p) return <NotFound what="person" />;
  const went = (eventId: string) => signedIn && history.some((h) => h.eventId === eventId && h.status === 'Went');
  const hostOf = (hostId: string) => hosts.find((h) => h.id === hostId) as Host;
  const shows = appearances(p.id, events, now).map((a): Shown => ({ ...a, host: hostOf(a.event.hostId), went: a.past && went(a.event.id) }));
  return <PersonView p={p} mark={p} shows={shows} />;
}

function PersonView({ p, mark, shows, now: clock }: { p: Face; mark: ReturnType<typeof markOf>; shows: Shown[]; now?: number }) {
  const insets = useSafeAreaInsets();
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
            <Monogram mark={mark} size={PHOTO} round />
          </Glass>
          <Text style={styles.name} accessibilityRole="header">
            {p.name}
          </Text>
          <Text style={styles.headline}>{p.headline}</Text>
          {p.bio && <Text style={styles.bio}>{p.bio}</Text>}
          {/* Frosted pills with white labels, never accent text. */}
          {p.links.length > 0 && (
            <View style={styles.row}>
              {p.links.map((l, i) => (
                <Pressable key={i + l.url} onPress={() => Linking.openURL(l.url)} accessibilityRole="link">
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
                host={a.host}
                found
                kicker={`${a.role} · ${a.host.name}`}
                past={a.past}
                went={a.went}
                now={clock}
                // Back to that event if it's under this sheet; otherwise the event takes the sheet's place, so the page
                // never opens inside the sheet. Event pages match by slug (dangerouslySingular in src/app/_layout.tsx).
                onPress={() => router.dismissTo(`/event/${a.event.slug}`)}
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
  photoRim: { padding: rim, borderCurve: 'continuous', borderRadius: around(PHOTO / 2, rim) },
  name: { marginTop: 12, fontFamily: font.headline, fontSize: 26, lineHeight: 32, color: color.text },
  headline: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  row: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  bio: { marginTop: 16, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  link: { height: 32, paddingHorizontal: 12, borderCurve: 'continuous', borderRadius: 16, justifyContent: 'center' },
  linkText: { fontFamily: font.title, fontSize: 13, color: color.text },
});
