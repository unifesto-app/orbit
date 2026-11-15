"use client";

// The navbar location. Tapping it opens a city picker: search, "Use my current location" (the browser's
// position, named by Google via /api/locate), Popular cities, then all cities A to Z. On load it looks silently only if
// permission was already granted (same as the old site's detectCity). Saved through prefs.ts,
// which respects cookie consent.
import { useEffect, useId, useRef, useState } from "react";
import { allCities, type City, popularCities, searchCities } from "@orbit/contract";
import { Icon } from "./icons";
import styles from "./location-button.module.css";
import { type Place, setPlace, usePrefs } from "./prefs";

type Status = "idle" | "locating" | "blocked" | "failed";

const REFRESHED = "orbit_location_refreshed"; // sessionStorage: the quiet refresh ran this visit

// All cities A to Z, grouped under their first letter (the list itself is cities.ts).
// A plain loop, not Object.groupBy: that needs Safari 17.4, and older iPhones are common in India.
const byLetter = new Map<string, City[]>();
for (const c of allCities) {
  const letter = c.name[0].toUpperCase();
  byLetter.set(letter, [...(byLetter.get(letter) ?? []), c]);
}

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggle = useRef<HTMLButtonElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const results = searchCities(query);

  // Opening the menu puts the cursor in its search box, with a mouse or trackpad only: on a phone the
  // keyboard would pop up over the Popular cities.
  useEffect(() => {
    if (open && matchMedia("(pointer: fine)").matches) searchBox.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  async function run() {
    close();
    setStatus("locating");
    try {
      setPlace(await locate());
      setStatus("idle");
    } catch (e) {
      setStatus(isBlocked(e) ? "blocked" : "failed");
    }
  }

  function choose(c: City) {
    setPlace({ area: c.name, sub: "", city: c.state, source: "pick" });
    setStatus("idle");
    close();
    toggle.current?.focus();
  }

  const isChosen = (c: City) => place?.source === "pick" && place.area === c.name && place.city === c.state;

  // One row of the A to Z list or of the search results: the city, its state, a check if chosen.
  const row = (c: City) => (
    <li key={`${c.name}|${c.state}`}>
      <button type="button" className={styles.row} aria-pressed={isChosen(c)} onClick={() => choose(c)}>
        <span className={styles.rowName}>{c.name}</span>
        <span className={styles.rowState}>{c.state}</span>
        {isChosen(c) && <Icon name="check" size={16} className={styles.pin} />}
      </button>
    </li>
  );

  // Already allowed on an earlier visit: refresh a detected location quietly, once per visit, so a
  // stale one (an old fallback like "Medchal", or a move across town) doesn't stick. A city the
  // visitor picked is left alone.
  const pickedCity = place?.source === "pick";
  useEffect(() => {
    if (pickedCity || !navigator.geolocation || !navigator.permissions) return;
    try {
      if (sessionStorage.getItem(REFRESHED)) return;
      sessionStorage.setItem(REFRESHED, "1");
    } catch {
      // Storage blocked: refresh anyway; the worst case is one lookup per page load.
    }
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
  }, [pickedCity]);

  const label =
    status === "locating" ? "Locating…"
    : status === "blocked" ? "Location blocked"
    : status === "failed" && !place ? "Try again"
    : place ? place.area
    : "Location";

  const hint = place
    ? `Showing events near ${[place.area, place.sub, place.city].filter(Boolean).join(", ")}. Change location.`
    : "Choose your location";

  return (
    <div
      className={styles.wrap}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault(); // a search input would also clear itself
          close();
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        className={styles.loc}
        onClick={() => (open ? close() : setOpen(true))}
        disabled={status === "locating"}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={hint}
        title={hint}
      >
        <Icon name="pin" size={18} className={styles.pin} />
        {/* Two lines, like the approved home board: the area on top, the rest small underneath. */}
        <span className={styles.label}>
          <span className={styles.area}>{label}</span>
          {place && status === "idle" && (place.sub || place.city) && (
            <span className={styles.rest}>{[place.sub, place.city].filter(Boolean).join(", ")}</span>
          )}
        </span>
        <Icon name="caret" size={14} className={styles.caret} />
      </button>

      {open && (
        <div id={menuId} className={styles.menu} role="group" aria-label="Choose your location">
          <label className={styles.find}>
            <Icon name="search" size={16} />
            <span className="sr-only">Search for your city</span>
            <input
              ref={searchBox}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) {
                  e.preventDefault();
                  choose(results[0]);
                }
              }}
              placeholder="Search for your city"
              autoComplete="off"
              maxLength={60}
            />
          </label>

          <button type="button" className={styles.current} onClick={run}>
            <Icon name="locate" size={20} className={styles.pin} />
            <span>
              <strong>Use my current location</strong>
              {status === "blocked" && <span className={styles.note}>Blocked for this site. Allow it in your browser settings.</span>}
            </span>
          </button>

          {/* Only the cities scroll; the search and current location stay put above them. */}
          <div className={styles.body}>
            {query.trim() ? (
              results.length > 0 ? (
                <ul className={styles.list} aria-label="Matching cities">{results.slice(0, 50).map(row)}</ul>
              ) : (
                <p className={styles.empty}>No city matches “{query.trim()}”.</p>
              )
            ) : (
              <>
                <p className={styles.heading}>Popular cities</p>
                <ul className={styles.popular}>
                  {popularCities.map((c) => (
                    <li key={c.name}>
                      <button type="button" className={styles.chip} aria-pressed={isChosen(c)} onClick={() => choose(c)}>
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className={styles.heading}>All cities</p>
                {[...byLetter].map(([letter, list]) => (
                  <section key={letter} aria-label={`Cities starting with ${letter}`}>
                    <p className={styles.letter} aria-hidden="true">{letter}</p>
                    <ul className={styles.list}>{list.map(row)}</ul>
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
