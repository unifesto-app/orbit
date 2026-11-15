// The viewer's location, the place Home shows events near. Chosen on the location screen (src/app/location.tsx) from
// the city list in @orbit/contract or the phone's position, the way the web's navbar picker works
// (web/src/app/location-button.tsx).
// ponytail: kept in memory, so it resets on relaunch; save it once the app keeps preferences on the phone.
import { useSyncExternalStore } from 'react';

import type { Place } from './home/layout';

let chosen: Place | undefined;
const listeners = new Set<() => void>();

export function setPlace(place: Place) {
  chosen = place;
  for (const fn of listeners) fn();
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

// The fields of expo-location's LocationGeocodedAddress this reads.
export type Address = { district: string | null; city: string | null; subregion: string | null; region: string | null };

// What the phone's geocoder calls a spot, as Home's two lines: the neighbourhood over its city ("Gachibowli",
// "Hyderabad"). With no neighbourhood the city leads over its state, the same shape as a picked city. Never the same
// name twice: "Hyderabad, Hyderabad" reads as a bug (the web's rule too).
export function placeName(a: Address): { area: string; city: string } | null {
  const city = a.city || a.subregion || '';
  const area = a.district || city;
  if (!area) return null;
  return { area, city: [city, a.region].find((name) => name && name !== area) ?? '' };
}
