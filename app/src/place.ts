// The viewer's location, the place Home shows events near. Chosen on the location screen (src/app/location.tsx) from
// the city list in @orbit/contract or the phone's position, the way the web's navbar picker works
// (web/src/app/location-button.tsx).
// Saved on the phone (owner, 15 Nov 2026: "save the location to the phone") and read back synchronously when the app
// starts, so Home never shows another place first. Unlike the web's cookie it needs no consent: it stays on the phone.
// A saved place wins over the mock viewer's, so the "no location" preview in src/mock.ts shows only on a fresh install.
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { type Place, placeName } from './home/layout';
import { nearAreasFor } from './mock';

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

// Location isn't allowed for Orbit (or, with `ask: false`, not allowed yet).
export class Blocked extends Error {}

const within = <T,>(ms: number, work: Promise<T>) =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);

// The phone's position, named by the phone's own geocoder (Apple's or Google's: no key, no server), rounded to about
// 100 m first as on the web. A position from the last 10 minutes will do; a fresh one gets 10 seconds, so "Locating…"
// can't stick. `ask: false` never shows the permission prompt. expo-location loads only when asked, so Home still runs
// on a build made before it was added.
export async function locate({ ask = true } = {}) {
  const Location = await import('expo-location');
  let permission = await Location.getForegroundPermissionsAsync();
  if (ask && !permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Blocked();
  const position =
    (await Location.getLastKnownPositionAsync({ maxAge: 600_000 })) ??
    (await within(10_000, Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })));
  const { latitude, longitude } = position.coords;
  const [address] = await Location.reverseGeocodeAsync({ latitude: +latitude.toFixed(3), longitude: +longitude.toFixed(3) });
  const name = address && placeName(address);
  if (!name) throw new Error('no place name');
  return name;
}

// The quiet refresh (the web's, once a launch here instead of once a visit; owner, 15 Nov 2026: "add the quiet location
// refresh on launch"): if location is already allowed, look the phone up again, so a found place that went stale (an
// old neighbourhood, a move across town) doesn't stick. A city the viewer picked is left alone, nothing ever asks for
// permission, and any failure keeps the place as it was.
let refreshed = false;
const picked = () => chosen?.source === 'pick'; // read fresh: it can change while the lookup runs
export async function refreshPlace() {
  if (refreshed || picked()) return;
  refreshed = true;
  try {
    const name = await locate({ ask: false });
    // A city picked while this ran wins.
    if (!picked()) setPlace({ ...name, source: 'gps', nearAreas: nearAreasFor(name) });
  } catch {
    // Not allowed, no fix or no name: keep what's there.
  }
}
