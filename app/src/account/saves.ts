// Saved events and lists (Saved events and lists doc, settled 16 Nov 2026). The heart saves into All saved; lists are
// optional folders on top, an event in as many as you like, and every event in a list is always saved. Pure, so
// saves.test.ts runs it under node: the session (src/session.ts) holds the state, and the screens draw it.
// The server's copy wins (doc: Two phones): src/session.ts reads it at sign-in and applies each change here first, then
// tells the API (src/account/savesApi.ts); "That list is gone" comes back from it as well as from here.

export const MAX_SAVED = 1000; // past saves count; hidden ones (events that can't be opened) don't
export const MAX_LISTS = 50;
export const MAX_NAME = 40;

export const FULL = 'You have 1,000 saved; remove some first';
export const TOO_MANY = `You have ${MAX_LISTS} lists; delete one first`;
export const GONE = 'That list is gone';

export type Save = { id: string; at: number }; // an event id and when it was saved
export type List = { id: string; name: string; events: readonly string[]; touched: number }; // made, or last added to
export type Saves = { saved: readonly Save[]; lists: readonly List[] };
// What an unsave took, so Undo can put back the same saves, with their dates and their lists.
export type Undo = { saves: readonly Save[]; lists: Readonly<Record<string, readonly string[]>> };

export const isSaved = (s: Saves, eventId: string) => s.saved.some((x) => x.id === eventId);

// A session stored before lists kept saves as bare event ids: they read back as saves, in no list.
export function normalise(s: { saved: readonly (string | Save)[]; lists?: unknown }, at: number): Saves {
  return {
    saved: s.saved.map((x) => (typeof x === 'string' ? { id: x, at } : x)),
    lists: Array.isArray(s.lists) ? s.lists : [],
  };
}

// `counts` says which saves count toward the cap: those whose events can still be opened.
export function save(s: Saves, eventId: string, at: number, counts: (id: string) => boolean): Saves | string {
  if (isSaved(s, eventId)) return s;
  if (s.saved.filter((x) => counts(x.id)).length >= MAX_SAVED) return FULL;
  return { ...s, saved: [...s.saved, { id: eventId, at }] };
}

// Gone from All saved and every list at once.
export function unsave(s: Saves, ids: readonly string[]): { next: Saves; undo: Undo } {
  const gone = new Set(ids);
  const lists: Record<string, string[]> = {};
  for (const l of s.lists) {
    const out = l.events.filter((id) => gone.has(id));
    if (out.length) lists[l.id] = out;
  }
  return {
    next: {
      saved: s.saved.filter((x) => !gone.has(x.id)),
      lists: s.lists.map((l) => (lists[l.id] ? { ...l, events: l.events.filter((id) => !gone.has(id)) } : l)),
    },
    undo: { saves: s.saved.filter((x) => gone.has(x.id)), lists },
  };
}

// Puts back what an unsave took without touching anything done since; a list deleted meanwhile stays deleted.
export function restore(s: Saves, undo: Undo): Saves {
  const back = undo.saves.filter((x) => !isSaved(s, x.id));
  return {
    saved: [...s.saved, ...back].sort((a, b) => a.at - b.at),
    lists: s.lists.map((l) => (undo.lists[l.id] ? { ...l, events: [...new Set([...l.events, ...undo.lists[l.id]])] } : l)),
  };
}

// A name's length as people count it, each emoji or Indic letter as one. Without Intl.Segmenter (Hermes may lack it),
// code points less the marks that join the one before: vowel signs and viramas, skin tones, variation selectors and the
// joiner. An emoji made of several joined ones still over-counts, so a long name is refused a little early, never let
// through.
const letters = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter() : null;
const JOINING = /[\p{M}\u200D\uFE0F\u{1F3FB}-\u{1F3FF}]/gu;
export const nameLength = (name: string, segmenter = letters) =>
  segmenter ? [...segmenter.segment(name)].length : [...name.replace(JOINING, '')].length;

// What's wrong with a list's name, or null. Trimmed; two lists can't share a name, ignoring case.
export function nameProblem(lists: readonly List[], name: string, except?: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the list a name';
  if (nameLength(n) > MAX_NAME) return `Names are up to ${MAX_NAME} characters`;
  const same = lists.find((l) => l.id !== except && l.name.toLowerCase() === n.toLowerCase());
  return same ? `You already have a list called ${same.name}` : null;
}

export function create(s: Saves, name: string, id: string, at: number): Saves | string {
  if (s.lists.length >= MAX_LISTS) return TOO_MANY;
  return nameProblem(s.lists, name) ?? { ...s, lists: [...s.lists, { id, name: name.trim(), events: [], touched: at }] };
}

export function rename(s: Saves, id: string, name: string): Saves | string {
  if (!s.lists.some((l) => l.id === id)) return GONE;
  return nameProblem(s.lists, name, id) ?? { ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, name: name.trim() } : l)) };
}

// Deleting a list never unsaves anything.
export const drop = (s: Saves, id: string): Saves => ({ ...s, lists: s.lists.filter((l) => l.id !== id) });

// A tick in the list picker: in goes the event, saved first if it isn't; or out it comes, still saved.
export function tick(s: Saves, listId: string, eventId: string, on: boolean, at: number, counts: (id: string) => boolean): Saves | string {
  const list = s.lists.find((l) => l.id === listId);
  if (!list) return GONE;
  if (!on) return { ...s, lists: s.lists.map((l) => (l === list ? { ...l, events: l.events.filter((id) => id !== eventId) } : l)) };
  if (list.events.includes(eventId)) return s;
  const saved = save(s, eventId, at, counts);
  if (typeof saved === 'string') return saved;
  return { ...saved, lists: saved.lists.map((l) => (l === list ? { ...l, events: [...l.events, eventId], touched: at } : l)) };
}

// Lists by the last time something was added or the list was made.
export const byTouched = (lists: readonly List[]) => [...lists].sort((a, b) => b.touched - a.touched);

// Saved events split as every saved screen shows them: upcoming soonest first, then past, latest first. One clock, as
// Home and the status line have it: an event is upcoming until it ends (its start when no end is known), so a running
// one isn't past. Only events in `events` show: one that can't be opened is hidden, never dropped, and shows again once
// it can be.
export function split<E extends { id: string; startsAt: string; endsAt?: string }>(ids: readonly string[], events: readonly E[], now: number) {
  const at = (e: E) => Date.parse(e.startsAt);
  const over = (e: E) => (e.endsAt ? Date.parse(e.endsAt) <= now : at(e) < now);
  const found = events.filter((e) => ids.includes(e.id));
  return {
    upcoming: found.filter((e) => !over(e)).sort((a, b) => at(a) - at(b)),
    past: found.filter(over).sort((a, b) => at(b) - at(a)),
  };
}
