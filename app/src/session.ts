// Signed in or signed out on this phone (User flow doc, settled 15 Nov 2026). A fresh install starts signed out, and
// browsing Home, Search, events and hosts never asks. Saving, following, booking and anything of your own ask through
// the sign-in sheet (src/app/login.tsx), then finish what was tapped ("come back to where you were").
// The account comes from the Orbit API (src/api.ts). What the first frame needs (signed in, the account and its roles)
// is saved on the phone and read back synchronously at launch, the way the location is (src/place.ts); the refresh
// token is kept in the Keychain, and the access token only in memory.
// Followed hosts come from the API (GET /me/follows), and so do saved events and lists (GET /me/saves) since 25 Nov 2026:
// the phone shows a change at once, tells the API, and puts it back if the API says no; the server's copy wins.
import { type ApiError, type AuthStep, type CategorySlug, type Me as Account, movedCategory, type MyTickets, type Ticket } from '@orbit/contract';
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useSyncExternalStore } from 'react';
import { Alert, Platform } from 'react-native';

import type { Way } from './account/rules';
import type { PayWith, UpiId } from './pay';
import * as saves from './account/saves';
import { type Change, confirmed, fresh, fromServer, queued, refused, savesApi, shown, withRead } from './account/savesApi';
import { isKnown, remember } from './account/seen';
import { API_URL, makeApi, OFFLINE, type Result } from './api';
import { hostsApi } from './hosts';
import type { Viewer } from './home/layout';
import { hideNote, showNote } from './note';
import { noticesApi } from './notices';
import { CACHE_PREFIX, cacheKey, keptUpcoming, letInAt, packTicket, ticketsApi, unpackTicket, upcomingOf } from './tickets';

let saveEpoch = 0; // bumped by every save change made here, and by sign-in and sign-out: an older read can't undo it
// Whether the saves have been read this launch: Account › Saved draws a wait, not "Nothing saved yet", until they have.
let savesStatus: 'loading' | 'ready' | 'failed' = 'loading';
let reading: Promise<void> | null = null; // the saves read under way, if any
let queue: Promise<unknown> = Promise.resolve(); // every saves call, one after another, in the order they were tapped
let model = fresh({ saved: [], lists: [] }); // what the server confirmed, and the changes still waiting (savesApi.ts)

const KEY = 'orbit.session';
const DEVICE = 'orbit.device';
const REFRESH = 'orbit.refresh';

// Saved events and lists (src/account/saves.ts) ride along: each save with when it was made, and the lists.
// `interests` is unset until you pick or skip them (Home asks once); `interested` and `loved` are event ids.
export type Session = {
  via: Way;
  follows: readonly string[];
  interests?: readonly CategorySlug[];
  interested?: readonly string[];
  loved?: readonly string[];
  rooms?: readonly string[]; // meetups whose inRoom you joined
  asked?: readonly string[]; // `${event}|${person}`: people you asked to connect with in a room
  payWith?: PayWith; // the way you like to pay (Account › Payment methods); never a card or bank detail
  upiIds?: readonly UpiId[]; // UPI IDs you added once Razorpay found whose they are (owner, 19 Nov 2026)
  hostsOff?: readonly string[]; // followed hosts set to Off (GET /me/follows' notify): their new events reach only your inbox
  me: Account;
} & saves.Saves;

