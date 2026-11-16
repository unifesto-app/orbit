// Signed in or signed out on this phone (User flow doc, settled 15 Nov 2026). A fresh install starts signed out, and
// browsing Home, Search, events and hosts never asks. Saving, following, booking and anything of your own ask through
// the sign-in sheet (src/app/login.tsx), then finish what was tapped ("come back to where you were").
// The account comes from the Orbit API (src/api.ts). What the first frame needs (signed in, the account and its roles)
// is saved on the phone and read back synchronously at launch, the way the location is (src/place.ts); the refresh
// token is kept in the Keychain, and the access token only in memory.
// ponytail: saved events, saved lists and followed hosts stay on this phone, seeded from the mock (src/account/data.ts,
// src/mock.ts), until the API has them.
import type { AuthStep, Me as Account } from '@orbit/contract';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { Alert, Platform } from 'react-native';

import { lists as listsMock, saved as savedMock } from './account/data';
import type { Way } from './account/rules';
import * as saves from './account/saves';
import { API_URL, makeApi } from './api';
import type { Viewer } from './home/layout';
import { events, viewer } from './mock';
import { type Me, nobody } from './modes';
import { hideNote, showNote } from './note';

const KEY = 'orbit.session';
const DEVICE = 'orbit.device';
const REFRESH = 'orbit.refresh';

// Saved events and lists (src/account/saves.ts) ride along: each save with when it was made, and the lists.
export type Session = { via: Way; follows: readonly string[]; me: Account } & saves.Saves;

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
    if (ok && refreshToken.get()) return { ...s, ...saves.normalise(s, Date.now()) }; // one stored before lists keeps its saves
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

// Who Home and the pages draw for: once signed in, the account's initial, the follows made here and the rest of the
// mock viewer; signed out, only the place, which never needs an account.
export function useViewer(): Viewer {
  const s = useSession();
  const initial = s?.me.name?.trim()[0]?.toUpperCase();
  return s ? { ...viewer, signedIn: true, follows: s.follows, ...(initial && { initial }) } : { signedIn: false, follows: [], place: viewer.place };
}
// Roles for the mode switcher and the Console and Galaxy guards, from the API: none while signed out, so Home only.
export const useMe = (): Me => useSession()?.me ?? nobody;

export const useSaved = (eventId: string) => useSession()?.saved.some((x) => x.id === eventId) ?? false;
export const useFollowing = (hostId: string) => useSession()?.follows.includes(hostId) ?? false;

const turn = (list: readonly string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
export const setFollowing = (hostId: string, on: boolean) => current && set({ ...current, follows: turn(current.follows, hostId, on) });

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
export const canOpen = (id: string) => events.some((e) => e.id === id);

// Applies a change to the saves: null once done, or the problem to show ("You have 1,000 saved…").
function apply(change: (s: saves.Saves) => saves.Saves | string): string | null {
  if (!current) return null;
  const next = change(current);
  if (typeof next === 'string') return next;
  set({ ...current, ...next });
  return null;
}
const saveEvent = (eventId: string) => apply((s) => saves.save(s, eventId, Date.now(), canOpen));

// The heart (owner, 16 Nov 2026: "instead of toast use modal, when clicked on love"): an empty heart saves at once and
// opens the list modal over the page (src/app/lists/[event].tsx); a saved one opens it too, where Remove from saved
// unsaves. `on` is what the tap asked for, never a toggle, so a save tapped while signed out still saves when the
// account already had it. Signed out, the sign-in sheet comes first and the save lands after; no modal then, as the
// sheet is still leaving and one opened over it goes astray. The heart turning red says it's saved.
// ponytail: at the cap the heart doesn't fill first and roll back (doc); it stays empty and an alert says why. The
// API's answer makes it a real roll-back. The push ask on an event not on sale yet waits for notifications.
export function tapHeart(eventId: string, on: boolean, fromMenu = false) {
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
// Add to a list, from an event's menu or a saved row's: the heart's modal, saving first if it isn't.
export const addToList = (eventId: string) => tapHeart(eventId, true, true);

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
  set({ via, ...kept, follows: current?.follows ?? viewer.follows, me: done.me });
}

// The account as the API has it now (a name, a role or a deletion changed elsewhere). Once at launch.
export async function refreshAccount() {
  if (!current) return;
  const r = await api.authed<Account>('GET', '/me');
  if (r.ok && current?.me.id === r.data.id) set({ ...current, me: r.data });
}
export const setAccount = (me: Account) => current?.me.id === me.id && set({ ...current, me });

// Keep my account (User doc, Account deletion): signing in within the 30 days stops the deletion. Answers the API's
// message when it said no, or null.
export async function keepAccount() {
  const r = await api.authed('POST', '/me/deletion/keep');
  if (r.ok || r.error.error === 'notPending') await refreshAccount();
  return r.ok ? null : r.error.message;
}

// Log out, and Delete account, which signs out every device (User doc). The API is told without waiting.
export function signOut() {
  api.signOut();
  set(null);
}
