import type { Metadata } from "next";
import Link from "next/link";
import styles from "./not-found.module.css";

// The root not-found ships with every route, so it stays a Server Component with no client JS.
export const metadata: Metadata = { title: "Page not found · Orbit" };

export default function NotFound() {
  return (
    <main className={styles.wrap}>
      <div className={styles.orbit} aria-hidden="true">
        <span className={styles.ring}><span className={styles.dot} /></span>
        <span className={styles.code}>404</span>
      </div>
      <h1 className={styles.title}>This page is out of orbit</h1>
      <p className={styles.text}>The link may be old or mistyped, or the event may have ended.</p>
      <Link href="/" className="button">Back to Discover</Link>
    </main>
  );
}
