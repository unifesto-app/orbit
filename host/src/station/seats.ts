// The venues a signed-in person works at in Orbit Play Partner, and as what: the API's own rule (api/src/slots/routes.ts
// `seatOn`): a Venue where they're owner or Admin is an Admin seat, a Venue's counter seat is a Desk seat.
import type { Me } from '@orbit/contract';

export type Seat = { hostId: string; name: string; role: 'admin' | 'desk' };

export const seats = (me: Pick<Me, 'teams'>): Seat[] =>
  me.teams
    .filter((t) => t.kind === 'venue' && (t.owner || t.admin || t.desk))
    .map((t) => ({ hostId: t.hostId, name: t.name, role: t.owner || t.admin ? ('admin' as const) : ('desk' as const) }))
    .sort((a, b) => a.name.localeCompare(b.name));

const TAB_NAMES = ['today', 'money', 'venue'] as const;
export type Tab = (typeof TAB_NAMES)[number];
/** The tabs on the bar (Desk's are there, hidden): Money is off while `one0` (variant.ts ONE_0) is on. */
export const barTabs = (one0: boolean): Tab[] => TAB_NAMES.filter((t) => !(one0 && t === 'money'));
/** The tabs a role may open: Desk has no money, prices or settings, so Today alone. */
export const opens = (role: Seat['role'], one0: boolean): Tab[] => (role === 'desk' ? ['today'] : barTabs(one0));
