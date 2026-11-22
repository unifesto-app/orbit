"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import styles from "./page.module.css";

// The one waitlist pill (owner, 22 Nov 2026: "while scrolling the Join the waitlist from hero to navbar ... need a clean
// one", then "at the end from navbar to above footer one"). Two legs, both following the scroll and both undone by
// scrolling back:
// 1. It sits centred at the hero's foot and rides up with the page; at the top it catches (sticky, so the browser holds
//    it with no lag) and, over the next RUN pixels, glides right into the navbar's corner.
// 2. As the page's end comes up, it leaves the corner and glides down onto the button above the footer (END), over
//    LAND pixels. Once it's there, that button shows and it hides, so what scrolls on with the page is the page's own;
//    keyboard focus goes with it.
// Only the glides are script: a transform set once a frame while the page scrolls. For people who ask for less motion
// it doesn't glide: it steps to the corner as it catches and onto the end button once that's in place.

const TOP = 12; // where it catches, as the navbar
const RUN = 160; // how much scrolling the first glide takes
const LAND = 260; // and the second
const EDGE = 1160; // the page's width; the corner is its right edge, or 16 from the screen's
const END = "waitlist-end"; // the id of the button above the footer it lands on (page.tsx)

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const ease = (t: number) => t * t * (3 - 2 * t);
const step = (at: number) => (t: number) => (t >= at ? 1 : 0); // the stand-in for ease under reduced motion

export function Dock() {
  const mark = useRef<HTMLElement>(null); // where the pill's row would be if nothing held it
  const pill = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    let frame = 0;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    const place = () => {
      frame = 0;
      const row = mark.current?.parentElement;
      const p = pill.current;
      if (!mark.current || !row || !p) return;
      const box = row.getBoundingClientRect();
      const free = mark.current.getBoundingClientRect().top; // the row's top had it kept scrolling with the page
      const w = p.offsetWidth;
      const home = { x: box.left + (box.width - w) / 2, y: Math.max(TOP, free) }; // where it sits untransformed
      const corner = box.left + box.width - Math.max(16, (box.width - EDGE) / 2) - w;

      // 1: centre to the corner, once caught.
      const glide = still.matches ? step(Number.MIN_VALUE) : ease;
      let x = home.x + glide(clamp((TOP - free) / RUN)) * (corner - home.x);
      let y = home.y;

      // 2: the corner down to the end button. It finishes as that button comes fully into view (its top 160 pixels above
      // the screen's foot), or 40 pixels before the page can scroll no further if that's sooner, so it never waits
      // mid-air at the end. It starts LAND pixels earlier, while the button is still below the screen.
      const end = document.getElementById(END);
      let landed = false;
      if (end) {
        const slot = end.getBoundingClientRect();
        const lowest = slot.top - (document.documentElement.scrollHeight - innerHeight - scrollY);
        const finish = Math.max(innerHeight - 160, lowest + 40);
        const u = clamp((finish + LAND - slot.top) / LAND);
        const land = still.matches ? step(1) : ease;
        if (u > 0) {
          x += (slot.left - x) * land(u);
          y += (slot.top - y) * land(u);
        }
        landed = u >= 1;
        const show = landed ? "visible" : "hidden";
        if (end.style.visibility !== show) {
          // Only on a change, not every frame; a hidden link loses focus, so it moves to the one now showing.
          const focused = document.activeElement === (landed ? p : end);
          end.style.visibility = show;
          p.style.visibility = landed ? "hidden" : "visible";
          if (focused) (landed ? end : p).focus({ preventScroll: true });
        }
      }

      p.style.transform = `translate(${(x - home.x).toFixed(1)}px, ${(y - home.y).toFixed(1)}px)`;
    };
    const ask = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    addEventListener("scroll", ask, { passive: true });
    addEventListener("resize", ask);
    return () => {
      removeEventListener("scroll", ask);
      removeEventListener("resize", ask);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <i ref={mark} className={styles.anchor} aria-hidden="true" />
      <div className={styles.dock}>
        <Link ref={pill} href="/waitlist" className={styles.capsule}>
          Join the waitlist
        </Link>
      </div>
    </>
  );
}
