// The inbox (GET /me/inbox, src/notices.ts) for the inbox screen (src/app/inbox.tsx), Home's bell, the app icon's number
// and a ticket's announcement: one copy, kept for the account it was read for, as the tickets are (src/session.ts).
// Read on sign-in, at launch, when the app comes back and when a push lands (src/push.tsx), on opening the inbox and on
// a pull; the next page when the list's end shows. Signed out, it's empty. The API keeps 180 days (its prune).
import type { InboxRow } from '@orbit/contract';
import { useMemo, useSyncExternalStore } from 'react';

import { announcementOf, type Message, mergeFirst, noticesApi, toMessage } from './notices';
import { api, meNow, useMe, useTickets } from './session';

export type { Message };

type Box = { owner: string; items: InboxRow[]; unread: number; next: string | null; loaded: boolean };
const EMPTY: Box = { owner: '', items: [], unread: 0, next: null, loaded: false };
let box = EMPTY;
let epoch = 0; // bumped by a read marked here and by each first-page read
let shown = 0; // the epoch of what the copy shows (a first page taken, or a read marked): older answers are dropped
let more: Promise<void> | null = null; // the next page's read under way, if any
const listeners = new Set<() => void>();
const set = (next: Box) => {
  box = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const mine = () => (box.owner === meNow() ? box : { ...EMPTY, owner: meNow() ?? '' });

// The first page, merged over the older pages already read in (notices.ts mergeFirst).
export async function loadInbox() {
  const who = meNow();
  if (!who) return;
  const at = ++epoch;
  const r = await noticesApi(api).inbox();
  // Failed: the copy stays as it is (still loaded, if a read ever landed). Taken unless someone else signed in or a
  // newer answer is already shown, so a later read failing never undoes an earlier one that worked.
  if (!r.ok || meNow() !== who || at <= shown) return;
  shown = at;
  const had = mine();
  set({ owner: who, ...mergeFirst(had.items, had.next, r.data), unread: r.data.unread, loaded: true });
}

// The page after the last one read in; one at a time.
export function loadMore() {
  const who = meNow();
  const from = box.owner === who ? box.next : null;
  if (!who || !from || more) return more ?? undefined;
  const at = epoch;
  more = noticesApi(api)
    .inbox(from)
    .then((r) => {
      if (!r.ok || meNow() !== who || at !== epoch || box.next !== from) return;
      const ids = new Set(box.items.map((x) => x.id));
      set({ ...box, items: [...box.items, ...r.data.items.filter((x) => !ids.has(x.id))], next: r.data.next, unread: r.data.unread });
    })
    .finally(() => {
      more = null;
    });
  return more;
}

// Opened, or Mark all read (no ids): read here at once, then told to the API and read again so the count is the
// server's. A failed call leaves the copy as it is; the next read corrects it.
export function markRead(ids?: readonly string[]) {
  const who = meNow();
  if (!who) return;
  const b = mine();
  const hit = (x: InboxRow) => !x.read && (!ids || ids.includes(x.id));
  const fresh = b.items.filter(hit).length;
  shown = ++epoch;
  set({ ...b, items: b.items.map((x) => (hit(x) ? { ...x, read: true } : x)), unread: ids ? Math.max(0, b.unread - fresh) : 0 });
  void noticesApi(api).read(ids).then(() => (meNow() === who ? loadInbox() : undefined));
}

const useBox = () => {
  const b = useSyncExternalStore(subscribe, () => box);
  return b.owner === useMe().id ? b : EMPTY;
};

// Every message read in, newest first, with whether it's unread and where it opens (a ticket message opens the ticket
// while there is one).
export function useInbox(): { messages: Message[]; loaded: boolean; more: boolean } {
  const b = useBox();
  const upcoming = useTickets().data?.upcoming;
  const messages = useMemo(() => {
    const ticketOf = (e: string) => upcoming?.find((t) => t.event.id === e && t.status === 'confirmed')?.id;
    return b.items.map((x) => toMessage(x, ticketOf));
  }, [b.items, upcoming]);
  return { messages, loaded: b.loaded, more: !!b.next };
}
export const useUnreadCount = () => useBox().unread; // the app icon's number, the API's count
export const useUnread = () => useUnreadCount() > 0;

// The host's newest announcement for an event, shown on top of its ticket (Notifications doc: a host announcement opens
// "the ticket, with the announcement on top"); none read in, nothing shown.
export function useAnnouncement(eventId: string): InboxRow | undefined {
  const { items } = useBox();
  return useMemo(() => announcementOf(items, eventId), [items, eventId]);
}
