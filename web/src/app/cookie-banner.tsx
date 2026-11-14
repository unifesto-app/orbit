"use client";

// Cookie consent, shown at the bottom until the visitor chooses. Not rendered on the server,
// so returning visitors never see it flash. The choice itself is an essential cookie (prefs.ts).
import { setConsent, usePrefs } from "./prefs";
import styles from "./cookie-banner.module.css";

export function CookieBanner() {
  const { consent } = usePrefs();
  if (consent !== null) return null; // "unknown" on the server, or already chosen

  return (
    <section className={styles.banner} aria-label="Cookies">
      <p className={styles.text}>
        We use essential cookies to keep the site working and you signed in. With your OK, we also remember your location so
        events near you come first.{" "}
        <a href="https://www.unifesto.app/cookies" className={styles.link}>Cookie policy</a>
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => setConsent("essential")}>
          Essential only
        </button>
        <button type="button" className={styles.primary} onClick={() => setConsent("all")}>
          Allow all
        </button>
      </div>
    </section>
  );
}
