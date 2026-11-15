// Signed in or signed out on this phone (User flow doc, settled 15 Nov 2026). A fresh install starts signed out, and
// browsing Home, Search, events and hosts never asks. Saving, following, booking and anything of your own ask through
// the sign-in sheet (src/app/login.tsx), then finish what was tapped ("come back to where you were").
// Saved on the phone and read back synchronously at launch, the way the location is (src/place.ts), so the first frame
// is already right.
// ponytail: no API yet, so a session is a flag plus the saved events and followed hosts, and every sign-in opens the
// one mock account (src/account/data.ts, src/mock.ts `viewer`, src/modes.ts `me`). The seam for real auth is signIn
// and signOut: they'll hold the API's refresh token in the Keychain (expo-secure-store, a native module, so a rebuild)
// and fetch the account instead of seeding the mock.
import { router } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { saved as savedMock } from './account/data';
import type { Way } from './account/rules';
import type { Viewer } from './home/layout';
import { viewer } from './mock';
import { me, nobody } from './modes';

const KEY = 'orbit.session';

export type Session = { via: Way; saved: readonly string[]; follows: readonly string[] };

function stored(): Session | null {
  try {
    const s = JSON.parse(Storage.getItemSync(KEY) ?? 'null');
    return typeof s?.via === 'string' && Array.isArray(s.saved) && Array.isArray(s.follows) ? s : null;
  } catch {
    return null; // unreadable: signed out
  }
}

let current = stored();
const listeners = new Set<() => void>();

function set(next: Session | null) {
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

// Who Home and the pages draw for: the mock viewer once signed in, with the follows made here; signed out, only the
// place, which never needs an account.
export function useViewer(): Viewer {
  const s = useSession();
  return s ? { ...viewer, signedIn: true, follows: s.follows } : { signedIn: false, follows: [], place: viewer.place };
}
// Roles for the mode switcher and the Console and Galaxy guards: none while signed out, so Home only.
export const useMe = () => (useSession() ? me : nobody);

export const useSaved = (eventId: string) => useSession()?.saved.includes(eventId) ?? false;
export const useFollowing = (hostId: string) => useSession()?.follows.includes(hostId) ?? false;

const turn = (list: readonly string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
// `on` is what the tap asked for, never a toggle, so a save tapped while signed out still saves when the account
// already had it.
export const setSaved = (eventId: string, on: boolean) => current && set({ ...current, saved: turn(current.saved, eventId, on) });
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

export const signIn = (via: Way) => set({ via, saved: savedMock, follows: viewer.follows });

// Log out, and Delete account, which signs out every device (User doc).
export const signOut = () => set(null);
