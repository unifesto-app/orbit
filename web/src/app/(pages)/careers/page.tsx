import { OPENING_KINDS } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CONTACT, OPEN_GRAPH, X_HANDLE } from "../../site";
import styles from "./careers.module.css";
import { openings } from "./openings";

// heyorbit.in/careers (owner, 22 Nov 2026: "careers page at heyorbit.in/careers, link to galaxy"): the openings staff
// mark Open in Galaxy's Careers page, newest first, each opening its own page with the Apply form.
const DESCRIPTION = "Open roles at Orbit, and how to apply.";
export const metadata: Metadata = {
  title: "Careers",
  description: DESCRIPTION,
  alternates: { canonical: "/careers" },
  openGraph: { ...OPEN_GRAPH, url: "/careers", title: "Careers · Orbit", description: DESCRIPTION },
  twitter: { card: "summary_large_image", site: X_HANDLE, title: "Careers · Orbit", description: DESCRIPTION },
};

export default function Careers() {
  return (
    <article>
      <h1>Careers</h1>
      {/* In the owner's voice: short lines, their own positions, no place, and no numbers Orbit doesn't have yet. */}
      <p className={styles.lead}>
        Orbit is one place for what’s on beyond the usual: fests in one click, turf, courts and gaming by the hour, hackathons, meetups, and the
        comedians and bands people love.
      </p>
      <p className={styles.lead}>
        We’re a small team, bootstrapped on purpose. One thing tells us we’re doing it right: people’s weekends get better. If you’d rather own a
        problem end to end than wait to be told what to build, you’ll fit right in.
      </p>
      <Suspense fallback={<div className={styles.space} />}>
        <Openings />
      </Suspense>
    </article>
  );
}

async function Openings() {
  const list = await openings();
  const mail = <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;
  if (!list) return <p className={styles.note}>Openings can’t load right now. Try again in a minute.</p>;
  if (!list.length)
    return (
      <>
        <h2>No openings right now</h2>
        <p>If you’d like to build Orbit with us anyway, write to {mail} and tell us what you’d do.</p>
      </>
    );
  return (
    <>
      <h2>Open roles</h2>
      <ul className={styles.list}>
        {list.map((o) => (
          <li key={o.slug}>
            <Link href={`/careers/${o.slug}`} className={styles.row}>
              <span className={styles.role}>{o.title}</span>
              <span className={styles.meta}>{[o.team, o.place, OPENING_KINDS[o.kind]].join(" · ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
