"use client";

import type { ReactNode } from "react";

// A link to a part of the same page that glides there (owner, 22 Nov 2026: "if needed add smooth scroll"), unless the
// viewer asks for less motion. Only these links glide: a smooth scroll set on the whole page also made Back and Forward
// glide (review of the homepage), so the page keeps the browser's instant restore. The address still gets the #part.
export function Jump({ href, className, children }: { href: `#${string}`; className?: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        const to = document.getElementById(href.slice(1));
        if (!to) return; // the browser's own jump
        e.preventDefault();
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        to.scrollIntoView({ behavior: still ? "auto" : "smooth" });
        history.pushState(null, "", href);
      }}>
      {children}
    </a>
  );
}
