// Tickets: the viewer's upcoming bookings, soonest first (Booking doc, The ticket: "Upcoming and Past"; the past half
// is History). Each row opens its ticket (src/app/ticket/[id].tsx). A ticket with a refund request open says so.
// Signed out, a line and Sign in.
import { router } from 'expo-router';
import { View } from 'react-native';

import { refunds, ticketFor } from '../../account/data';
import { Note, Page, SignInNote } from '../../account/kit';
import { isOpen, type RefundStatus } from '../../account/rules';
import { events, hosts } from '../../mock';
import { EventRow } from '../../rows';
import { useViewer } from '../../session';
import { space } from '../../theme';

// "Refund with the host": the Booking doc's status, read as a tag.
const refundTag = (s: RefundStatus) => (s.startsWith('Refund') ? s : `Refund ${s[0].toLowerCase()}${s.slice(1)}`);

export default function Tickets() {
  const viewer = useViewer();
  const booked = new Set(viewer.tickets?.map((t) => t.eventId));
  const list = events.filter((e) => booked.has(e.id)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return (
    <Page title="Tickets">
      {!viewer.signedIn ? (
        <SignInNote>Sign in to see your tickets.</SignInNote>
      ) : list.length ? (
        <View style={{ marginTop: space.big }}>
          {list.map((e) => {
            const refund = refunds.find((r) => r.eventId === e.id && isOpen(r.status));
            const host = hosts.find((h) => h.id === e.hostId)!;
            const ticket = ticketFor(e.id);
            return (
              <EventRow
                key={e.id}
                event={e}
                host={host}
                past
                tag={refund && refundTag(refund.status)}
                onPress={ticket ? () => router.push(`/ticket/${ticket.id}`) : undefined}
              />
            );
          })}
        </View>
      ) : (
        <Note>No upcoming tickets.</Note>
      )}
    </Page>
  );
}
