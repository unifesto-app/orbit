"use client";

// A small card at the bottom left on desktop with a QR code for the app (public/app-qr.svg,
// which encodes heyorbit.in/app: iPhone to the App Store, Android to Google Play).
// Waits until the cookie banner is answered so the two never stack; closing it is remembered.
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import styles from "./app-card.module.css";
import { usePrefs } from "./prefs";

const KEY = "orbit_app_card"; // per-browser convenience, so localStorage rather than a cookie

function readDismissed() {
  try {
    return localStorage.getItem(KEY) === "closed";
  } catch {
    return false; // storage blocked: show it, closing still works for this page view
  }
}

export function AppCard() {
  const { consent } = usePrefs();
  const stored = useSyncExternalStore(() => () => {}, readDismissed, () => true);
  const [closed, setClosed] = useState(false);
  // The footer has its own QR, and the card would cover it: step aside while the footer is on screen.
  const [footerInView, setFooterInView] = useState(false);
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer) return;
    const io = new IntersectionObserver(([entry]) => setFooterInView(entry.isIntersecting));
    io.observe(footer);
    return () => io.disconnect();
  }, []);
  if (consent === null || consent === "unknown" || stored || closed) return null;

  function close() {
    setClosed(true);
    try {
      localStorage.setItem(KEY, "closed");
    } catch {}
  }

  return (
    <aside className={`${styles.card} ${footerInView ? styles.away : ""}`} aria-label="Get the Orbit app" aria-hidden={footerInView}>
      <button type="button" className={styles.close} onClick={close} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <span className={styles.qr}>
        <Image src="/app-qr.svg" alt="QR code linking to the Orbit app" width={104} height={104} />
      </span>
      <span className={styles.text}>
        <strong className={styles.title}>Explore the app</strong>
        <span className={styles.meta}>Scan to get Orbit on Android or iOS</span>
      </span>
    </aside>
  );
}
