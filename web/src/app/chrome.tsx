import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import styles from "./chrome.module.css";
import { LocationButton } from "./location-button";
import { NavSearch } from "./nav-search";
import { SearchBox } from "./search-box";

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
    links: [["Events near you", "/"], ["Hackathons", "/search?c=hackathons"], ["Comedy", "/search?c=comedy"], ["Music", "/search?c=music"], ["Meetups", "/search?c=meetups"], ["Get the app", "/app"]],
  },
  {
    title: "Hosts",
    links: [["Host an event", CONSOLE], ["Pricing", `${WWW}/pricing`], ["Help for hosts", `${WWW}/help`]],
  },
  {
    title: "Company",
    links: [["About", `${WWW}/about`], ["Careers", `${WWW}/careers`], ["Press", `${WWW}/press`], ["Blog", `${WWW}/blog`]],
  },
  {
    title: "Support",
    links: [["Contact support", `${WWW}/support`], ["Refunds", `${WWW}/refund`], ["Grievance redressal", `${WWW}/grievance`], ["Delete account", `${WWW}/delete-account`]],
  },
];

const legal: [string, string][] = [["Terms", `${WWW}/terms`], ["Privacy", `${WWW}/privacy`], ["Cookies", `${WWW}/cookies`], ["Code of conduct", `${WWW}/code-of-conduct`]];

// Brand marks in their own colours (public/social, from thesvg, MIT). X is white, per its rules for dark backgrounds.
const social = [
  { label: "Instagram", href: "https://www.instagram.com/unifesto.app/", src: "/social/instagram.svg" },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/unifesto", src: "/social/linkedin.svg" },
  { label: "X", href: "https://x.com/unifestoapp", src: "/social/x.svg" },
  { label: "YouTube", href: "https://www.youtube.com/@unifesto-app", src: "/social/youtube.svg" },
];

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.top}>
          <div className={styles.about}>
            <Image src="/orbit-wordmark.svg" alt="Orbit" width={179} height={26} />
            {/* Tagline idea from the name decision (rename.md); not yet final. */}
            <p className={styles.tagline}>Keep your people in orbit.</p>
            <ul className={styles.social} aria-label="Unifesto on social media">
              {social.map(({ label, href, src }) => (
                <li key={label}>
                  <a href={href} rel="noopener" className={styles.socialLink}>
                    <Image src={src} alt={`Unifesto on ${label}`} width={22} height={22} />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <nav aria-label="Footer" className={styles.columns}>
            {columns.map((col) => (
              <div key={col.title}>
                <h2 className={styles.colTitle}>{col.title}</h2>
                <ul className={styles.colLinks}>
                  {col.links.map(([label, href]) => (
                    <li key={label}><Link href={href}>{label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className={styles.bottom}>
          <p>© 2027 Unifesto Private Limited</p>
          <ul className={styles.legal} aria-label="Legal">
            {legal.map(([label, href]) => (
              <li key={label}><a href={href}>{label}</a></li>
            ))}
            <li><a href="mailto:support@unifesto.app">support@unifesto.app</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
