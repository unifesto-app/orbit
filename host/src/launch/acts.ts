// An event's acts in Event Partner: the other hosts on it, in order, as the team edits the list before Save acts sends
// it whole (PUT /events/:id/acts). A hidden act (its host isn't public and live) is only its id here; it can stay, move
// or go, but the API refuses adding one. Ids compare lowercase, as the API's do. Pure, so it's tested under node.
import { type HostCard, MAX_EVENT_ACTS, type SetEventActs, type TeamAct } from '@orbit/contract';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const has = (list: TeamAct[], id: string) => list.some((a) => same(a.hostId, id));

// A search result can go on when it isn't on already, isn't the event's own host, and there's room.
export const pickable = (hosts: HostCard[], list: TeamAct[], ownHostId: string) => hosts.filter((h) => !has(list, h.id) && !same(h.id, ownHostId));

export const addAct = (list: TeamAct[], card: HostCard, ownHostId: string): TeamAct[] =>
  list.length >= MAX_EVENT_ACTS || pickable([card], list, ownHostId).length === 0 ? list : [...list, { hostId: card.id, shown: true, name: card.name, slug: card.slug }];

export function moveAct(list: TeamAct[], i: number, by: -1 | 1): TeamAct[] {
  const j = i + by;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
export const removeAct = (list: TeamAct[], i: number) => list.filter((_, k) => k !== i);

const ids = (list: TeamAct[]) => list.map((a) => a.hostId.toLowerCase());
// `shown` is the list as loaded, so a change made since is refused (409 stale) rather than overwritten.
export const actsBody = (loaded: TeamAct[], list: TeamAct[]): SetEventActs => ({ shown: ids(loaded), hostIds: ids(list) });
export const actsChanged = (loaded: TeamAct[], list: TeamAct[]) => ids(loaded).join() !== ids(list).join();
export const actName = (a: TeamAct) => (a.shown ? a.name : 'Hidden');
