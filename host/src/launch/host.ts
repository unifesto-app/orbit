// Which host Event Partner is on (plan F31, L2): the hosts the account is an Admin of, from GET /me's teams. One is used
// at once; with several, the one picked last (kept on the phone, as the session is), else the picker (/pick) asks.
import type { Me } from '@orbit/contract';
import { markOf } from '@orbit/mobile/mark';
import { useSyncExternalStore } from 'react';

import { kept, useSession } from '../session';

export type Host = { id: string; name: string; initials: string; bg: string; fg: string };

const PICKED = 'orbit.launch.host';
const listeners = new Set<() => void>();

export const adminHosts = (me: Me): Host[] => me.teams.filter((t) => t.admin).map((t) => ({ id: t.hostId, name: t.name, ...markOf({ id: t.hostId, name: t.name }) }));

/** Several hosts and none picked yet (or the one picked is gone): the picker asks first. */
export const mustPick = (me: Me) => {
  const hosts = adminHosts(me);
  return hosts.length > 1 && !hosts.some((h) => h.id === kept.get(PICKED));
};

export function pickHost(id: string) {
  kept.set(PICKED, id);
  for (const on of listeners) on();
}

/** The host the tabs show: the one picked, else the first. Null with no Admin seat (welcome then). */
export function useHost(): Host | null {
  const session = useSession();
  const picked = useSyncExternalStore(
    (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
    () => kept.get(PICKED),
  );
  const hosts = session ? adminHosts(session.me) : [];
  return hosts.find((h) => h.id === picked) ?? hosts[0] ?? null;
}
