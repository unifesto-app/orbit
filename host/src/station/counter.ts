// The counter's writes to the API (Play, At the desk; api/src/slots/routes.ts), one function each, for a venue's seat.
// Each answers the API's Result: a 409 carries the line the desk is shown ("No walk-in is on that station now.").
// ponytail: no unblock here: Today has no control that lifts a block yet (DELETE /venues/:hostId/blocks/:claimId).
import type { Admit, FreeOne, NewBlock, SlotClaim, WalkIn } from '@orbit/contract';

import { api } from '../session';

export function counter(hostId: string) {
  const at = `/venues/${hostId}`;
  return {
    walkIn: (b: WalkIn) => api.authed<SlotClaim>('POST', `${at}/walk-ins`, b),
    freeOne: (b: FreeOne) => api.authed<SlotClaim>('POST', `${at}/walk-ins/free`, b),
    block: (b: NewBlock) => api.authed<SlotClaim>('POST', `${at}/blocks`, b),
    admit: (claimId: string, b: Admit) => api.authed<SlotClaim>('POST', `${at}/claims/${claimId}/admit`, b),
    release: (claimId: string) => api.authed<SlotClaim>('POST', `${at}/claims/${claimId}/release`),
  };
}
