// Which hosts Event Partner can show (plan F31, L2): the account's Admin seats from GET /me, and the one the tabs open.
// Pure, so it's tested under node; the kept pick and the hooks are in host.ts.
import type { Me } from '@orbit/contract';
import { markOf } from '@orbit/mobile/mark';

export type Host = { id: string; name: string; initials: string; bg: string; fg: string };

export const adminHosts = (me: Pick<Me, 'teams'>): Host[] =>
  me.teams.filter((t) => t.admin).map((t) => ({ id: t.hostId, name: t.name, ...markOf({ id: t.hostId, name: t.name }) }));

// The one picked, else the only one; null with none, or with several and no pick that's still theirs (the picker asks).
export const chosen = (hosts: readonly Host[], picked: string | null) => hosts.find((h) => h.id === picked) ?? (hosts.length === 1 ? hosts[0]! : null);
