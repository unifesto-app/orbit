// History: bookings that are no longer tickets, latest first: events that are over (Went or Missed), and bookings
// cancelled or refunded (Booking doc: "cancelled as plain status text"). The upcoming half is Tickets.
import { View } from 'react-native';

import { past } from '../../account/data';
import { Note, Page } from '../../account/kit';
import { events, hosts } from '../../mock';
import { EventRow } from '../../rows';
import { space } from '../../theme';

export default function History() {
  const list = past
    .map((p) => ({ ...p, event: events.find((e) => e.id === p.eventId)! }))
    .sort((a, b) => Date.parse(b.event.startsAt) - Date.parse(a.event.startsAt));
  return (
    <Page title="History">
      {list.length ? (
        <View style={{ marginTop: space.big }}>
          {list.map(({ event: e, status }) => (
            <EventRow key={e.id} event={e} host={hosts.find((h) => h.id === e.hostId)!} past tag={status} />
          ))}
        </View>
      ) : (
        <Note>No past events yet.</Note>
      )}
    </Page>
  );
}
