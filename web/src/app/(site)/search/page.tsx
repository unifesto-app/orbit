import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { categories, EventGrid, searchEvents } from "../../discover";
import { Icon } from "../../icons";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "Search · Orbit" };

// The heading is the shared shell; everything that reads ?q= and ?c= sits inside Suspense,
// as Cache Components requires for URL data.
export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Search</h1>
      <Suspense fallback={<div className={styles.ghost} />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const params = await searchParams;
  const q = first(params.q).trim().slice(0, 100);
  const category = categories.find((c) => c.slug === first(params.c)); // unknown slugs are ignored
  const results = searchEvents(q, category?.slug);

  // Chip links keep the search text; the navbar search box keeps the category (nav-search.tsx).
  const href = (c?: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (c) p.set("c", c);
    return p.size ? `/search?${p}` : "/search";
  };

  const summary = [
    `${results.length} ${results.length === 1 ? "event" : "events"}`,
    q && `for “${q}”`,
    category && `in ${category.label}`,
  ].filter(Boolean).join(" ");

  return (
    <>
      <nav aria-label="Categories">
        <ul className={styles.chips}>
          <li>
            <Link href={href()} className={styles.chip} aria-current={category ? undefined : "page"}>All</Link>
          </li>
          {/* The selected category moves next to All so it is visible in the phone's scrolling row. */}
          {(category ? [category, ...categories.filter((c) => c !== category)] : categories).map((c) => (
            <li key={c.slug}>
              <Link href={href(c.slug)} className={styles.chip} aria-current={category?.slug === c.slug ? "page" : undefined}>
                <Icon name={c.icon} size={18} />
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <p className={styles.summary}>{summary}</p>

      {results.length > 0 ? (
        <EventGrid events={results} />
      ) : (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>Nothing here yet</h2>
          <p className={styles.emptyText}>
            {q ? "Try a shorter word, or another category." : `No ${category?.label.toLowerCase()} events this week.`}
          </p>
          <Link href="/search" className="button">See all events</Link>
        </div>
      )}
    </>
  );
}
