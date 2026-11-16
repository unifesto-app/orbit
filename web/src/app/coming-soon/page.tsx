// Coming Soon (owner, 16 Nov 2026): "Orbit by Unifesto", "Coming soon" in Explore's script, the accent from the top,
// an orbit of the category cards only, revolving, and the app's space dots behind. Outside the (site) group, so no
// navbar or footer.
import { categories } from "@orbit/contract";
import type { Metadata } from "next";
import Image from "next/image";
import type { CSSProperties } from "react";
import { ExploreCard, scriptTitle } from "../explore";
import { Socials } from "../socials";
import styles from "./page.module.css";
import { SpaceDots } from "./space-dots";

export const metadata: Metadata = {
  title: "Coming soon · Orbit by Unifesto",
  description: "Events near you, from the hosts you keep going back to. Coming soon.",
};

export default function ComingSoon() {
  return (
    <main className={styles.page}>
      <SpaceDots />

      {/* A line about Orbit, the footer's tagline (owner: "add any text related to orbit"), top left after a bar
          (owner: "on left top | Keep your people in orbit."). */}
      <p className={styles.tagline}>Keep your people in orbit.</p>

      {/* All lower case (owner, 16 Nov 2026: "c. small in coming soon"). */}
      <h1 className={`${scriptTitle} ${styles.title}`}>coming soon</h1>

      {/* The orbit, in the middle of the screen (owner: "make the orbit in center"): the cards ride a tilted ring,
          turning slowly, each turned back to face you as it goes round; the front of the ring is nearest and biggest,
          the back smaller and higher, as the app's switcher. A picture, so one label names what's on it. */}
      <div className={styles.stage} data-orbit role="img" aria-label={`Orbit's categories: ${categories.map((c) => c.label).join(", ")}`}>
        {/* The faint ring through the cards' centres, behind every card (outside the cards' 3D scene). */}
        <div className={styles.path} />
        <div className={styles.ring}>
          {categories.map((c, i) => (
            <div key={c.slug} className={styles.slot} style={{ "--i": i } as CSSProperties}>
              <div className={styles.billboard}>
                <ExploreCard slug={c.slug} label={c.label} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* "Orbit by Unifesto" bottom left, the social links, the copyright on the right (owner: "move orbit by unifesto
          to bottom left and social icons and right side copyright"). */}
      <footer className={styles.bar}>
        <div className={styles.brand}>
          <Image src="/orbit-wordmark.svg" alt="Orbit" width={179} height={26} priority className={styles.wordmark} />
          {/* The app splash's "by unifesto" art (app/assets/splash/by-unifesto.svg), never typed text (owner: "use svg
              only not text, even small"). */}
          <Image src="/by-unifesto.svg" alt="by Unifesto" width={1735} height={238} className={styles.by} />

        </div>
        <Socials className={styles.social} />
        <p className={styles.copy}>© 2027 Unifesto Private Limited</p>
      </footer>
    </main>
  );
}
