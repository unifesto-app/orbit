// The one label an event can carry beside its status, on Home and Search rows (owner, 19 Nov 2026: "add promoted,
// people's choice, etc kind of things"). The first that holds:
//   Promoted: the host paid for reach (Boost; the plan has it after launch, here on mock). A paid slot always says so.
//   People’s choice: at least CHOICE people loved the host's events (Loved it counts people, never taps). Earned only,
//     never set by hand, and the number isn't shown.
//   New on Orbit: the host joined in the last NEW days.
// Only while the event can still be booked: never on a cancelled, ended, sold-out or closed one. Pure, so
// labels.test.ts runs it on Node.
import type { Status } from './status';

export type Label = 'Promoted' | 'People’s choice' | 'New on Orbit';

// ponytail: fixed numbers on mock love; People's choice moves to a share of the area's hosts once love is real.
const CHOICE = 100;
const NEW = 30 * 86_400_000;
const LIVE: readonly Status['kind'][] = ['open', 'justAnnounced', 'fillingFast', 'almostFull', 'opensSoon', 'held'];

export function eventLabel(
  e: { promoted?: boolean },
  host: { joined: string; lovedBy?: number },
  st: Status,
  now: number,
): Label | undefined {
  if (!LIVE.includes(st.kind)) return undefined;
  if (e.promoted) return 'Promoted';
  if ((host.lovedBy ?? 0) >= CHOICE) return 'People’s choice';
  if (isNewHost(host, now)) return 'New on Orbit';
  return undefined;
}

/** A host that joined in the last NEW days: New on Orbit on its events, and in Search's New on Orbit. */
export const isNewHost = (host: { joined: string }, now: number) => now - Date.parse(host.joined) < NEW;

/** A list with its first promoted event moved to the top, one per list; nothing added, the rest in order. */
export function promoteOne<E>(events: readonly E[], isPromoted: (e: E) => boolean): E[] {
  const i = events.findIndex(isPromoted);
  return i <= 0 ? [...events] : [events[i]!, ...events.slice(0, i), ...events.slice(i + 1)];
}
