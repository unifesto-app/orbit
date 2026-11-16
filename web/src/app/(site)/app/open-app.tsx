"use client";

// heyorbit.in/app opens the Orbit app through its scheme, heyorbit:// (app/app.json).
// No store fallback, by the owner's call. The desktop QR card points here.
import { useEffect, useSyncExternalStore } from "react";
import styles from "./page.module.css";

const SCHEME = "heyorbit://";

const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export function OpenApp() {
  const phone = useSyncExternalStore(() => () => {}, isPhone, () => false);

  useEffect(() => {
    if (phone) location.href = SCHEME;
  }, [phone]);

  return phone ? (
    <a href={SCHEME} className={`button ${styles.wide}`}>Open the app</a>
  ) : null;
}
