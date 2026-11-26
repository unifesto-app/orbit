"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { badge } from "../../../inbox";
import styles from "./inbox.module.css";
import { unreadCount } from "./actions";
import { INBOX_CHANGED } from "./read";

// Inbox in the top bar, with its unread count: read again on every navigation, after a mark-read, and every minute while
// the tab is in view (and as it comes back into view).
export function InboxLink({ className }: { className: string }) {
  const path = usePathname();
  const [n, setN] = useState(0);

  useEffect(() => {
    let live = true;
    const load = () => void unreadCount().then((c) => live && c !== null && setN(c));
    load();
    const tick = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(INBOX_CHANGED, load);
    return () => {
      live = false;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(INBOX_CHANGED, load);
    };
  }, [path]);

  const b = badge(n);
  return (
    <Link href="/inbox" className={className} aria-label={b ? `Inbox, ${n} unread` : undefined}>
      Inbox
      {b && <span className={styles.count}>{b}</span>}
    </Link>
  );
}
