// Tickets: the viewer's upcoming bookings, soonest first (Booking doc, The ticket: "Upcoming and Past"; the past half
// is History), from GET /me/tickets; with no signal, the ones kept on the phone (Try again only when none are). Each row
// opens its ticket (src/app/ticket/[id].tsx). Signed out, a line and Sign in.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Note, Page, SignInNote } from '../../account/kit';
import { toEvent, toHost } from '../../events';
import { EventRow, Failed, Waiting } from '../../rows';
import { loadTickets, useTickets, useSignedIn, useTicketsOnFocus } from '../../session';
import { space } from '../../theme';

export default function Tickets() {
  const signedIn = useSignedIn();
  const mine = useTickets();
  useTicketsOnFocus();
  const list = mine.data?.upcoming ?? [];
  return (
    <Page title="Tickets">
      {!signedIn ? (
        <SignInNote>Sign in to see your tickets.</SignInNote>
      ) : !mine.data ? (
        mine.error ? <Failed message={mine.error.message} retry={() => void loadTickets()} /> : <Waiting />
      ) : list.length ? (
        <View style={{ marginTop: space.big }}>
          {list.map((t) => (
            <EventRow key={t.id} event={toEvent(t.event)} host={toHost(t.event.host)} past now={Date.now()} onPress={() => router.push(`/ticket/${t.id}`)} />
          ))}
        </View>
      ) : (
        <Note>No upcoming tickets.</Note>
      )}
    </Page>
  );
}
