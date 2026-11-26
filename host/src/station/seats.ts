// The venues a signed-in person works at in Orbit Play Partner, and as what: the API's own rule (api/src/slots/routes.ts
// `seatOn`): a Venue where they're owner or Admin is an Admin seat, a Venue's counter seat is a Desk seat.
import type { Me } from '@orbit/contract';

export type Seat = { hostId: string; name: string; role: 'admin' | 'desk' };

export const seats = (me: Pick<Me, 'teams'>): Seat[] =>
  me.teams
    .filter((t) => t.kind === 'venue' && (t.owner || t.admin || t.desk))
    .map((t) => ({ hostId: t.hostId, name: t.name, role: t.owner || t.admin ? ('admin' as const) : ('desk' as const) }))
    .sort((a, b) => a.name.localeCompare(b.name));
