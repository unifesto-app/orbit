// The counter's writes to the API (Play, At the desk; api/src/slots/routes.ts), one function each, for a venue's seat.
// Each answers the API's Result: a 409 carries the line the desk is shown ("No walk-in is on that station now.").
// `authed` is the session's api.authed, passed in so counter.test.ts runs on Node.
// ponytail: no unblock here: Today has no control that lifts a block yet (DELETE /venues/:hostId/blocks/:claimId).
import type { Admit, FreeOne, NewBlock, SlotClaim, WalkIn } from '@orbit/contract';
import type { Result } from '@orbit/mobile/api';

export type Authed = <T>(method: 'POST', path: string, body?: unknown) => Promise<Result<T>>;

export function counter(hostId: string, authed: Authed) {
  const at = `/venues/${hostId}`;
  return {
    walkIn: (b: WalkIn) => authed<SlotClaim>('POST', `${at}/walk-ins`, b),
    freeOne: (b: FreeOne) => authed<SlotClaim>('POST', `${at}/walk-ins/free`, b),
    block: (b: NewBlock) => authed<SlotClaim>('POST', `${at}/blocks`, b),
    admit: (claimId: string, b: Admit) => authed<SlotClaim>('POST', `${at}/claims/${claimId}/admit`, b),
    release: (claimId: string) => authed<SlotClaim>('POST', `${at}/claims/${claimId}/release`),
  };
}
