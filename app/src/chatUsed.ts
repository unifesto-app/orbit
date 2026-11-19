// Whether this phone has used the chat: sent a message or a suggestion (owner, 19 Nov 2026: "make the bubble disappear
// after chat is used once"). The bubble over the tab bar's orb (src/app/(tabs)/_layout.tsx) stops for good once it has.
// Saved on the phone and read back synchronously at launch, as the place is (src/place.ts).
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

const KEY = 'orbit.chatUsed';

function saved(): boolean {
  try {
    return Storage.getItemSync(KEY) === '1';
  } catch {
    return false; // unreadable: as if not used, so the bubble shows
  }
}

let used = saved();
const listeners = new Set<() => void>();

export function markChatUsed() {
  if (used) return;
  used = true;
  for (const fn of listeners) fn();
  try {
    Storage.setItemSync(KEY, '1');
  } catch {
    // Not saved this time: the bubble stays away until the app closes.
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useChatUsed = () => useSyncExternalStore(subscribe, () => used);
