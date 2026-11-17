// Coming Soon (owner, 16 Nov 2026): "Coming soon" in Explore's script, the accent from the top and the app's space dots
// behind. The revolving orbit of category cards came off on 17 Nov ("remove the revolving orbit") for the waitlist, its
// count, and the small stuff around you on still rings. Outside the (site) group, so no navbar or footer.
import type { Metadata } from "next";
import Image from "next/image";
import { connection } from "next/server";
import { type CSSProperties, Suspense } from "react";
import { scriptTitle } from "../explore";
import { Socials } from "../socials";
import { InterestForm } from "./interest";
import { API_URL } from "./orbit-api";
import styles from "./page.module.css";
import { SpaceDots } from "./space-dots";

export const metadata: Metadata = {
  title: "Coming soon · Orbit",
  description: "Everything around you, even the small stuff.",
};

export default function ComingSoon() {
  return (
    <main className={styles.page}>
      <SpaceDots />

      {/* Top left after a bar (owner: "on left top | Keep your people in orbit."; the line since 17 Nov 2026). */}
      <p className={styles.tagline}>Everything around you, even the small stuff.</p>

      {/* The middle of the screen; the dots turn round it (data-orbit). */}
      <div className={styles.center} data-orbit>
        <Around />
        {/* On frosted glass, over the rings (owner, 17 Nov 2026: "add glass card"). */}
        <div className={styles.card}>
          {/* All lower case (owner, 16 Nov 2026: "c. small in coming soon"). */}
          <h1 className={`${scriptTitle} ${styles.title}`}>coming soon</h1>
          <InterestForm />
          <Suspense fallback={<p className={styles.count} />}>
            <Waiting />
          </Suspense>
        </div>
      </div>

      {/* The wordmark bottom left, the copyright in the middle, Instagram on the right (owner, 17 Nov 2026: "remove by
          unifesto", "add © 2027 Orbit", "© 2027 Orbit - center", "instagram - right"). */}
      <footer className={styles.bar}>
        <Image src="/orbit-wordmark.svg" alt="Orbit" width={179} height={26} priority className={styles.wordmark} />
        <p className={styles.copy}>© 2027 Orbit</p>
        <Socials className={styles.social} />
      </footer>
    </main>
  );
}

// The tagline drawn out (owner, 17 Nov 2026: "it was very simple make it unique"): still rings round the middle, the
// visitor at its centre, and the small stuff on them, each a dot in the accent that lights up in turn on load. Examples
// of what Orbit shows, naming no real place, so none reads as a listing; no distances (owner: "its not about distance").
// `a` is the angle from the right, clockwise; `wide` ones sit on the outer ring and show only on wide screens.
const AROUND = [
  { what: "A jam session upstairs", a: 118 },
  { what: "An open mic down the road", a: -118 },
  { what: "Sunday cricket, one player short", a: -62 },
  { what: "Board games on Friday", a: 62 },
  { what: "A turf slot free at 7", a: -155, wide: true },
  { what: "Stand-up at a café", a: 155, wide: true },
  { what: "A gaming café with two seats left", a: 25, wide: true },
  { what: "A hackathon on campus", a: -25, wide: true },
];

function Around() {
  return (
    <div className={styles.around} aria-hidden="true">
      <span className={styles.ring} />
      <span className={styles.ring} />
      <span className={styles.ring} />
      <ul>
        {AROUND.map((s, i) => (
          <li key={s.what} className={`${styles.spot} ${s.a < 0 ? styles.up : ""} ${s.wide ? styles.wide : ""}`} style={{ "--a": `${s.a}deg`, "--i": i } as CSSProperties}>
            <span className={styles.dot} />
            <span className={styles.what}>{s.what}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// How many are on the waitlist (owner: "display no of people shows interest", "how many on waitlist"). Read on each
// visit, never at build time, when the API isn't there; nothing shows if it can't be read, or before anyone has asked.
async function Waiting() {
  await connection();
  const r: { count?: unknown } | null = await fetch(`${API_URL}/public/interest`, { signal: AbortSignal.timeout(3000) })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  const n = typeof r?.count === "number" ? r.count : 0;
  return <p className={styles.count}>{n > 0 && `${n.toLocaleString("en-IN")} ${n === 1 ? "person" : "people"} on the waitlist`}</p>;
}
