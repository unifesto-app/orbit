// Saved events and lists from the Orbit API (api/src/saves.ts, Saved events and lists doc): the calls, the answer as the
// session keeps it, and the events seen so far. Pure, so savesApi.test.ts runs on Node; the session (src/session.ts)
// applies each change on the phone first and then calls these.
import type { EventCard, MySaves, RestoreSaves } from '@orbit/contract';

import type { makeApi } from '../api.ts';
import { type Event, toEvent } from '../events.ts';
import { cardOf } from './seen.ts';
import type { Saves, Undo } from './saves.ts';

type Api = Pick<ReturnType<typeof makeApi>, 'authed'>;

// The API's answer as the session's saves: times in milliseconds. It holds only events that can be opened.
export const fromServer = (r: MySaves): Saves => ({
  saved: r.saved.map((s) => ({ id: s.eventId, at: Date.parse(s.at) })),
  lists: r.lists.map((l) => ({ id: l.id, name: l.name, events: l.events, touched: Date.parse(l.touched) })),
});

// What an unsave took, as the restore call wants it.
export const undoBody = (u: Undo): RestoreSaves => ({
  saves: u.saves.map((s) => ({ eventId: s.id, at: new Date(s.at).toISOString() })),
  lists: Object.fromEntries(Object.entries(u.lists).map(([id, ids]) => [id, [...ids]])),
});

export const savesApi = (api: Api) => ({
  read: () => api.authed<MySaves>('GET', '/me/saves'),
  save: (eventId: string) => api.authed<null>('PUT', `/me/saves/${eventId}`),
  remove: (eventIds: readonly string[]) => api.authed<null>('POST', '/me/saves/remove', { eventIds }),
  restore: (u: Undo) => api.authed<null>('POST', '/me/saves/restore', undoBody(u)),
  // Making a list says `create`, with its first event when it has one; a rename doesn't, so a list deleted on another
  // phone answers listGone instead of coming back.
  putList: (id: string, name: string, make?: { first?: string | null }) =>
    api.authed<unknown>('PUT', `/me/lists/${id}`, make ? { name, create: true, ...(make.first && { eventId: make.first }) } : { name }),
  deleteList: (id: string) => api.authed<null>('DELETE', `/me/lists/${id}`),
  tick: (listId: string, eventId: string, on: boolean) => api.authed<null>(on ? 'PUT' : 'DELETE', `/me/lists/${listId}/events/${eventId}`),
});

// These ids as events the screens draw, those whose card is known (the rest aren't shown, as saves.split says).
export const drawn = (ids: readonly string[]): Event[] => ids.flatMap((id) => (cardOf(id) ? [toEvent(cardOf(id)!)] : []));

// What's drawn is the saves the server last confirmed (`base`) with the changes still waiting to be sent (`pending`,
// in the order they were tapped) replayed on top. A change the API refuses just leaves `pending`, and the rest replay
// without it, so two taps made offline are undone exactly, each by its own refusal. A read replaces `base` and the
// waiting changes stay drawn on top of it.
export type Change = (s: Saves) => Saves | string;
export type Model = { base: Saves; pending: readonly { id: number; change: Change }[] };

const run = (s: Saves, c: Change): Saves => {
  const n = c(s);
  return typeof n === 'string' ? s : n; // a change that no longer fits (its list is gone) draws as nothing
};
export const fresh = (base: Saves): Model => ({ base, pending: [] });
export const shown = (m: Model): Saves => m.pending.reduce((s, p) => run(s, p.change), m.base);
export const queued = (m: Model, id: number, change: Change): Model => ({ ...m, pending: [...m.pending, { id, change }] });
// The API said yes: the change is now the server's, so it moves into `base`.
export const confirmed = (m: Model, id: number): Model => {
  const p = m.pending.find((x) => x.id === id);
  return { base: p ? run(m.base, p.change) : m.base, pending: m.pending.filter((x) => x.id !== id) };
};
export const refused = (m: Model, id: number): Model => ({ ...m, pending: m.pending.filter((x) => x.id !== id) });
export const withRead = (m: Model, base: Saves): Model => ({ ...m, base });
