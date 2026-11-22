// The waitlist (owner, 18 Nov 2026: "keep everything in landing page and collect interests"), at /waitlist since the
// homepage took / (owner, 22 Nov 2026: "lets move the waitlist from homepage"): the line, the symbols in orbit, and the
// form. Copy is the brand kit's own.
import { FEATURES } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { API_URL } from "../api";
import { deepType, Defs, Orbits, Wordmark } from "../brand";
import { Foot } from "../foot";
import { FIT, OPEN_GRAPH, WAITLIST_DESCRIPTION, X_HANDLE } from "../site";
import styles from "../site.module.css";
import { Waitlist } from "./form";

export const metadata: Metadata = {
  title: "Join the waitlist",
  description: WAITLIST_DESCRIPTION,
  alternates: { canonical: "/waitlist" },
  openGraph: { ...OPEN_GRAPH, url: "/waitlist", title: "Join the waitlist · Orbit", description: WAITLIST_DESCRIPTION },
  twitter: { card: "summary_large_image", site: X_HANDLE, title: "Join the waitlist · Orbit", description: WAITLIST_DESCRIPTION },
};

export default function WaitlistPage() {
  return (
    <main className={styles.page}>
      <Defs />
      <header className={styles.bar}>
        <Link href="/" aria-label="Orbit home">
          <Wordmark className={styles.wordmark} />
        </Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.copy}>
          <Orbits className={styles.art} />
          <h1 className={styles.line}>
            There’s more to life{" "}
            <span className={styles.deep} style={{ backgroundImage: deepType }}>
              beyond the usual.
            </span>
          </h1>
        </div>
        <div className={styles.panel}>
          {/* The form's own height, held while it streams in, so nothing below it moves. */}
          <Suspense fallback={<div className={styles.formSpace} />}>
            <Form />
          </Suspense>
          <Suspense fallback={<p className={styles.count} />}>
            <Count />
          </Suspense>
        </div>
        {/* Who it's for, so the right people see themselves and the rest pass (owner, 19 Nov 2026).
            After the form on a phone (owner: "Form first on phone"), under the line on a laptop. */}
        <section className={styles.fit} aria-labelledby="fit">
          <h2 id="fit" className={styles.title}>
            You’ll probably love Orbit if…
          </h2>
          <ul>
            {FIT.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>If the usual is enough for you, Orbit probably isn’t. That’s fine too.</p>
        </section>
      </section>

      <Foot className={styles.foot} />
    </main>
  );
}


// TURNSTILE_SITE_KEY (web.env) is read when the page is asked for, as on Galaxy's login, so one build serves any key.
async function Form() {
  await connection();
  return <Waitlist features={Object.entries(FEATURES)} turnstile={process.env.TURNSTILE_SITE_KEY} />;
}

// How many are on the waitlist, read on each visit, never at build time; nothing shows if it can't be read, or before
// anyone has joined.
async function Count() {
  await connection();
  const r: { count?: unknown } | null = await fetch(`${API_URL}/public/interest`, { signal: AbortSignal.timeout(3000) })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  const n = typeof r?.count === "number" ? r.count : 0;
  return <p className={styles.count}>{n > 0 && `${n.toLocaleString("en-IN")} ${n === 1 ? "person" : "people"} on the waitlist`}</p>;
}
