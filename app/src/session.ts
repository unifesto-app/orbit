// Signed in or signed out on this phone (User flow doc, settled 15 Nov 2026). A fresh install starts signed out, and
// browsing Home, Search, events and hosts never asks. Saving, following, booking and anything of your own ask through
// the sign-in sheet (src/app/login.tsx), then finish what was tapped ("come back to where you were").
// The account comes from the Orbit API (src/api.ts). What the first frame needs (signed in, the account and its roles)
// is saved on the phone and read back synchronously at launch, the way the location is (src/place.ts); the refresh
// token is kept in the Keychain, and the access token only in memory.
// ponytail: saved events and saved lists stay on this phone, seeded from the mock (src/account/data.ts, src/mock.ts),
// until the API has them. Followed hosts come from the API (GET /me/follows) since 25 Nov 2026.
import { type AuthStep, type CategorySlug, type Me as Account, movedCategory } from '@orbit/contract';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { Alert, Platform } from 'react-native';

import { lists as listsMock, saved as savedMock } from './account/data';
import type { Way } from './account/rules';
import type { PayWith, UpiId } from './pay';
import * as saves from './account/saves';
import { API_URL, makeApi } from './api';
import { hostsApi } from './hosts';
import type { Viewer } from './home/layout';
import { events, viewer } from './mock';
import { hideNote, showNote } from './note';

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
  read?: readonly string[]; // inbox messages opened on this phone (src/app/inbox.tsx)
  hostsOff?: readonly string[]; // followed hosts set to Off: their new events reach only your inbox
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
      // Interests picked before the eight tiles move with their category (Music to Jams; Workshops, Film and Startups
      // to Events), so none is left unpickable.
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
const listeners = new Set<() => void>();

