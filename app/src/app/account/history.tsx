// History: bookings that are no longer tickets, latest first (GET /me/tickets' past): events that are over, and bookings
// cancelled, by you or the host (Booking doc: "cancelled as plain status text"). The upcoming half is Tickets.
// ponytail: Went and Missed, and Loved it's heart, need check-in (Event day); until then a past booking shows the event.
import { View } from 'react-native';

import { Note, Page, SignInNote } from '../../account/kit';
import { toEvent, toHost } from '../../events';
import { EventRow, Failed, Waiting } from '../../rows';
import { loadTickets, useSignedIn, useTickets, useTicketsOnFocus } from '../../session';
import { space } from '../../theme';
import { statusText } from '../../tickets';

export default function History() {
  const signedIn = useSignedIn();
  const mine = useTickets();
  useTicketsOnFocus();
  const list = mine.data?.past ?? [];
  return (
    <Page title="History">
      {!signedIn ? (
        <SignInNote>Sign in to see your history.</SignInNote>
      ) : !mine.data || !mine.fresh ? (
        mine.error ? <Failed message={mine.error.message} retry={() => void loadTickets()} /> : <Waiting />
      ) : list.length ? (
        <View style={{ marginTop: space.big }}>
          {list.map((t) => (
            <EventRow
              key={t.id}
              event={toEvent(t.event)}
              host={toHost(t.event.host)}
              past
              now={Date.now()}
              tag={statusText(t.status)}
            />
          ))}
        </View>
      ) : (
        <Note>No past events yet.</Note>
      )}
    </Page>
  );
}
