// Saved, the owner's Favorites: events kept with the heart (Discover doc, Save and follow: "Profile › Saved: upcoming,
// then past"). One push when registrations open is all a save sends. Signed out, a line and Sign in.
import { View } from 'react-native';

import { Note, Page, SignInNote } from '../../account/kit';
import { events, hosts, now } from '../../mock';
import { EventRow, Section } from '../../rows';
import { useSession } from '../../session';
import { space } from '../../theme';

export default function Saved() {
  const session = useSession();
  const list = events.filter((e) => session?.saved.includes(e.id));
  const at = (e: { startsAt: string }) => Date.parse(e.startsAt);
  const upcoming = list.filter((e) => at(e) >= now).sort((a, b) => at(a) - at(b));
  const past = list.filter((e) => at(e) < now).sort((a, b) => at(b) - at(a));
  const hostOf = (id: string) => hosts.find((h) => h.id === id)!;
  return (
    <Page title="Saved">
      {!session && <SignInNote>Sign in to see the events you save.</SignInNote>}
      {session && list.length === 0 && <Note>Nothing saved yet.</Note>}
      {upcoming.length > 0 && (
        <View style={{ marginTop: space.big }}>
          {upcoming.map((e) => (
            <EventRow key={e.id} event={e} host={hostOf(e.hostId)} />
          ))}
        </View>
      )}
      {past.length > 0 && (
        <>
          <Section title="Past" />
          {past.map((e) => (
            <EventRow key={e.id} event={e} host={hostOf(e.hostId)} past />
          ))}
        </>
      )}
    </Page>
  );
}
