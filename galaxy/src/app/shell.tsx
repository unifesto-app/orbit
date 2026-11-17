"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { crumbFor, home, isActive, sections, tokens, type NavItem } from "./nav";
import wordmark from "./orbit-wordmark.svg";
import styles from "./shell.module.css";
import ui from "./ui.module.css";

// Same breakpoint as the AWS console: below it the side nav is a drawer.
const DESKTOP = "(min-width: 689px)";

export function Shell({ children, account }: { children: ReactNode; account: ReactNode }) {
  // Desktop always shows the side nav. Phones open it as a drawer over the
  // page: everything else goes inert, focus moves in, and returns on close.
  const [drawer, setDrawer] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const wasDrawer = useRef(false);

  useEffect(() => {
    if (drawer) nav.current?.querySelector("a")?.focus();
    else if (wasDrawer.current) toggle.current?.focus();
    wasDrawer.current = drawer;
  }, [drawer]);

  // Rotating a phone past the breakpoint turns the drawer into the plain nav.
  useEffect(() => {
    const mq = matchMedia(DESKTOP);
    const onChange = () => mq.matches && setDrawer(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const closeDrawer = () => setDrawer(false);

  return (
    <div
      className={styles.shell}
      data-drawer={drawer ? "open" : undefined}
      onKeyDown={(e) => e.key === "Escape" && closeDrawer()}
    >
      <a href="#main" className={styles.skip}>
        Skip to main content
      </a>

      {/* Dark in both themes, as the AWS console's top bar is (globals.css). */}
      <header className={styles.top} data-scheme="dark" inert={drawer}>
        <Link href="/" className={styles.logo}>
          <Image src={wordmark} alt="Orbit" priority />
          <span className={ui.script}>Galaxy</span>
        </Link>
        <form action="/search" role="search" className={styles.search}>
          <Icon name="search" />
          <input type="search" name="q" placeholder="Search" aria-label="Search Galaxy" />
        </form>
        <a className={`${styles.topLink} ${styles.site}`} href="https://heyorbit.in" target="_blank" rel="noreferrer">
          heyorbit.in <Icon name="external" />
        </a>
        <ThemeSwitch className={`${styles.topLink} ${styles.headerTheme}`} />
        {account}
      </header>

      <div className={styles.toolbar} inert={drawer}>
        <button
          ref={toggle}
          type="button"
          className={styles.toggle}
          aria-label="Open navigation"
          aria-expanded={drawer}
          aria-controls="side-nav"
          onClick={() => setDrawer(true)}
        >
          <Icon name="panel" />
        </button>
        <Suspense fallback={null}>
          <Crumbs />
        </Suspense>
      </div>

      <nav id="side-nav" ref={nav} className={styles.side} aria-label="Galaxy">
        <div className={styles.sideHeader}>
          <Link href="/" className={styles.sideTitle} onClick={closeDrawer}>
            <span className={ui.script}>Galaxy</span>
          </Link>
          <button type="button" className={styles.iconButton} aria-label="Close navigation" onClick={closeDrawer}>
            <Icon name="angle-left" />
          </button>
        </div>
        {/* usePathname suspends on dynamic routes that aren't prerendered, so
            only the links wait for it; the rest of the shell stays static. */}
        <Suspense fallback={<NavLinks path={null} onNavigate={closeDrawer} />}>
          <ActiveNavLinks onNavigate={closeDrawer} />
        </Suspense>
        {/* Phones: no room in the top bar, so the switch sits at the drawer's foot. */}
        <ThemeSwitch className={`${styles.topLink} ${styles.navTheme}`} />
      </nav>
      <div className={styles.backdrop} onClick={closeDrawer} />

      <main id="main" className={styles.main} inert={drawer}>
        {children}
      </main>

      <footer className={styles.footer} inert={drawer}>
        <Link href={tokens.href}>{tokens.label}</Link>
        <span>© 2027 Orbit</span>
      </footer>
    </div>
  );
}

// Light or dark, kept in this browser (layout.tsx applies it before paint). Text, as AWS's controls are. Both labels
// render and CSS shows the one for the other theme, so the server's HTML never disagrees with the browser's.
function ThemeSwitch({ className }: { className: string }) {
  const flip = () => {
    const root = document.documentElement;
    const theme = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Private mode: the switch still works until the tab closes.
    }
  };
  return (
    <button type="button" className={className} onClick={flip}>
      <span className={styles.toLight}>Light mode</span>
      <span className={styles.toDark}>Dark mode</span>
    </button>
  );
}

function ActiveNavLinks({ onNavigate }: { onNavigate: () => void }) {
  return <NavLinks path={usePathname()} onNavigate={onNavigate} />;
}

function NavLinks({ path, onNavigate }: { path: string | null; onNavigate: () => void }) {
  const link = (item: NavItem) => (
    <li key={item.href}>
      <Link
        href={item.href}
        className={styles.navLink}
        aria-current={path !== null && isActive(item, path) ? "page" : undefined}
        onClick={onNavigate}
      >
        {item.label}
      </Link>
    </li>
  );

  return (
    <>
      <ul className={styles.navList}>{link(home)}</ul>
      {sections.map((section) => (
        <details key={section.title} className={styles.section} open>
          <summary>
            <Icon name="angle-down" />
            {section.title}
          </summary>
          <ul className={styles.navList}>{section.items.map(link)}</ul>
        </details>
      ))}
    </>
  );
}

function Crumbs() {
  const current = crumbFor(usePathname());
  return (
    <nav aria-label="Breadcrumbs" className={styles.crumbs}>
      <ol>
        <li>{current ? <Link href="/">Galaxy</Link> : <span aria-current="page">Galaxy</span>}</li>
        {current && (
          <li>
            <span aria-current="page">{current.label}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}
