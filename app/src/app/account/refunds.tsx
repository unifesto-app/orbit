// Refunds: every refund of your payments, newest first, from GET /me/refunds, with the Booking doc's status words
// (Requested, Refunded, "Refund failed, retrying"; src/pay.ts) and the exact amount coming back. Signed out, a line and
// Sign in.
import { formatPrice } from '@orbit/contract';

import { Group, Note, Page, Row, SignInNote } from '../../account/kit';
import { day } from '../../account/rules';
import { useLoad } from '../../load';
import { paymentsApi, refundWord } from '../../pay';
import { Failed, Waiting } from '../../rows';
import { api, useSession } from '../../session';

export default function Refunds() {
  const me = useSession()?.me.id;
  const page = useLoad(me ? `refunds|${me}` : null, () => paymentsApi(api).refunds());
  return (
    <Page title="Refunds">
      {!me ? (
        <SignInNote>Sign in to see your refunds.</SignInNote>
      ) : !page.data ? (
        page.error ? <Failed message={page.error.message} retry={page.reload} /> : <Waiting />
      ) : page.data.length === 0 ? (
        <Note>No refunds.</Note>
      ) : (
        <Group>
          {page.data.map((r) => (
            <Row
              key={r.id}
              label={r.eventTitle ?? 'An event'}
              note={[`${formatPrice(r.amountPaise)} · asked ${day(r.createdAt)}`, r.status === 'processed' && `Sent ${day(r.updatedAt)}`].filter(Boolean).join('\n')}
              value={refundWord(r.status)}
            />
          ))}
        </Group>
      )}
    </Page>
  );
}
