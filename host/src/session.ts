// Who's signed in to this host app (each of the three signs in on its own), against the
// Orbit API with the shared client (@orbit/mobile/api). One Orbit account works in every app, but each app keeps its own
// session: its own refresh token and device id (host apps plan, "Why each app has its own session").
// - The refresh token, the device id, the App Attest key id (proof.ts) and the account as last read all live in the
//   Keychain (expo-secure-store), readable after the first unlock and never copied to a backup or another phone. A build
//   from before the module keeps them in memory only, so a sign-in lasts until the app closes.
// - The account shows at once from what's kept (when it still reads as an account) and is read again from GET /me at
//   launch.
// - The Keychain outlives deleting the app; iOS's settings (NSUserDefaults) don't. An install without this app's mark is a
//   new one, so it starts signed out, as the Orbit app does after a reinstall: the old session ends on the API too, and
//   the account's details go from the phone. The device id and App Attest key id stay.
// - No demo: Event Partner reads the API since plan F31 (L1), so the dev-only Punchline demo went with its mock.
import { type ApiError, type Device, Me } from '@orbit/contract';
import { API_URL, makeApi } from '@orbit/mobile/api';
import Constants from 'expo-constants';
import { useSyncExternalStore } from 'react';
import { Alert, Platform, Settings } from 'react-native';

import { thisApp } from './variant';

let secure: typeof import('expo-secure-store') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional: a static import throws on a build without it
  secure = require('expo-secure-store');
} catch {
  secure = null;
}
const KEYCHAIN = secure ? { keychainAccessible: secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } : {};
const REFRESH = 'orbit.refresh';
const DEVICE = 'orbit.device';
const ME = 'orbit.me';
const INSTALLED = 'orbit.installed'; // in iOS's settings, which go with the app
export const PICKED_HOST = 'orbit.launch.host'; // Event Partner's last picked host (src/launch/host.ts), gone on sign-out
export const REQUEST_DRAFT = 'orbit.launch.request'; // the Event Request not yet sent (src/app/request.tsx), gone on sign-out
export const PUSH_ASKED = 'orbit.pushAsked'; // this install had its one push ask (src/push.tsx); kept across sign-outs

// The Keychain, read once and then from memory; writes go one after another, in order, so a sign-out's delete never
// lands after the next sign-in's token. A read that fails (a launch before the first unlock) is signed out this time only.
const memory = new Map<string, string | null>();
let writes = Promise.resolve();
export const kept = {
  get(name: string): string | null {
    if (memory.has(name)) return memory.get(name)!;
    let v: string | null = null;
    try {
      v = secure?.getItem(name, KEYCHAIN) ?? null;
    } catch {
      return null; // not remembered, so the next read tries the Keychain again
    }
    memory.set(name, v);
    return v;
  },
  // `orDrop`: a write that fails deletes the key, so an older value can't come back at the next launch (the Event
  // Request's draft; this launch keeps the new one in memory).
  set(name: string, next: string | null, { orDrop = false } = {}) {
    memory.set(name, next);
    const store = secure;
    if (!store) return;
    writes = writes
      .then(() => (next ? store.setItemAsync(name, next, KEYCHAIN) : store.deleteItemAsync(name, KEYCHAIN)))
      .catch(() => (orDrop && next ? store.deleteItemAsync(name, KEYCHAIN) : undefined))
      .catch(() => {});
  },
};

// Signed in (with the account), or signed out.
export type Session = { me: Me } | null;
let current: Session = null; // read once the install is checked, below
const listeners = new Set<() => void>();
function set(next: Session) {
  current = next;
  kept.set(ME, next ? JSON.stringify(next.me) : null);
  if (!next) {
    kept.set(PICKED_HOST, null);
    kept.set(REQUEST_DRAFT, null);
  }
  for (const on of listeners) on();
}
function readKept(): Session {
  const me = kept.get(ME);
  if (!me || !kept.get(REFRESH)) return null;
  try {
    const parsed = Me.safeParse(JSON.parse(me));
    return parsed.success ? { me: parsed.data } : null;
  } catch {
    return null;
  }
}

const app = thisApp.word;
export const api = makeApi({
  base: API_URL,
  fetch,
  refreshToken: { get: () => kept.get(REFRESH), set: (t) => kept.set(REFRESH, t) },
  // "launch-ios/1.0.0": a host app, kept out of the people's counts in Galaxy's Analytics.
  client: `${app}-${Platform.OS}/${Constants.expoConfig?.version ?? '0.0.0'}`,
  onEnded: (why: ApiError) => {
    set(null);
    if (why.error === 'suspended') Alert.alert('Signed out', why.message);
  },
});

if (Platform.OS === 'ios' && Settings.get(INSTALLED) !== 1) {
  if (kept.get(REFRESH)) api.signOut(); // the API hears with the old token; the Keychain's copy goes
  kept.set(ME, null);
  kept.set(REQUEST_DRAFT, null); // the last install's unsent Event Request goes with its account
  kept.set(PUSH_ASKED, null); // a new install asks once again
  Settings.set({ [INSTALLED]: 1 });
}
current = readKept();

// The account signed in now, outside React (the inbox store drops what's for someone else).
export const signedInId = () => current?.me.id;

export function useSession(): Session {
  return useSyncExternalStore(
    (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
    () => current,
  );
}

// This phone, as the API knows it: the id it gave this app's first sign-in, kept across sign-outs, so a later phone code
// doesn't ask "Is this you?" again. Named for the app, so Sign-in and security lists "Event Partner · iPhone".
export function thisDevice(): Device {
  const id = kept.get(DEVICE);
  const phone = Constants.deviceName?.trim() || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
  const name = `${thisApp.label} · ${phone}`;
  return { ...(id && { id }), name: name.slice(0, 100), client: 'app' };
}

// The sign-in's last step: keep the device id and the tokens, and show the account.
export function signIn(done: { access: string; refresh: string; expiresIn: number; device: string; me: Me }) {
  kept.set(DEVICE, done.device);
  api.start(done);
  set({ me: done.me });
}

// The account as the API has it now (a role accepted, a name changed elsewhere). At launch, and after an invite.
export async function refreshMe() {
  if (!current) return;
  const r = await api.authed<Me>('GET', '/me');
  if (r.ok && current && current.me.id === r.data.id) set({ me: r.data });
}

export function signOut() {
  if (current) api.signOut();
  set(null);
}
