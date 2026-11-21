import Link from "next/link";
import { Wordmark } from "../brand";
import { SOCIAL } from "../site";
import styles from "./legal.module.css";

// The terms and privacy pages (owner, 18 Nov 2026: "add terms & privacy pages"): plain reading pages on Charcoal, the
// wordmark home, and the same footer links as the waitlist.
export default function Legal({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/" aria-label="Orbit home">
          <Wordmark className={styles.wordmark} />
        </Link>
      </header>
      <main className={styles.doc}>{children}</main>
      <footer className={styles.foot}>
        <p>© 2027 Orbit</p>
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
    </div>
  );
}
