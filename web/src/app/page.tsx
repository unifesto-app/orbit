// The whole site until launch (owner, 18 Nov 2026: "before building anything, and wasting resources. keep everything in
// landing page and collect interests"): the line, the symbols in orbit, and the waitlist. Copy is the brand kit's own.
import { FEATURES } from "@orbit/contract";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { API_URL } from "./api";
import { deepType, Defs, Orbits, Wordmark } from "./brand";
import { DESCRIPTION, OPERATOR, SITE, SOCIAL } from "./site";
import styles from "./page.module.css";
import { Waitlist } from "./waitlist";

export default function Home() {
  return (
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LD) }} />
      <Defs />
      <header className={styles.bar}>
        <Wordmark className={styles.wordmark} />
      </header>

      <section className={styles.hero}>
        <div className={styles.copy}>
          <Orbits className={styles.art} />
          <h1 className={styles.line}>
            There’s more to live{" "}
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

      <footer className={styles.foot}>
        <p>© 2027 {OPERATOR}</p>
        <nav>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          {SOCIAL.map(([name, url]) => (
            <a key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Orbit on ${name}`}>
              {name}
            </a>
          ))}
        </nav>
      </footer>
    </main>
  );
}

const FIT = [
  "You’ve said “there’s nothing to do this weekend” and didn’t quite believe it.",
  "You usually hear about the good stuff a day late.",
  "You’d try a jam, a comedy night or a hackathon with people you haven’t met yet.",
  "You’d rather book the turf than plan it over twenty messages.",
  "You want what’s on near you in one place, not spread across ten WhatsApp groups.",
];

// Who Orbit is, for search engines and AI answers (schema.org).
const LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "Orbit",
      url: SITE,
      logo: `${SITE}/apple-icon.png`,
      slogan: "There’s more to live beyond the usual.",
      description: DESCRIPTION,
      areaServed: { "@type": "Country", name: "India" },
      sameAs: SOCIAL.map(([, url]) => url),
    },
    { "@type": "WebSite", "@id": `${SITE}/#site`, name: "Orbit", url: SITE, inLanguage: "en-IN", publisher: { "@id": `${SITE}/#org` } },
  ],
};

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