// The refresh token, in the Keychain (Android: the Keystore), readable once the phone has been unlocked after a restart
// and never copied to a backup or another phone. expo-secure-store is a native module: on a build made before it was
// added, it isn't there, and the token stays in memory only, so a sign-in lasts until the app closes. Never kv-store.
let secure: typeof import('expo-secure-store') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional: a static import throws on a build without it
  secure = require('expo-secure-store');
} catch {
  secure = null;
}
const KEYCHAIN = secure ? { keychainAccessible: secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } : {};
let token: string | null | undefined; // undefined: not read from the Keychain yet
let unreadable = false; // the Keychain failed to answer (a launch before the first unlock): signed out this time only
// Keychain writes go one after another, in order: a delete still under way must never land after the next sign-in's
// token and wipe it. Reads come from memory once the first one is done.
let writes = Promise.resolve();
const refreshToken = {
  get(): string | null {
    if (token !== undefined) return token;
    try {
      token = secure?.getItem(REFRESH, KEYCHAIN) ?? null;
    } catch {
      token = null;
      unreadable = true;
    }
    return token;
  },
  set(next: string | null) {
    token = next;
    const store = secure;
    if (!store) return;
    // Not kept, on a failure: still signed in until the app closes.
    writes = writes.then(() => (next ? store.setItemAsync(REFRESH, next, KEYCHAIN) : store.deleteItemAsync(REFRESH, KEYCHAIN))).catch(() => {});
  },
};

function stored(): Session | null {
  try {
    const s = JSON.parse(Storage.getItemSync(KEY) ?? 'null');
    const ok = typeof s?.via === 'string' && Array.isArray(s.saved) && Array.isArray(s.follows) && typeof s.me?.id === 'string';
    if (ok && refreshToken.get()) {
      // Interests picked before the eight tiles move with their category (Music to Jams; Film and Startups to Events),
      // so none is left unpickable. Workshops is a tile again since 26 Nov 2026, so it stays.
      const interests = Array.isArray(s.interests) ? [...new Set(s.interests.map((c: string) => movedCategory[c] ?? c))] : s.interests;
      return { ...s, interests, ...saves.normalise(s, Date.now()) }; // one stored before lists keeps its saves
    }
    // No refresh token: a session from before the API, or one whose token stayed in memory, so signed out, and the
    // account's details aren't left behind on the phone.
    if (s && !unreadable) Storage.removeItemSync(KEY);
    return null;
  } catch {
    return null; // unreadable: signed out
  }
}

let current = stored();
model = fresh(current ? { saved: current.saved, lists: current.lists } : { saved: [], lists: [] });
const listeners = new Set<() => void>();

