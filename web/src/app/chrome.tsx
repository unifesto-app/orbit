import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import styles from "./chrome.module.css";
import f from "./footer.module.css";
import { LocationButton } from "./location-button";
import { NavSearch } from "./nav-search";
import { SearchBox } from "./search-box";
import { Socials } from "./socials";

// The company site keeps about, legal and help (plan, section 3).
const WWW = "https://www.unifesto.app";
// The organiser console lives on this site at /console (owner's call, 14 Nov), not on its own subdomain.
const CONSOLE = "/console";

export function Navbar() {
  return (
    <header className={styles.nav}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.brand}>
          <Image src="/orbit-wordmark.svg" alt="Orbit by Unifesto, home" width={179} height={26} priority />
        </Link>

        {/* Server-rendered empty box first; the client version fills in the query on /search. */}
        <Suspense fallback={<SearchBox className={styles.search} />}>
          <NavSearch className={styles.search} />
        </Suspense>

        <div className={styles.loc}>
          <LocationButton />
        </div>

        {/* The web is Discover, event pages and registration only; tickets, profile and following live in the app. */}
        <div className={styles.actions}>
          <Link href={CONSOLE} className={styles.host}>Host an event</Link>
          <Link href="/login" className={styles.signIn}>Sign in</Link>
        </div>
      </div>
    </header>
  );
}

const columns: { title: string; links: [string, string][] }[] = [
  {
    title: "Discover",
    links: [["Events near you", "/"], ["Hackathons", "/search?c=hackathons"], ["Comedy", "/search?c=comedy"], ["Music", "/search?c=music"], ["Meetups", "/search?c=meetups"]],
  },
  {
    title: "For hosts",
    links: [["Host an event", CONSOLE], ["Pricing", `${WWW}/pricing`], ["Help for hosts", `${WWW}/help`]],
  },
  {
    title: "Unifesto",
    links: [["About", `${WWW}/about`], ["Careers", `${WWW}/careers`], ["Press", `${WWW}/press`], ["Blog", `${WWW}/blog`]],
  },
  {
    title: "Help",
    links: [["Contact support", `${WWW}/support`], ["Refunds", `${WWW}/refund`], ["Grievance redressal", `${WWW}/grievance`], ["Delete account", "/delete-account"]],
  },
];

const legal: [string, string][] = [["Terms", `${WWW}/terms`], ["Privacy", `${WWW}/privacy`], ["Cookies", `${WWW}/cookies`], ["Code of conduct", `${WWW}/code-of-conduct`]];

// Three tiers: the host call to action with the app QR, the link columns, then the base line.
export function Footer() {
  return (
    <footer className={f.footer}>
      <div className={f.inner}>
        <section className={f.band} aria-labelledby="footer-hosts">
          <div className={f.bandCopy}>
            {/* Tagline idea from the name decision (rename.md); not yet final. */}
            <h2 id="footer-hosts" className={f.bandTitle}>Keep your people in orbit.</h2>
            <p className={f.bandText}>For hosts with a following.</p>
            <Link href={CONSOLE} className={`button ${f.bandCta}`}>Host on Orbit</Link>
          </div>
          {/* Desktop: scan the QR. Phones can't scan themselves, so they get a link to /app instead. */}
          <div className={f.app}>
            <span className={f.qr}>
              <Image src="/app-qr.svg" alt="QR code linking to the Orbit app" width={96} height={96} />
            </span>
            <span className={f.appText}>
              <strong>Explore the app</strong>
              <span>Scan to open Orbit on Android or iOS</span>
            </span>
          </div>
          <Link href="/app" className={f.appLink}>Open the Orbit app</Link>
        </section>

        <nav aria-label="Footer" className={f.columns}>
          {columns.map((col) => (
            <div key={col.title}>
              <h2 className={f.colTitle}>{col.title}</h2>
              <ul className={f.colLinks}>
                {col.links.map(([label, href]) => (
                  <li key={label}><Link href={href}>{label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className={f.base}>
          <div className={f.baseRow}>
            <div className={f.brandRow}>
              <Image src="/orbit-wordmark.svg" alt="Orbit" width={124} height={18} />
              <Socials />
            </div>
            <ul className={f.legal} aria-label="Legal">
              {legal.map(([label, href]) => (
                <li key={label}><a href={href}>{label}</a></li>
              ))}
            </ul>
          </div>
          <div className={f.baseRow}>
            <p>© 2027 Unifesto Private Limited</p>
            <a href="mailto:support@unifesto.app">support@unifesto.app</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
