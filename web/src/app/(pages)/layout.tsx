import Link from "next/link";
import { Wordmark } from "../brand";
import { Foot } from "../foot";
import styles from "./legal.module.css";

// The site's reading pages: terms and privacy (owner, 18 Nov 2026: "add terms & privacy pages") and careers (owner, 22
// Nov 2026). Plain pages on Charcoal, the wordmark home, and the site's one footer.
export default function Legal({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/" aria-label="Orbit home">
          <Wordmark className={styles.wordmark} />
        </Link>
      </header>
      <main className={styles.doc}>{children}</main>
      <Foot className={styles.foot} />
    </div>
  );
}
