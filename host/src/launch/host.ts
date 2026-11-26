// Which host Event Partner is on (plan F31, L2): the hosts the account is an Admin of, from GET /me's teams. One is used
// at once; with several, the one picked last (kept on the phone, as the session is, and forgotten on sign-out), else
// the picker (/pick) asks.
import type { Me } from '@orbit/contract';
import { useSyncExternalStore } from 'react';

import { kept, PICKED_HOST, useSession } from '../session';
import { adminHosts, chosen } from './hosts';

export { adminHosts, type Host } from './hosts';

const listeners = new Set<() => void>();

/** An Admin of some host, but none to open without asking: the picker first. */
export const mustPick = (me: Me) => {
  const hosts = adminHosts(me);
  return hosts.length > 0 && !chosen(hosts, kept.get(PICKED_HOST));
};

export function pickHost(id: string) {
  kept.set(PICKED_HOST, id);
  for (const on of listeners) on();
}

/** The host the tabs show; null with no Admin seat (welcome), or with several and none picked (/pick). */
export function useHost() {
  const session = useSession();
  const picked = useSyncExternalStore(
    (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
    () => kept.get(PICKED_HOST),
  );
  return chosen(session ? adminHosts(session.me) : [], picked);
}
