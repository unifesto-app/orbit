import type { CategorySlug } from "@orbit/contract";
import { Sacramento } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { categories, EventGrid } from "./discover";
import { Icon, type IconName } from "./icons";
import { Media } from "./media";
import styles from "./page.module.css";
import { formatPrice, spotlight, thisWeek } from "./mock";
import { seatsNote } from "./seats";

// Explore is the app's Search tab Explore (owner, 15 Nov 2026: "apply the explore from app to web"): a script title,
// then a box per category in its own colour with its line drawing on the top edge.
// The title font is loaded here, not in the layout, so only the home page fetches it.
const script = Sacramento({ weight: "400", subsets: ["latin"] });

// The colours are the app's CATEGORY_COLOR (app/src/app/(tabs)/search.tsx); film is the brand blue. The drawings are
// the app's (app/assets/explore/*.png) as 320px WebP in public/explore, made once with sharp: redo them when those change.
const exploreColor: Record<CategorySlug, string> = {
  hackathons: "#1098ad",
  comedy: "#fcc419",
  music: "#d6336c",
  meetups: "#e8590c",
  workshops: "#099268",
  fests: "#e03131",
  sports: "#2f9e44",
  film: "var(--accent)",
  startups: "#7048e8",
  gaming: "#ae3ec9",
};
// As the app: a lone shape fills its square where a scene doesn't, so music is a little smaller, and fests, wide and
// short, a little bigger.
const artScale: Partial<Record<CategorySlug, number>> = { music: 0.85, fests: 1.15 };

// Who Orbit is for, in the founder's examples.
const hostTypes: { label: string; icon: IconName }[] = [
  { label: "College clubs", icon: "college" },
  { label: "Comedy groups", icon: "comedy" },
  { label: "Jam circles", icon: "music" },
  { label: "Café meetups", icon: "cafe" },
  { label: "Startup communities", icon: "startup" },
  { label: "Company hackathons", icon: "company" },
  { label: "Housing society dandiyas", icon: "society" },
];

export default function Home() {
  const spot = spotlight;
  const spotNote = seatsNote(spot.taken, spot.capacity);

  return (
      <main className={styles.main}>
        {/* Location and search live in the navbar. */}
        <h1 className="sr-only">Events near you</h1>

        <section aria-labelledby="explore">
          <h2 id="explore" className={`${styles.script} ${script.className}`}>Explore</h2>
          <ul className={styles.explore}>
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/search?c=${c.slug}`}
                  className={styles.cat}
                  style={{ "--tint": exploreColor[c.slug], "--art": artScale[c.slug] ?? 1 } as CSSProperties}
                >
                  {/* Already small WebPs, so served as they are. */}
                  <Image src={`/explore/${c.slug}.webp`} alt="" width={320} height={320} unoptimized loading="eager" className={styles.art} />
                  <span className={styles.face}>
                    <span className={styles.name}>{c.label}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="spotlight">
          <h2 id="spotlight" className={styles.h2}>In the spotlight</h2>
          <article className={styles.spot}>
            {spot.media && (
              <div className={styles.spotMedia}>
                <Media media={spot.media} alt={`Poster for ${spot.title}`} sizes="(min-width: 960px) 340px, 100vw" priority />
              </div>
            )}
            <div className={styles.spotMain}>
              <p className={styles.spotDate} aria-hidden="true">{spot.date}</p>
              <div className={styles.spotBody}>
                <p className={styles.status}><span className={styles.dot} />{spot.status}</p>
                <h3 className={styles.spotTitle}>{spot.title}</h3>
                <p className={styles.meta}>{spot.host} · {spot.area} · {spot.date}, {spot.time}</p>
                {spotNote && spot.capacity && (
                  <>
                    <div className={styles.track} role="progressbar" aria-label="Seats taken" aria-valuenow={spot.taken} aria-valuemin={0} aria-valuemax={spot.capacity}>
                      <div style={{ width: `${Math.min(100, (spot.taken / spot.capacity) * 100)}%` }} />
                    </div>
                    <p className={styles.meta}>{spotNote}</p>
                  </>
                )}
                <div className={styles.spotFoot}>
                  <p className={styles.price}>
                    {formatPrice(spot.pricePaise)}
                    {spot.pricePaise > 0 && <span> per ticket</span>}
                  </p>
                  <Link href={`/event/${spot.slug}`} className="button">Get tickets</Link>
                </div>
              </div>
            </div>
          </article>
        </section>

        <section aria-labelledby="week">
          <h2 id="week" className={styles.h2}>This week</h2>
          <EventGrid events={thisWeek} />
        </section>

        {/* The positioning (founder, 14 Nov): the customer is the host, and what Orbit sells is people coming back. */}
        <section aria-labelledby="hosts" className={styles.hostBand}>
          <div className={styles.orbit} aria-hidden="true">
            <span className={`${styles.ring} ${styles.ring1}`}><span className={`${styles.planet} ${styles.live}`} /></span>
            <span className={`${styles.ring} ${styles.ring2}`}><span className={styles.planet} /></span>
            <span className={`${styles.ring} ${styles.ring3}`}><span className={styles.planet} /></span>
            <span className={styles.core} />
          </div>
          <div className={styles.hostCopy}>
            <p className={styles.eyebrow}>For hosts with a following</p>
            <h2 id="hosts" className={styles.hostTitle}>Keep your people in orbit.</h2>
            <p className={styles.hostText}>
              Orbit is the platform for anyone who runs something again and again, and has people who come back for it.
            </p>
            <ul className={styles.hostTypes}>
              {hostTypes.map((h) => (
                <li key={h.label}>
                  <Icon name={h.icon} size={18} />
                  {h.label}
                </li>
              ))}
            </ul>
            <Link href="/console" className={`button ${styles.hostCta}`}>Host on Orbit</Link>
          </div>
        </section>
      </main>
  );
}
