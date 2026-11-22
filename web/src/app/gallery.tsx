"use client";

import { type ReactNode, useRef, useState } from "react";
import { Icon } from "./icons";
import styles from "./page.module.css";

// Apple's gallery (owner, 22 Nov 2026: "use horizantal scroll"): tiles in one row that scrolls sideways, by swipe,
// trackpad, arrow keys once focused, or the two arrows under it, each tile settling at the row's start. An arrow goes
// dim at its end.
export function Gallery({ label, children }: { label: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState<[boolean, boolean]>([true, false]);

  const move = (way: 1 | -1) => {
    const el = row.current;
    const tile = el?.firstElementChild as HTMLElement | null;
    if (!el || !tile) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: way * (tile.offsetWidth + 24), behavior: smooth ? "smooth" : "auto" });
  };
  const onScroll = () => {
    const el = row.current;
    if (!el) return;
    const next: [boolean, boolean] = [el.scrollLeft < 8, el.scrollLeft + el.clientWidth > el.scrollWidth - 8];
    setEnds((was) => (was[0] === next[0] && was[1] === next[1] ? was : next)); // re-render only at an end
  };

  return (
    <>
      <div ref={row} className={styles.gallery} onScroll={onScroll} tabIndex={0} role="group" aria-label={label}>
        {children}
      </div>
      <div className={styles.paddles}>
        <button type="button" aria-label="Back" disabled={ends[0]} onClick={() => move(-1)} className={styles.flip}>
          <Icon name="chevron" size={18} />
        </button>
        <button type="button" aria-label="Next" disabled={ends[1]} onClick={() => move(1)}>
          <Icon name="chevron" size={18} />
        </button>
      </div>
    </>
  );
}
