"use client";

// The navbar location: the browser's position, reverse-geocoded to "area, city".
// Asks only when tapped; on load it looks silently only if permission was already granted
// (same as the old site's detectCity). Saved through prefs.ts, which respects cookie consent.
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import styles from "./location-button.module.css";
import { type Place, setPlace, usePrefs } from "./prefs";

type Status = "idle" | "locating" | "blocked" | "failed";

// Coordinates are rounded to about 100 m before leaving the browser; that still names the area.
async function locate(): Promise<Place> {
  const { latitude, longitude } = await new Promise<GeolocationCoordinates>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), reject, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 600_000,
    }),
  );
  // Google (via /api/locate) names neighbourhoods like Maisammaguda; BigDataCloud stops at the mandal.
  // /api/locate answers 501 until GOOGLE_MAPS_API_KEY is set, and any failure falls back too.
  try {
    const res = await fetch(`/api/locate?lat=${latitude.toFixed(3)}&lng=${longitude.toFixed(3)}`);
    if (res.ok) return await res.json();
  } catch {}
  return fromBigDataCloud(latitude, longitude);
}

// BigDataCloud's free reverse geocoding may only be called from the visitor's browser.
async function fromBigDataCloud(latitude: number, longitude: number): Promise<Place> {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", latitude.toFixed(3));
  url.searchParams.set("longitude", longitude.toFixed(3));
  url.searchParams.set("localityLanguage", "en");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`reverse geocode ${res.status}`);
  const data: { locality?: string; city?: string; principalSubdivision?: string } = await res.json();
  const city = data.city || data.principalSubdivision || "";
  const area = data.locality || city;
  if (!area) throw new Error("no place name");
  return { area, city: city === area ? "" : city };
}

const isBlocked = (e: unknown) => e instanceof GeolocationPositionError && e.code === e.PERMISSION_DENIED;

export function LocationButton() {
  const { place } = usePrefs();
  const [status, setStatus] = useState<Status>("idle");

  async function run() {
    setStatus("locating");
    try {
      setPlace(await locate());
      setStatus("idle");
    } catch (e) {
      setStatus(isBlocked(e) ? "blocked" : "failed");
    }
  }

  // Already allowed on an earlier visit: refresh quietly, without a prompt.
  useEffect(() => {
    if (place || !navigator.geolocation || !navigator.permissions) return;
    let live = true;
    navigator.permissions.query({ name: "geolocation" }).then(
      (p) => {
        if (live && p.state === "granted") locate().then(setPlace, () => {});
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [place]);

  const label =
    status === "locating" ? "Locating…"
    : status === "blocked" ? "Location blocked"
    : status === "failed" && !place ? "Try again"
    : place ? place.area
    : "Set location";

  const hint =
    status === "blocked" ? "Location is blocked for this site. Allow it in your browser settings, then tap again."
    : place ? `Showing events near ${[place.area, place.sub, place.city].filter(Boolean).join(", ")}. Tap to update.`
    : "Use my location to show events near me";

  return (
    <button type="button" className={styles.loc} onClick={run} disabled={status === "locating"} title={hint} aria-label={hint}>
      <Icon name="pin" size={18} className={styles.pin} />
      <span className={styles.label}>
        {label}
        {/* Desktop shows "Maisammaguda, Bhadurpalle, Hyderabad" like other apps; phones show the area only. */}
        {place && status === "idle" && (place.sub || place.city) && (
          <span className={styles.city}>, {[place.sub, place.city].filter(Boolean).join(", ")}</span>
        )}
      </span>
    </button>
  );
}
