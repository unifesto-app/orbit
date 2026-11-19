// What Orbit itself puts in the app (ad strips, Help answers, Ask Orbit chips, the carousel's featured slides and the
// events marked Promoted), from Galaxy's App content (GET /public/app-content; contract/src/content.ts). Until it
// answers, and offline, the bundled Help answers and chips, and no ads, featured slides or promotions: one staff took
// down must never show, even for a moment at launch, so Home's carousel settles once the answer lands. Read when a
// screen first wants it and again each time the app comes back to the front, at most once a minute after a good answer
// (the API's own cache is a minute too). Every start and end is checked against the phone's clock: the store wakes at
// the next one, and on coming back to the front, so things come and go on time even on a screen left open.
// ponytail: held in memory only, so a launch offline shows none of staff's picks and the bundled words; keep a copy on
// the phone if staff start changing them often.
import { type AdPlace, type AppContent, adsFor, DEFAULT_CONTENT, liveAt, nextChange, promotedAt, readContent, timed } from '@orbit/contract';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { api } from './session';

const MINUTE = 60_000;
const LONGEST = 2 ** 31 - 1; // setTimeout's longest wait, about 24 days
// What screens draw from, and the clock it was taken at; a new object only when either changes.
let snap: { content: AppContent; now: number } = { content: { ...DEFAULT_CONTENT, ads: [], featured: [], promoted: [] }, now: Date.now() };
let asked = 0;
let wake: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function publish(content = snap.content) {
  const now = Date.now();
  snap = { content, now };
  clearTimeout(wake);
  const next = nextChange(timed(content), now);
  if (next < Infinity) wake = setTimeout(() => publish(), Math.min(next - now + 50, LONGEST));
  listeners.forEach((l) => l());
}

function refresh() {
  if (Date.now() - asked < MINUTE) return;
  asked = Date.now();
  void api.call<unknown>('GET', '/public/app-content').then((r) => {
    if (!r.ok) {
      asked = 0; // a dead spot at launch: the next screen or return to the front asks again
      return;
    }
    publish(readContent(r.data)); // a list that doesn't read stays its default
  });
}

// Back at the front: the clock may have passed a start or end while timers slept, and staff may have saved since.
AppState.addEventListener('change', (s) => {
  if (s !== 'active' || listeners.size === 0) return;
  publish();
  refresh();
});

function subscribe(l: () => void) {
  listeners.add(l);
  refresh();
  return () => void listeners.delete(l);
}

const useSnap = () => useSyncExternalStore(subscribe, () => snap);
export const useContent = () => useSnap().content;
/** The live ads a screen shows (adsFor), redrawn when one starts or ends. */
export function useAds(place: AdPlace) {
  const { content, now } = useSnap();
  return adsFor(content.ads, place, now);
}
/** The ids of the events marked Promoted now. */
export function usePromoted() {
  const { content, now } = useSnap();
  return promotedAt(content.promoted, now);
}
/** The carousel's live featured slides, in staff's order (planHome places them). */
export function useFeatured() {
  const { content, now } = useSnap();
  return content.featured.filter((s) => liveAt(s, now));
}