function set(next: Session | null) {
  if (!next) hideNote(); // a note's Undo or Add to a list belongs to the account that showed it
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

// Who Home and the pages draw for: once signed in, the account's initial, its follows and interests; the place is
// src/place.ts's, never the session's (null here). The tickets are still the mock's until bookings reach the API.
// ponytail: `tickets` from the mock viewer until the bookings slice (P12.2).
export function useViewer(): Viewer {
  const s = useSession();
  const initial = s?.me.name?.trim()[0]?.toUpperCase();
  return s
    ? { signedIn: true, follows: s.follows, place: null, tickets: viewer.tickets, interests: s.interests, ...(initial && { initial }) }
    : { signedIn: false, follows: [], place: null };
}
// The account's id, to key what's read for it; '' while signed out.
const SIGNED_OUT = { id: '' };
export const useMe = (): { id: string } => useSession()?.me ?? SIGNED_OUT;

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
export const setInRoom = (eventId: string, on: boolean) => current && set({ ...current, rooms: turn(current.rooms ?? [], eventId, on) });
export const useAsked = (eventId: string, personId: string) => useSession()?.asked?.includes(`${eventId}|${personId}`) ?? false;
export const askToConnect = (eventId: string, personId: string) =>
  current && set({ ...current, asked: turn(current.asked ?? [], `${eventId}|${personId}`, true) });
export const setInterested = (eventId: string, on: boolean) => current && set({ ...current, interested: turn(current.interested ?? [], eventId, on) });
// The inbox (Notifications doc): read state per message, and All or Off per followed host (decision 3; Off stops the
// push and the email, the inbox copy still lands).
// ponytail: on this phone only, like follows; the API's inbox carries read state and the host switches.
const noRead: readonly string[] = [];
export const useRead = () => useSession()?.read ?? noRead;
export function markRead(ids: readonly string[]) {
  const fresh = current ? ids.filter((id) => !current!.read?.includes(id)) : [];
  if (current && fresh.length) set({ ...current, read: [...(current.read ?? []), ...fresh] });
}
export const useHostOff = (hostId: string) => useSession()?.hostsOff?.includes(hostId) ?? false;
export const setHostOff = (hostId: string, off: boolean) => current && set({ ...current, hostsOff: turn(current.hostsOff ?? [], hostId, off) });

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

// Saving (Saved events and lists doc). Only saves of events that can still be opened count toward the 1,000.
// A real event (a uuid) counts too: its page opens from the API.
export const canOpen = (id: string) => UUID.test(id) || events.some((e) => e.id === id);

// Applies a change to the saves: null once done, or the problem to show ("You have 1,000 saved…").
function apply(change: (s: saves.Saves) => saves.Saves | string): string | null {
  if (!current) return null;
  const next = change(current);
  if (typeof next === 'string') return next;
  set({ ...current, ...next });
  return null;
}
const saveEvent = (eventId: string) => apply((s) => saves.save(s, eventId, Date.now(), canOpen));

// The star, Save (owner, 16 Nov 2026: "instead of toast use modal, when clicked on love"; a heart until 19 Nov, "saved love
// with star"): an empty star saves at once and
// opens the list modal over the page (src/app/lists/[event].tsx); a saved one opens it too, where Remove from saved
// unsaves. `on` is what the tap asked for, never a toggle, so a save tapped while signed out still saves when the
// account already had it. Signed out, the sign-in sheet comes first and the save lands after; no modal then, as the
// sheet is still leaving and one opened over it goes astray. The star filling says it's saved.
// ponytail: at the cap the star doesn't fill first and roll back (doc); it stays empty and an alert says why. The
// API's answer makes it a real roll-back. The push ask on an event not on sale yet waits for notifications.
export function tapSave(eventId: string, on: boolean, fromMenu = false) {
  const signingIn = !current;
  const openLists = () => router.push(`/lists/${eventId}`);
  needsAccount(() => {
    // ponytail: a real event has no lists sheet and isn't drawn in Saved yet; both come with saves in the API (P9). Until
    // then the star saves on the phone and a note says so.
    if (UUID.test(eventId)) {
      if (!on) return removeSaves([eventId]);
      const problem = saveEvent(eventId);
      return problem ? Alert.alert(problem) : showNote({ text: 'Saved' });
    }
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
// seconds (until dismissed with assistive tech on, src/note.tsx). Remove all past passes every past save.
export function removeSaves(ids: readonly string[]) {
  if (!current || ids.length === 0) return;
  const { next, undo } = saves.unsave(current, ids);
  set({ ...current, ...next });
  showNote({
    text: ids.length === 1 ? 'Removed from saved' : `Removed ${ids.length} saved events`,
    action: { label: 'Undo', run: () => apply((s) => saves.restore(s, undo)) },
    ms: 5000,
  });
}

// The lists. Each answers null once done, or the problem to show where the person is.
const newId = () => `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export function newList(name: string, eventId?: string) {
  const id = newId();
  const at = Date.now();
  return apply((s) => {
    const made = saves.create(s, name, id, at);
    return typeof made === 'string' || !eventId ? made : saves.tick(made, id, eventId, true, at, canOpen);
  });
}
export const renameList = (id: string, name: string) => apply((s) => saves.rename(s, id, name));
export const deleteList = (id: string) => apply((s) => saves.drop(s, id));
export const tickList = (listId: string, eventId: string, on: boolean) => apply((s) => saves.tick(s, listId, eventId, on, Date.now(), canOpen));

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
  const kept = current ? { saved: current.saved, lists: current.lists } : saves.normalise({ saved: savedMock, lists: listsMock }, Date.now());
  // What's kept on this phone carries over, follows to Loved it, as saves do.
  const mine = current && { interests: current.interests, interested: current.interested, loved: current.loved, rooms: current.rooms, asked: current.asked, payWith: current.payWith, upiIds: current.upiIds, read: current.read, hostsOff: current.hostsOff };
  set({ via, ...kept, ...mine, follows: current?.follows ?? [], me: done.me });
  void loadFollows();
}

// The hosts the account follows, as the API has them (ids only; a host gone private is left out there).
// A follow tapped while it waited has already been sent, so the read goes again (once) rather than being dropped.
async function loadFollows(retry = true): Promise<void> {
  const at = followEpoch;
  const r = await hostsApi(api).follows();
  // ponytail: one re-read after a tap; a follow POST still in flight when that re-read lands can show Follow until the
  // next launch. Overlay the pending taps on the answer if that ever shows up.
  if (at !== followEpoch) return retry ? loadFollows(false) : undefined;
  if (r.ok && current) set({ ...current, follows: r.data.map((h) => h.id) });
}

// The account as the API has it now (a name, a role or a deletion changed elsewhere). Once at launch.
export async function refreshAccount() {
  if (!current) return;
  const r = await api.authed<Account>('GET', '/me');
  if (r.ok && current?.me.id === r.data.id) {
    set({ ...current, me: r.data });
    await loadFollows();
  }
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
