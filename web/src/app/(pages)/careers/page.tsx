import { OPENING_KINDS, type OpeningCard } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CONTACT, OPEN_GRAPH, X_HANDLE } from "../../site";
import styles from "./careers.module.css";
import { openings } from "./openings";

// heyorbit.in/careers (owner, 22 Nov 2026: "careers page at heyorbit.in/careers, link to galaxy"): the openings staff
// mark Open in Galaxy's Careers page, by city, each opening its own page with the Apply form.
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
  const cities = byCity(list);
  return (
    <>
      <h2>Open roles</h2>
      {cities.length > 1 && (
        <nav className={styles.cities} aria-label="Cities">
          {cities.map(({ city, id }) => (
            <a key={id} href={`#${id}`}>
              {city}
            </a>
          ))}
        </nav>
      )}
      {cities.map(({ city, id, roles }) => (
        <section key={id} aria-labelledby={id}>
          <h3 id={id} className={styles.city}>
            {city}
          </h3>
          <ul className={styles.list}>
            {roles.map((o) => (
              <li key={o.slug}>
                <Link href={`/careers/${o.slug}`} className={styles.row}>
                  <span className={styles.role}>{unsuffix(o.title, city)}</span>
                  <span className={styles.meta}>{[o.team, unprefix(o.place, city), OPENING_KINDS[o.kind]].filter(Boolean).join(" · ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// Grouped by city (owner, 22 Nov 2026: "group the careers page by city"): the city is what Where says before its first
// comma ("Pune, mostly from home" is Pune; "Remote in India" is its own group). Cities A to Z, so none reads as first in
// line; roles A to Z within each. Under a city's heading its name isn't repeated: "Venue Partnerships Intern, Pune"
// shows as "Venue Partnerships Intern", "Pune, mostly from home" as "mostly from home". Each opening's page keeps both.
// Spellings that differ only in case or punctuation ("Pune", "pune") are one city, shown as first spelled; a city whose
// name makes no link id (all punctuation) gets "city-2" and the like, so every jump and heading stays its own.
const cityOf = (o: OpeningCard) => o.place.split(",")[0]!.trim() || o.place;
const slug = (s: string) => s.toLocaleLowerCase("en-IN").replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
function byCity(list: OpeningCard[]) {
  const groups = new Map<string, { city: string; roles: OpeningCard[] }>();
  for (const o of list) {
    const city = cityOf(o);
    const key = slug(city) || city;
    const group = groups.get(key) ?? { city, roles: [] };
    group.roles.push(o);
    groups.set(key, group);
  }
  const az = (a: string, b: string) => a.localeCompare(b, "en-IN");
  return [...groups.values()]
    .sort((a, b) => az(a.city, b.city))
    .map((g, i) => ({ city: g.city, id: slug(g.city) || `city-${i + 1}`, roles: g.roles.sort((a, b) => az(a.title, b.title)) }));
}
const unsuffix = (title: string, city: string) => (title.endsWith(`, ${city}`) && title.length > city.length + 2 ? title.slice(0, -city.length - 2) : title);
const unprefix = (place: string, city: string) => (place.startsWith(`${city}, `) ? place.slice(city.length + 2) : place === city ? "" : place);
