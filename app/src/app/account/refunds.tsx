// Refunds: every refund request, newest first, with the Booking doc's statuses word for word (Requested, With the host,
// With Orbit, Refunded, Declined, "Refund failed, retrying") and the exact amount coming back. Asked for from the ticket;
// the host decides inside their window, Orbit after it (Money doc, Refunds).
import { formatPrice } from '@orbit/contract';

import { refunds } from '../../account/data';
import { Group, Note, Page, Row } from '../../account/kit';
import { day } from '../../account/rules';
import { events } from '../../mock';

export default function Refunds() {
  return (
    <Page title="Refunds">
      {refunds.length > 0 && (
        <Group>
          {refunds.map((r) => (
            <Row
              key={r.id}
              label={events.find((e) => e.id === r.eventId)?.title ?? 'An event'}
              note={[
                `${formatPrice(r.amountPaise)} · asked ${day(r.asked)}`,
                r.reason,
                r.settled && `Sent ${day(r.settled)}`,
              ]
                .filter(Boolean)
                .join('\n')}
              value={r.status}
            />
          ))}
        </Group>
      )}
      {refunds.length === 0 && <Note>No refund requests.</Note>}
    </Page>
  );
}
