// The viewer's location, the place Home shows events near. Chosen on the location screen (src/app/location.tsx) from
// the city list in @orbit/contract or the phone's position, the way the web's navbar picker works
// (web/src/app/location-button.tsx).
// Saved on the phone (owner, 15 Nov 2026: "save the location to the phone") and read back synchronously when the app
// starts, so Home never shows another place first. Unlike the web's cookie it needs no consent: it stays on the phone.
// A saved place wins over the mock viewer's, so the "no location" preview in src/mock.ts shows only on a fresh install.
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import type { Place } from './home/layout';

const KEY = 'orbit.place';

// The place an earlier launch saved, if it still reads as one.
function saved(): Place | undefined {
  try {
    const p = JSON.parse(Storage.getItemSync(KEY) ?? 'null');
    return typeof p?.area === 'string' && typeof p.city === 'string' && Array.isArray(p.nearAreas) ? p : undefined;
  } catch {
    return undefined; // unreadable: as if none was saved
  }
}

let chosen = saved();
const listeners = new Set<() => void>();

export function setPlace(place: Place) {
  chosen = place;
  for (const fn of listeners) fn();
  try {
    Storage.setItemSync(KEY, JSON.stringify(place));
  } catch {
    // Not saved this time: Home still shows it until the app closes.
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// The chosen place, else `fallback`: the mock viewer's, so the preview states in src/mock.ts still show.
export function usePlace(fallback: Place | null): Place | null {
  return useSyncExternalStore(subscribe, () => chosen) ?? fallback;
}
