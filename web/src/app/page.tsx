// Orbit's homepage (owner, 22 Nov 2026: "lets build Orbit's Homepage", then "redesign it based on mobile app"), drawn
// with the app's own parts: the line in its orbits on Account's 4:3 glass panel with the Sage glow, the waitlist pill on
// Home's dark glass gliding from the hero to the navbar and down to the foot (dock.tsx), Orbit's chat bubbles with the
// orb, the app's screens drawn live as Apple shows its own (phone.tsx, gallery.tsx), the network across India
// (network.tsx), and the 3D wordmark at the foot as on Account. Orbit isn't open yet, so every way in leads to /waitlist.
// Copy is only what's already public: the line, llms.txt, the store listing's captions and the fit list.
import Link from "next/link";
import type { ReactNode } from "react";
import { deepType, Defs, Orbits, Wordmark } from "./brand";
import { Dock } from "./dock";
import { Foot } from "./foot";
import { Gallery } from "./gallery";
import { Jump } from "./jump";
import { Network } from "./network";
import { ChatScreen, ComedyScreen, HackathonScreen, HomeScreen, Phone, SlotScreen } from "./phone";
import styles from "./page.module.css";
import { DESCRIPTION, FIT, SITE, SOCIAL } from "./site";
import base from "./site.module.css";

// What Orbit will have, as Apple shows its own: a row of tiles that scrolls sideways, each a headline from the store
// listing's captions (its second half in the 3D type), one line, and the app's screen drawn live under it (phone.tsx).
const CHAPTERS: { tag: string; head: [string, string]; line: string; label: string; Screen: () => ReactNode }[] = [
  { tag: "Home", head: ["What’s on this week,", "in one place."], line: "Your tickets, the hosts you follow, and what’s on near you.", label: "Orbit’s Home", Screen: HomeScreen },
  { tag: "Ask Orbit", head: ["Not sure what to do?", "Just ask."], line: "Ask Orbit about events, places to play and hosts near you.", label: "Orbit’s chat", Screen: ChatScreen },
  { tag: "Performers", head: ["Know who’s on stage", "before you go."], line: "Follow comedians and bands, and tap “Loved it” after the show.", label: "An open mic night on Orbit", Screen: ComedyScreen },
  { tag: "Hackathons", head: ["Hackathons,", "start to finish."], line: "Teams, rounds, announcements and results in one place.", label: "A hackathon on Orbit", Screen: HackathonScreen },
  { tag: "Play", head: ["Book the hour", "that suits you."], line: "Turf, courts and gaming cafés, by the hour.", label: "Booking a slot on Orbit", Screen: SlotScreen },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LD) }} />
      <Defs />
      <header className={styles.bar}>
        <Link href="/" className={styles.home} aria-label="Orbit home">
          <Wordmark className={styles.mark} />
        </Link>
      </header>

      <section className={styles.panel}>
        <div className={base.copy}>
          <Orbits className={base.art} />
          <h1 className={base.line}>
            There’s more to live{" "}
            <span className={base.deep} style={{ backgroundImage: deepType }}>
              beyond the usual.
            </span>
          </h1>
        </div>
      </section>
      <Dock />

      <div className={styles.column}>
        <Says
          said={[
            <>
              <strong>Orbit isn’t open yet.</strong>{" "}
              Fests in one click, turf, courts and gaming by the hour, hackathons, meetups, and the comedians and bands
              you love. Join the waitlist, and Orbit will say when it opens.
            </>,
          ]}
          answers={[
            ["What will it have?", "#have"],
            ["Who’s it for?", "#fit"],
          ]}
        />

      </div>

      <section className={styles.section} id="have" aria-labelledby="have-title">
        <h2 id="have-title" className={styles.lead}>
          What Orbit will have
        </h2>
        <Gallery label="What Orbit will have">
          {CHAPTERS.map(({ tag, head, line, label, Screen }) => (
            <article key={label} className={styles.tile}>
              <div className={styles.words}>
                <p className={styles.tag}>{tag}</p>
                <h3>
                  {head[0]}{" "}
                  <span className={base.deep} style={{ backgroundImage: deepType }}>
                    {head[1]}
                  </span>
                </h3>
                <p>{line}</p>
              </div>
              <Phone label={label}>
                <Screen />
              </Phone>
            </article>
          ))}
        </Gallery>
      </section>

      <section className={`${styles.section} ${styles.wide} ${styles.network}`} aria-labelledby="network-title">
        <div>
          <p className={styles.kicker}>The network</p>
          <h2 id="network-title" className={styles.lead}>
            One network, city to city.
          </h2>
          <p className={styles.sub}>
            Hosts and people across India, joined on one network. Wherever you are, what’s on near you will be on
            Orbit.
          </p>
        </div>
        <Network className={styles.map} />
      </section>

      <div className={styles.column}>
        <section className={styles.section} id="fit" aria-label="Who it’s for">
          <Says
            said={[
              <strong key="t">You’ll probably love Orbit if…</strong>,
              ...FIT.map((line) => <span key={line}>{line}</span>),
              <span key="usual">If the usual is enough for you, Orbit probably isn’t. That’s fine too.</span>,
            ]}
            answers={[["That’s me", "/waitlist"]]}
          />
        </section>

        <section className={styles.end}>
          <Wordmark className={styles.wordmark} />
          {/* Where the gliding pill lands (dock.tsx's END), so it's the same pill. */}
          <Link id="waitlist-end" href="/waitlist" className={styles.capsule}>
            Join the waitlist
          </Link>
        </section>

        <Foot className={base.foot} />
      </div>
    </main>
  );
}

// Orbit talking, as in the app's chat and on Home: its bubbles on the left with the orb at the foot of the last, then
// your answers as outlined bubbles on the right, here links.
function Says({ said, answers }: { said: ReactNode[]; answers: [string, string][] }) {
  return (
    <div className={styles.says}>
      {said.map((s, i) => {
        const last = i === said.length - 1;
        return (
          <div key={i} className={styles.said}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the orb, 28 px; kept (unseen) beside earlier bubbles to line them up */}
            <img src="/orb.webp" alt={last ? "Orbit" : ""} width={28} height={28} className={last ? undefined : styles.unseen} />
            <p className={styles.bubble}>{s}</p>
          </div>
        );
      })}
      <div className={styles.answers}>
        {answers.map(([label, href]) =>
          href.startsWith("#") ? (
            <Jump key={label} href={href as `#${string}`} className={styles.answer}>
              {label}
            </Jump>
          ) : (
            <Link key={label} href={href} className={styles.answer}>
              {label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

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
