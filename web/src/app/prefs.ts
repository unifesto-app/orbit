// Visitor preferences kept in cookies: the cookie-consent choice and the saved location.
// The location is only written to a cookie after "Allow all"; otherwise it lives in memory
// for this visit. Client-only: read with useSyncExternalStore (see usePrefs).
import { useSyncExternalStore } from "react";

export type Consent = "all" | "essential";
export type Place = { area: string; sub?: string; city: string };

const CONSENT = "orbit_consent"; // essential: it records the choice itself
const LOCATION = "orbit_location";
const DAY = 86_400;

const listeners = new Set<() => void>();
let sessionPlace = ""; // "area|city|sub" when consent is not "all"

function read(name: string): string {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

function write(name: string, value: string, maxAge: number) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

function changed() {
  for (const fn of listeners) fn();
}

export function setConsent(consent: Consent) {
  write(CONSENT, consent, 180 * DAY);
  if (consent === "all" && sessionPlace) write(LOCATION, sessionPlace, 30 * DAY);
  if (consent === "essential") write(LOCATION, "", 0); // forget any saved location
  changed();
}

export function setPlace({ area, sub = "", city }: Place) {
  const value = `${area}|${city}|${sub}`;
  if (read(CONSENT) === "all") write(LOCATION, value, 30 * DAY);
  else sessionPlace = value;
  changed();
}

// A string snapshot ("consent~area|city|sub") so React can compare it cheaply; parsed below.
const snapshot = () => `${read(CONSENT)}~${read(LOCATION) || sessionPlace}`;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// On the server and during hydration nothing is known yet: consent "unknown", no place.
export function usePrefs(): { consent: Consent | null | "unknown"; place: Place | null } {
  const snap = useSyncExternalStore(subscribe, snapshot, () => "unknown~");
  const [consent, placeRaw] = snap.split("~");
  const [area, city, sub] = placeRaw.split("|");
  return {
    consent: consent === "unknown" ? "unknown" : consent === "all" || consent === "essential" ? consent : null,
    place: area ? { area, sub: sub ?? "", city: city ?? "" } : null,
  };
}
