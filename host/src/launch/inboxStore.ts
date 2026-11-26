// Each host app's Inbox and the count on its round Inbox button, from the API (plan F31, L7; all three apps since
// Notifications PR 5): GET /me/inbox?app=<launch|station|crew>, read at sign-in, when the app comes back, when a push
// lands, when the Inbox opens, and every minute while the Inbox button shows; POST /me/inbox/read marks rows
// read (all of them with no ids). A tap shows read at once. A read of the inbox that set out before a tap's POST came
// back is dropped, so it can't flip the row back to unread; the next one has the final word.
// ponytail: the first page (30) only; add "Load more" with `next` once a host's inbox runs past it.
import type { InboxPage, InboxRow } from '@orbit/contract';
import { useSyncExternalStore } from 'react';

import { inboxPath, readBody } from '../notices';
import { api, useSession } from '../session';
import { thisApp } from '../variant';
import { type Message, type Picture, kept, readLocally } from './inbox';

const app = thisApp.word;

type State = { user: string; items: Message[]; unread: number; error: string | null } | null;
let state: State = null;
let marks = 0; // bumped as a markRead starts and as its POST answers: a read begun before either is stale
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  for (const on of listeners) on();
};
const subscribe = (on: () => void) => {
  listeners.add(on);
  return () => listeners.delete(on);
};
const now = () => state;

// "teamInvite" → "Team invite": the catalog's kind as the row's small grey label.
const kindLabel = (k: string) => {
  const words = k.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
// The API's picture is free-form; only the shapes the row draws pass, else Orbit's orb.
const pictureOf = (p: unknown): Picture => {
  if (!p || typeof p !== 'object') return null;
  if ('event' in p && typeof p.event === 'string') return { event: p.event };
  if ('host' in p && p.host && typeof p.host === 'object') return p as Picture;
  return null;
};
const toMessage = (r: InboxRow): Message => ({ id: r.id, at: r.at, from: r.from, kind: kindLabel(r.kind), text: r.text, picture: pictureOf(r.picture), read: r.read });

/** Reads the inbox again for this account. */
export async function refreshInbox(user: string) {
  const started = marks;
  const r = await api.authed<InboxPage>('GET', inboxPath(app));
  if (started !== marks) return;
  if (r.ok) set({ user, items: r.data.items.map(toMessage), unread: r.data.unread, error: null });
  else if (state?.user === user) set({ ...state, error: r.error.message });
  else set({ user, items: [], unread: 0, error: r.error.message });
}

/** Marks messages read, or every one with none given; the Inbox's dots and the circle's count follow. */
// Before the inbox is read (a push tapped at launch, `who` signed in), the POST still goes, then the inbox is read.
export function markRead(ids?: readonly string[], who?: string) {
  if (!state) {
    if (ids && who) {
      marks++;
      void api.authed('POST', '/me/inbox/read', readBody(app, ids)).then(() => {
        marks++;
        void refreshInbox(who);
      });
    }
    return;
  }
  const next = readLocally(state.items, state.unread, ids);
  if (ids && next.newly === 0) return;
  marks++;
  set({ ...state, items: next.items, unread: next.unread });
  const user = state.user;
  void api.authed('POST', '/me/inbox/read', readBody(app, ids)).then((r) => {
    marks++;
    if (!r.ok) void refreshInbox(user); // put back what the API still has unread
  });
}

/** This account's inbox: the messages from the last 180 days, the whole inbox's unread count, and what went wrong last. */
export function useInbox() {
  const s = useSyncExternalStore(subscribe, now);
  const me = useSession()?.me.id;
  const mine = s && s.user === me ? s : null;
  return { loaded: !!mine, messages: mine ? kept(mine.items, Date.now()) : [], unread: mine?.unread ?? 0, error: mine?.error ?? null };
}
