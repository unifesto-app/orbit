// The event search box. A plain GET form to /search?q=…; no client code of its own,
// so the navbar can render it on the server and nav-search.tsx can prefill it on /search.
import { Icon } from "./icons";
import styles from "./search-box.module.css";

export function SearchBox({ q = "", category, className = "" }: { q?: string; category?: string; className?: string }) {
  return (
    <form role="search" action="/search" className={`${styles.search} ${className}`}>
      <Icon name="search" size={18} />
      <label htmlFor="q" className="sr-only">Search events</label>
      <input id="q" name="q" type="search" defaultValue={q} placeholder="Search events" autoComplete="off" maxLength={100} />
      {category && <input type="hidden" name="c" value={category} />}
    </form>
  );
}
