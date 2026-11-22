"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";

// The site's own visit log (contract visit.ts; owner, 19 Nov 2026: "website and pages analytics in galaxy web", "Our
// own visit log"): a view when a page opens, "start" when the waitlist form is first touched, and on leaving (each time
// the page is hidden) the time it was visible and its Core Web Vitals. No cookies. Sent to this site's own /v, which
// passes them on to the API; a send that fails is dropped, never the page.

let view: string | undefined; // the page view now open
let started = false;
const vitals: { lcp?: number; inp?: number; ttfb?: number; cls?: number } = {};

// What the page itself can tell about the visit: where it came from, the link's utm_ tags, the time zone, language and
// screen. Also sent with a join (waitlist/form.tsx).
// A link's utm_ tags, kept for the rest of the visit: shared links land on the homepage, and the waitlist a click later
// has none of its own. (The referrer needs no keeping: moves within the site leave document.referrer as it was.)
let landingUtm: Record<string, string> | undefined;

export function pageFacts() {
  const own = Object.fromEntries([...new URLSearchParams(location.search)].filter(([k]) => k.startsWith("utm_")).slice(0, 10).map(([k, v]) => [k.slice(0, 40), v.slice(0, 200)]));
  const utm = Object.keys(own).length ? own : landingUtm;
  landingUtm ??= utm;
  return {
    referrer: document.referrer.slice(0, 1000) || undefined,
    utm,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64),
    language: navigator.language?.slice(0, 35),
    screen: `${screen.width}x${screen.height}@${Math.round(devicePixelRatio * 100) / 100}`.slice(0, 20),
  };
}

function send(hit: object) {
  try {
    const body = JSON.stringify(hit);
    if (!navigator.sendBeacon?.("/v", body)) void fetch("/v", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {}
}

// The view the waitlist form sits on, for the API to mark "got a code" and "joined" (web actions.ts).
export const viewId = () => view;

// The first touch of the waitlist form on this view.
export function formStarted() {
  if (started || !view) return;
  started = true;
  send({ kind: "start", id: view });
}

// Kept for the leave hit; a stable function, so Next reports each metric once. Held inside the API's limits, so one odd
// reading can't lose the whole hit.
function report(m: { name: string; value: number }) {
  if (m.name === "CLS") vitals.cls = Math.min(Math.round(m.value * 1000) / 1000, 100);
  else if (m.name === "LCP" || m.name === "INP" || m.name === "TTFB") vitals[m.name.toLowerCase() as "lcp" | "inp" | "ttfb"] = Math.min(Math.round(m.value), 120_000);
}

export function Visit() {
  useReportWebVitals(report);
  const path = usePathname(); // a new view for each page, moves within the site included
  useEffect(() => {
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
    if (!id) return;
    view = id;
    started = false;
    let visible = 0;
    let since = document.visibilityState === "visible" ? performance.now() : 0;
    send({ kind: "view", id, path: path.startsWith("/careers/") ? "/careers/[slug]" : path, ...pageFacts() });
    const leave = () => {
      if (since) visible += performance.now() - since;
      since = 0;
      send({ kind: "leave", id, ms: Math.min(Math.round(visible), 6 * 3600_000), ...vitals });
    };
    const onChange = () => (document.visibilityState === "hidden" ? leave() : (since = performance.now()));
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("pagehide", leave); // some in-app browsers close without hiding first; the API keeps the largest
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("pagehide", leave);
      leave();
      for (const k of Object.keys(vitals) as (keyof typeof vitals)[]) delete vitals[k];
    };
  }, [path]);
  return null;
}
