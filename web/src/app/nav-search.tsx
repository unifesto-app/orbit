"use client";

// The navbar search.
// - On /search: results update as you type (the URL is replaced after a short pause).
// - Elsewhere: typing opens a dropdown of matching events from /api/search; Enter goes to /search.
// Client-side because the root layout can't read the URL on the server and stay static.
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Icon } from "./icons";
import boxStyles from "./search-box.module.css";
import styles from "./nav-search.module.css";

type Suggestion = { slug: string; title: string; date: string; time: string; host: string; poster: string | null };

export function NavSearch({ className = "" }: { className?: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const onSearch = pathname === "/search";
  // A new page remounts the box: the dropdown closes and the text resets after you pick a result.
  // On /search the key stays put, so live updates never steal focus.
  return (
    <Box
      key={onSearch ? "search" : pathname}
      onSearch={onSearch}
      initialQ={onSearch ? (params.get("q") ?? "") : ""}
      category={onSearch ? (params.get("c") ?? "") : ""}
      className={className}
    />
  );
}

function searchHref(q: string, category = "") {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (category) p.set("c", category);
  return p.size ? `/search?${p}` : "/search";
}

function Box({ onSearch, initialQ, category, className }: { onSearch: boolean; initialQ: string; category: string; className: string }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(initialQ);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = q.trim();

  // /search: replace the URL after a pause so the server re-renders the results.
  useEffect(() => {
    if (!onSearch || query === initialQ) return;
    const t = setTimeout(() => router.replace(searchHref(query, category), { scroll: false }), 250);
    return () => clearTimeout(t);
  }, [onSearch, query, initialQ, category, router]);

  // Elsewhere: fetch suggestions after a short pause; a newer keystroke cancels the older request.
  useEffect(() => {
    if (onSearch || !query) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (res.ok) setItems(await res.json());
      } catch {
        // Aborted by a newer keystroke, or offline: keep the last list.
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [onSearch, query]);

  // Options: the events, then "See all results". The keyboard moves through them by index.
  const hrefs = [...items.map((s) => `/event/${s.slug}`), searchHref(query)];
  const expanded = !onSearch && open && query !== "";

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!expanded) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hrefs.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      e.preventDefault(); // a search input clears itself on Escape; the first Escape only closes the list
      setOpen(false);
      setActive(-1);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      router.push(hrefs[active]);
    }
  }

  return (
    <div
      className={`${styles.wrap} ${className}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <form role="search" action="/search" className={boxStyles.search}>
        <Icon name="search" size={18} />
        <label htmlFor="q" className="sr-only">Search events</label>
        <input
          id="q"
          name="q"
          type="search"
          value={q}
          placeholder="Search events"
          autoComplete="off"
          maxLength={100}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {category && <input type="hidden" name="c" value={category} />}
      </form>

      {expanded && (
        <ul id={listId} role="listbox" aria-label="Suggestions" className={styles.list}>
          {items.map((s, i) => (
            <li key={s.slug} id={`${listId}-${i}`} role="option" aria-selected={active === i}>
              <Link href={hrefs[i]} tabIndex={-1} className={styles.option} onMouseEnter={() => setActive(i)}>
                <span className={styles.thumb}>
                  {s.poster && <Image src={s.poster} alt="" width={44} height={44} />}
                </span>
                <span className={styles.text}>
                  <span className={styles.title}>{s.title}</span>
                  <span className={styles.meta}>{s.date} · {s.time} · {s.host}</span>
                </span>
              </Link>
            </li>
          ))}
          <li id={`${listId}-${items.length}`} role="option" aria-selected={active === items.length}>
            <Link href={hrefs[items.length]} tabIndex={-1} className={`${styles.option} ${styles.all}`} onMouseEnter={() => setActive(items.length)}>
              <Icon name="search" size={18} />
              See all results for “{query}”
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