function set(next: Session | null) {
  if (!next) {
    hideNote(); // a note's Undo or Add to a list belongs to the account that showed it
    saveEpoch++; // a saves read still out belongs to the account that left
    savesStatus = 'loading';
    queue = Promise.resolve(); // the next account never waits behind, or sends, what this one left
    reading = null;
    model = fresh({ saved: [], lists: [] });
    tickets = NO_TICKETS;
    forgetTickets(); // the tickets kept for offline go with the account
  }
  current = next;
  for (const fn of listeners) fn();
  try {
    if (next) Storage.setItemSync(KEY, JSON.stringify(next));
    else Storage.removeItemSync(KEY);
  } catch {
    // Not saved this time: the app still shows it until it closes.
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useSession = () => useSyncExternalStore(subscribe, () => current);
export const useSignedIn = () => useSession() !== null;

// Who Home and the pages draw for: once signed in, the account's initial, its follows, interests and upcoming tickets
// (GET /me/tickets); the place is src/place.ts's, never the session's (null here).
export function useViewer(): Viewer {
  const s = useSession();
  const mine = useTickets().data;
  const initial = s?.me.name?.trim()[0]?.toUpperCase();
  return s
    ? { signedIn: true, follows: s.follows, place: null, tickets: upcomingOf(mine, Date.now()), interests: s.interests, ...(initial && { initial }) }
    : { signedIn: false, follows: [], place: null };
}

// The account's tickets (GET /me/tickets, src/tickets.ts): read at launch and sign-in, when Home, an event page or the
// Tickets and History screens come into view, and after a booking or a cancel. Each upcoming one is also kept on the
// phone (kv-store, one key per ticket) so its QR opens with no signal; the rest are dropped from there.
// `fresh`: the API's answer, not the phone's copies (which have no past half, so History waits for the answer).
type Tickets = { owner: string; data: MyTickets | null; error: ApiError | null; fresh: boolean };
const NO_TICKETS: Tickets = { owner: '', data: null, error: null, fresh: false };
// At launch, the tickets kept on this phone for the account signed in, until GET /me/tickets answers.
function keptTickets(): Tickets {
  if (!current) return NO_TICKETS;
  try {
    const raws = Storage.getAllKeysSync().filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => Storage.getItemSync(k));
    const upcoming = keptUpcoming(raws, current.me.id, Date.now());
    return upcoming.length ? { owner: current.me.id, data: { upcoming, past: [] }, error: null, fresh: false } : NO_TICKETS;
  } catch {
    return NO_TICKETS;
  }
}
let tickets = keptTickets();
let ticketEpoch = 0; // bumped by a booking or cancel here: a list read that started before it is dropped, never kept
const emit = () => {
  for (const fn of listeners) fn();
};
function forgetTickets(keep: readonly string[] = []) {
  try {
    for (const k of Storage.getAllKeysSync()) if (k.startsWith(CACHE_PREFIX) && !keep.includes(k)) Storage.removeItemSync(k);
  } catch {
    // unreadable: left until the next read
  }
}
export function keepTicket(t: Ticket) {
  if (!current) return;
  try {
    Storage.setItemSync(cacheKey(t.id), packTicket(current.me.id, t));
  } catch {
    // not kept this time: the ticket still shows while online
  }
}
export function keptTicket(id: string): Ticket | null {
  if (!current) return null;
  try {
    return unpackTicket(Storage.getItemSync(cacheKey(id)), current.me.id);
  } catch {
    return null;
  }
}
export async function loadTickets() {
  const who = current?.me.id;
  if (!who) return;
  const at = ticketEpoch;
  const r = await ticketsApi(api).mine();
  if (current?.me.id !== who) return; // signed out, or someone else in: not theirs
  if (at !== ticketEpoch) return; // a booking or cancel landed meanwhile: this answer may not have it
  const had = tickets.owner === who ? tickets : NO_TICKETS;
  tickets = r.ok ? { owner: who, data: r.data, error: null, fresh: true } : { owner: who, data: had.data, error: r.error, fresh: had.fresh };
  if (r.ok) {
    r.data.upcoming.forEach(keepTicket);
    forgetTickets(r.data.upcoming.map((t) => cacheKey(t.id)));
  }
  emit();
}
// A ticket booked or cancelled here: kept as it now is, and the list read again (any read already out is dropped).
export function ticketsChanged(t: Ticket) {
  ticketEpoch++;
  keepTicket(t);
  void loadTickets();
}
// The tickets for the account signed in now: `data` is null until the first answer (or the phone's copies).
export function useTickets() {
  const t = useSyncExternalStore(subscribe, () => tickets);
  const me = useSession()?.me.id;
  return t.owner === me ? t : NO_TICKETS;
}
// The account's live ticket for an event, outside a component (a tapped push, src/push.tsx).
export const ticketNow = (eventId: string) =>
  tickets.owner === current?.me.id ? tickets.data?.upcoming.find((t) => t.event.id === eventId && t.status === 'confirmed')?.id : undefined;
export const useTicketsOnFocus = () =>
  useFocusEffect(
    useCallback(() => {
      void loadTickets();
    }, []),
  );
// The account's id, to key what's read for it; '' while signed out.
const SIGNED_OUT = { id: '' };
export const useMe = (): { id: string } => useSession()?.me ?? SIGNED_OUT;
// The same, outside a component (src/inboxStore.ts, src/push.tsx).
export const meNow = () => current?.me.id;
// This sign-in, outside a component and as a hook: the account and a count of sign-ins this launch. A sign-in starts a
// new session on the API even for the same account, so the push token goes again (src/push.tsx).
let signIns = 0;
const signInKey = () => (current ? `${current.me.id}#${signIns}` : undefined);
export const signInNow = signInKey;
export const useSignIn = () => useSyncExternalStore(subscribe, signInKey);

export const useSaved = (eventId: string) => useSession()?.saved.some((x) => x.id === eventId) ?? false;
export const useLoved = (eventId: string) => useSession()?.loved?.includes(eventId) ?? false;
export const useInterested = (eventId: string) => useSession()?.interested?.includes(eventId) ?? false;
export const useFollowing = (hostId: string) => useSession()?.follows.includes(hostId) ?? false;

const turn = (list: readonly string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
// Unfollowing forgets the host's Off, so following again starts at All (Notifications decision 3).
// `followedHere` only changes this phone's list; `setFollowing` also tells the API (the real hosts' ids are uuids; the
// mock's aren't, so they stay on the phone), and puts the tap back if it says no.
let followEpoch = 0; // bumped by every follow tapped here, so an older read of the list can't undo it
export const followedHere = (hostId: string, on: boolean) =>
  (followEpoch++, current) && set({ ...current, follows: turn(current.follows, hostId, on), hostsOff: on ? current.hostsOff : current.hostsOff?.filter((x) => x !== hostId) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function setFollowing(hostId: string, on: boolean) {
  followedHere(hostId, on);
  if (!current || !UUID.test(hostId)) return;
  const who = current.me.id;
  void hostsApi(api).follow(hostId, on).then((r) => {
    if (r.ok || current?.me.id !== who) return; // signed out, or someone else in: the tap isn't theirs to undo
    followedHere(hostId, !on);
    Alert.alert(on ? 'Couldn’t follow' : 'Couldn’t unfollow', r.error.message);
  });
}
// The way you like to pay, ready at checkout (owner, 19 Nov 2026: Payment methods); on this phone only.
export const usePayWith = () => useSession()?.payWith;
export const setPayWith = (p: PayWith) => current && set({ ...current, payWith: p });
const noUpiIds: readonly UpiId[] = [];
export const useUpiIds = () => useSession()?.upiIds ?? noUpiIds;
// A checked UPI ID goes on the list (once) and becomes the way you pay.
export const addUpiId = (u: UpiId) =>
  current && set({ ...current, upiIds: [...(current.upiIds ?? []).filter((x) => x.vpa !== u.vpa), u], payWith: { kind: 'vpa', vpa: u.vpa } });
// Off the list; if it was your default, there's none until you pick again (checkout then asks how to pay).
export function removeUpiId(vpa: string) {
  if (!current) return;
  const wasDefault = current.payWith?.kind === 'vpa' && current.payWith.vpa === vpa;
  set({ ...current, upiIds: (current.upiIds ?? []).filter((x) => x.vpa !== vpa), payWith: wasDefault ? undefined : current.payWith });
}
// Who you follow right now, outside a component (a tap's follow-up).
export const followsNow = () => current?.follows ?? [];
// "Loved it" on an event you went to (owner, 19 Nov 2026: "replace the love with loved it"; Booking doc: after the
// show, only people scanned in). A tap turns it on or off.
// ponytail: on this phone only, like follows; the API's Loved it (counting toward the performer or host) replaces it.
export const setLoved = (eventId: string, on: boolean) => current && set({ ...current, loved: turn(current.loved ?? [], eventId, on) });
// Interest (owner, 19 Nov 2026: "add interest cards for events", all four): the kinds of event you like, picked on
// Account › Interests or from Home's one ask (an empty list once skipped, so it isn't asked again), and Interested on
// an event's page, apart from Save.
// ponytail: on this phone only, like follows, until the API keeps them and Recommendations reads them.
export const setInterest = (slug: CategorySlug, on: boolean) =>
  current && set({ ...current, interests: turn(current.interests ?? [], slug, on) as CategorySlug[] });
export const skipInterests = () => current && set({ ...current, interests: current.interests ?? [] });
// inRoom (inRoom flow): joining a meetup's room after you were let in, and asking someone there to connect.
// ponytail: on this phone only; the API's room, its swaps of ways to reach and blocking come with inRoom (P16).
export const useInRoom = (eventId: string) => useSession()?.rooms?.includes(eventId) ?? false;
// Whether you were let in at a real event's door on any of your tickets (X5 check-in): inRoom's join and Thanks for
// coming open only then. The old mock's events answer from its history, at the callers.
export const useLetIn = (eventId: string) => letInAt(useTickets().data, eventId);
export const setInRoom = (eventId: string, on: boolean) => current && set({ ...current, rooms: turn(current.rooms ?? [], eventId, on) });
export const useAsked = (eventId: string, personId: string) => useSession()?.asked?.includes(`${eventId}|${personId}`) ?? false;
export const askToConnect = (eventId: string, personId: string) =>
  current && set({ ...current, asked: turn(current.asked ?? [], `${eventId}|${personId}`, true) });
export const setInterested = (eventId: string, on: boolean) => current && set({ ...current, interested: turn(current.interested ?? [], eventId, on) });
// All or Off per followed host (Notifications decision 3; Off stops the push and the email, the inbox copy still lands):
// read with the follows, shown at once when tapped and sent (PUT /me/follows/:id/notify), put back if the API says no.
// The old mock's hosts stay on the phone, as their follows do.
export const useHostOff = (hostId: string) => useSession()?.hostsOff?.includes(hostId) ?? false;
const offHere = (hostId: string, off: boolean) => current && set({ ...current, hostsOff: turn(current.hostsOff ?? [], hostId, off) });
export function setHostOff(hostId: string, off: boolean) {
  offHere(hostId, off);
  if (!current || !UUID.test(hostId)) return;
  const who = current.me.id;
  followEpoch++; // a follows read already out may not have it
  void noticesApi(api).hostNotify(hostId, off ? 'off' : 'all').then((r) => {
    if (r.ok || current?.me.id !== who) return;
    offHere(hostId, !off);
    Alert.alert('Couldn’t change that', r.error.message);
  });
}

// Anything that needs an account: done at once when signed in; otherwise the sign-in sheet opens over the screen and
// `action` runs once it closes signed in. Every way into the sheet comes through here, so a sheet closed without
// signing in leaves nothing behind that a later one could run.
let pending: (() => void) | undefined;
export function needsAccount(action?: () => void) {
  if (current) return action?.();
  pending = action;
  router.push('/login');
}

// Signed in from the sheet: do what was tapped.
export function runPending() {
  const action = pending;
  pending = undefined;
  action?.();
}

// Saving (Saved events and lists doc). Only saves of events that can still be opened count toward the 1,000: those whose
// card is here (the API's answer leaves the hidden ones out).
export const canOpen = isKnown;


// One save change, the way a follow goes: shown at once, then sent to the API, and taken back if it says no. Answers null
// once done, or the problem to show where the person is. A change with no `send` stays on the phone (an event of the old
// mock, which the API doesn't know).
// What's drawn is the server's last confirmed saves with the changes still waiting replayed on top (savesApi.ts), so a
// refused change leaves exactly itself out, whatever was tapped after it. Calls go one after another on `queue`, in the
// order they were tapped, and a call for an account that has since signed out is never sent (it would carry the next
// account's token). A refusal alerts the API's message and, online, reads the saves again once the queue has drained
// ("two phones: the server's copy wins"; "That list is gone" the same). Offline there's no queue of retries.
let changes = 0;
const draw = () => current && set({ ...current, ...shown(model) });
function change(next: Change, send?: () => Promise<Result<unknown>>, failed?: () => void): string | null {
  if (!current) return null;
  const made = next(shown(model));
  if (typeof made === 'string') return made;
  const id = ++changes;
  const who = current.me.id;
  saveEpoch++;
  model = queued(model, id, next);
  if (!send) model = confirmed(model, id); // phone-only: nothing to wait for
  draw();
  if (!send) return null;
  const run = queue.then((): Promise<Result<unknown>> | Result<unknown> => (current?.me.id === who ? send() : { ok: true, data: null }));
  queue = run.catch(() => {});
  const handle = (r: Result<unknown>) => {
    if (current?.me.id !== who) return; // signed out, or someone else in: nothing here is theirs
    if (r.ok) {
      model = confirmed(model, id);
      return;
    }
    saveEpoch++;
    model = refused(model, id);
    draw();
    failed?.();
    Alert.alert(r.error.message);
    if (r.status !== 0) void loadSaves();
  };
  void run.then(handle, () => handle({ ok: false, status: 0, error: OFFLINE }));
  return null;
}
// A real event's id is a uuid; the old mock's aren't.
export const real = (id: string) => UUID.test(id);
// An Undo with only the real events' ids: the API never knew the old mock's.
const onlyReal = (u: saves.Undo): saves.Undo => ({
  saves: u.saves.filter((x) => real(x.id)),
  lists: Object.fromEntries(Object.entries(u.lists).map(([id, ids]) => [id, ids.filter(real)])),
});
// The time is taken once, at the tap: a replay draws the same save, not a newer one.
const saveEvent = (eventId: string, at = Date.now()) =>
  change((s) => saves.save(s, eventId, at, canOpen), real(eventId) ? () => savesApi(api).save(eventId) : undefined);

// The star, Save (owner, 16 Nov 2026: "instead of toast use modal, when clicked on love"; a heart until 19 Nov, "saved love
// with star"): an empty star saves at once and
// opens the list modal over the page (src/app/lists/[event].tsx); a saved one opens it too, where Remove from saved
// unsaves. `on` is what the tap asked for, never a toggle, so a save tapped while signed out still saves when the
// account already had it. Signed out, the sign-in sheet comes first and the save lands after; no modal then, as the
// sheet is still leaving and one opened over it goes astray. The star filling says it's saved.
// A refusal (full, offline, the event gone) rolls the star back and says why (change above). The push ask on an event not on
// sale yet waits for notifications.
export function tapSave(eventId: string, on: boolean, fromMenu = false) {
  const signingIn = !current;
  const openLists = () => router.push(`/lists/${eventId}`);
  needsAccount(() => {
    const problem = on ? saveEvent(eventId) : null;
    if (!signingIn) return problem ? Alert.alert(problem) : openLists();
    // Just signed in, the sheet still leaving: a note, drawn over it, says what happened instead.
    if (problem) showNote({ text: problem });
    else if (fromMenu) showNote({ text: 'Saved', action: { label: 'Add to a list', run: openLists } });
  });
}
// Add to a list, from an event's menu or a saved row's: the star's modal, saving first if it isn't.
export const addToList = (eventId: string) => tapSave(eventId, true, true);

// Unsave, from the list modal or a saved row's menu: gone from All saved and every list at once, with Undo for 5
// seconds (until dismissed with assistive tech on, src/note.tsx). Remove all past passes every past save. Undo asks the
// API to put the same saves back, with their dates and lists.
export function removeSaves(ids: readonly string[]) {
  if (!current || ids.length === 0) return;
  const { undo } = saves.unsave(shown(model), ids);
  const sent = ids.filter(real);
  change((s) => saves.unsave(s, ids).next, sent.length ? () => savesApi(api).remove(sent) : undefined, hideNote);
  showNote({
    text: ids.length === 1 ? 'Removed from saved' : `Removed ${ids.length} saved events`,
    action: { label: 'Undo', run: () => void change((s) => saves.restore(s, undo), sent.length ? () => savesApi(api).restore(onlyReal(undo)) : undefined) },
    ms: 5000,
  });
}

// The lists. Each answers null once done, or the problem to show where the person is.
const newId = () => `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export function newList(name: string, eventId?: string) {
  const id = newId();
  const at = Date.now();
  const mine = eventId && real(eventId) ? eventId : null;
  return change(
    (s) => {
      const made = saves.create(s, name, id, at);
      return typeof made === 'string' || !eventId ? made : saves.tick(made, id, eventId, true, at, canOpen);
    },
    // One call: the list, with its first event saved first if it isn't, so a half-made list never shows.
    () => savesApi(api).putList(id, name.trim(), { first: mine }),
  );
}
export const renameList = (id: string, name: string) => change((s) => saves.rename(s, id, name), () => savesApi(api).putList(id, name.trim()));
// Deleting a list that's already gone is what was asked for, not a failure.
export const deleteList = (id: string) =>
  change(
    (s) => saves.drop(s, id),
    async () => {
      const r = await savesApi(api).deleteList(id);
      return !r.ok && r.error.error === 'listGone' ? { ok: true as const, data: null } : r;
    },
  );
export const tickList = (listId: string, eventId: string, on: boolean, at = Date.now()) =>
  change(
    (s) => saves.tick(s, listId, eventId, on, at, canOpen),
    real(eventId) ? () => savesApi(api).tick(listId, eventId, on) : undefined,
  );

// Signed out by the API: a suspension says why and until when (the API keeps the token unspent so it can).
export const api = makeApi({
  base: API_URL,
  fetch,
  refreshToken,
  client: `${Platform.OS}/${Constants.expoConfig?.version ?? ''}`, // "ios/1.0.0", for Galaxy's Analytics

  onEnded: (why) => {
    set(null);
    if (why.error === 'suspended') Alert.alert('Signed out', why.message);
  },
});

// This phone, as the API knows it. The id is the one the API gave it at the first sign-in, kept across sign-outs:
// without it every sign-in is a new device, and a phone code on a new device asks "Is this you?" and starts the
// account's 7-day hold.
export function thisDevice() {
  let id: string | null = null;
  try {
    id = Storage.getItemSync(DEVICE);
  } catch {
    // unreadable: a new device to the API
  }
  const name = Constants.deviceName?.trim() || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
  return { ...(id && { id }), name: name.slice(0, 100), client: 'app' as const };
}

// The sign-in sheet's last step: keep the device id and the tokens, and draw the account.
export function signIn(done: Extract<AuthStep, { step: 'signedIn' }>, via: Way) {
  try {
    Storage.setItemSync(DEVICE, done.device);
  } catch {
    // Not kept: the next sign-in is a new device.
  }
  api.start(done);
  signIns++;
  saveEpoch++; // reads still out belong to whoever was here before
  savesStatus = 'loading';
  queue = Promise.resolve(); // nothing of an earlier account's is waited on or sent
  reading = null;
  const kept = current ? { saved: current.saved, lists: current.lists } : saves.normalise({ saved: [], lists: [] }, Date.now());
  // What's kept on this phone carries over, follows to Loved it, as saves do.
  const mine = current && { interests: current.interests, interested: current.interested, loved: current.loved, rooms: current.rooms, asked: current.asked, payWith: current.payWith, upiIds: current.upiIds, hostsOff: current.hostsOff };
  model = fresh(kept);
  set({ via, ...kept, ...mine, follows: current?.follows ?? [], me: done.me });
  void loadFollows();
  void loadSaves();
  void loadTickets();
}

// The hosts the account follows, as the API has them (ids only; a host gone private is left out there).
// A follow tapped while it waited has already been sent, so the read goes again (once) rather than being dropped.
async function loadFollows(retry = true): Promise<void> {
  const at = followEpoch;
  const who = current?.me.id; // an answer for an account that has since signed out never lands on the next one
  const r = await hostsApi(api).follows();
  if (current?.me.id !== who) return;
  // ponytail: one re-read after a tap; a follow POST still in flight when that re-read lands can show Follow until the
  // next launch. Overlay the pending taps on the answer if that ever shows up.
  if (at !== followEpoch) return retry ? loadFollows(false) : undefined;
  // Real hosts' Off comes from the API; a mock host's (not a UUID, kept on the phone only) stays as it was.
  if (r.ok && current)
    set({
      ...current,
      follows: r.data.map((h) => h.id),
      hostsOff: [...(current.hostsOff ?? []).filter((x) => !UUID.test(x)), ...r.data.filter((h) => h.notify === 'off').map((h) => h.id)],
    });
}

// The saves and lists as the API has them: they become what the server confirmed, with the changes still waiting drawn
// on top, and the events that came with them are kept to draw. It waits for the saves calls still out, so it never reads
// before them. A change tapped while it waited has already been sent, so the read goes again (once) rather than being
// dropped. A read that lands after sign-out, or for another account, is dropped. When it gives up and nothing has been
// read yet, the status says failed, so the screens offer Try again.
async function readSaves(): Promise<void> {
  const who = current?.me.id;
  if (!who) return;
  if (savesStatus === 'failed') {
    savesStatus = 'loading';
    for (const fn of listeners) fn();
  }
  for (let tries = 0; tries < 2; tries++) {
    await queue;
    const at = saveEpoch;
    const r = await savesApi(api).read();
    if (current?.me.id !== who) return;
    if (at !== saveEpoch) continue;
    if (!r.ok) break;
    remember(r.data.events);
    savesStatus = 'ready';
    model = withRead(model, fromServer(r.data));
    draw();
    for (const fn of listeners) fn();
    return;
  }
  if (savesStatus !== 'ready') {
    savesStatus = 'failed';
    for (const fn of listeners) fn();
  }
}
// One read at a time: a call while one is out joins it. A sign-in or sign-out forgets the one out (set, signIn), so
// the next account never joins a read that belongs to the last; that read, when it ends, clears only itself.
function loadSaves(): Promise<void> {
  if (reading) return reading;
  const mine: Promise<void> = readSaves().finally(() => {
    if (reading === mine) reading = null;
  });
  reading = mine;
  return mine;
}
// Reading them again, for a Try again.
export const reloadSaves = () => loadSaves();
export const useSavesStatus = () => useSyncExternalStore(subscribe, () => savesStatus);
// Account › Saved and a list's screen read the saves each time they come into view, which also refreshes the events'
// statuses; not while a read is already under way.
export function useSavesOnFocus() {
  useFocusEffect(
    useCallback(() => {
      if (!reading) void loadSaves();
    }, []),
  );
}

// The account as the API has it now (a name, a role or a deletion changed elsewhere). Once at launch.
export async function refreshAccount() {
  if (!current) return;
  const saved = loadSaves(); // not behind /me: a failing /me must not leave Saved waiting
  void loadTickets();
  const r = await api.authed<Account>('GET', '/me');
  if (r.ok && current?.me.id === r.data.id) {
    set({ ...current, me: r.data });
    await loadFollows();
  }
  await saved;
}
export const setAccount = (me: Account) => current?.me.id === me.id && set({ ...current, me });
// A field or two the API changed (a new number or email), onto the account as it is now.
export const patchAccount = (fields: Partial<Account>) => current && set({ ...current, me: { ...current.me, ...fields } });

// Keep my account (User doc, Account deletion): signing in within the 30 days stops the deletion. Answers the API's
// message when it said no, or null.
let keeping = false; // a second tap while the first is out says nothing
export async function keepAccount() {
  if (keeping) return null;
  keeping = true;
  try {
    const r = await api.authed('POST', '/me/deletion/keep');
    if (r.ok || r.error.error === 'notPending') await refreshAccount();
    return r.ok || r.error.error === 'notPending' ? null : r.error.message;
  } finally {
    keeping = false;
  }
}

// Log out, and Delete account, which signs out every device (User doc). The API is told without waiting.
export function signOut() {
  api.signOut();
  set(null);
}
