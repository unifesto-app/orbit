// Explore's pieces, from the app's Search tab (owner, 15 Nov 2026: "apply the explore from app to web"): the script
// title and a category card in its own colour with its line drawing on the top edge. The home page's Explore and Coming
// Soon's orbit both use them.
import type { CategorySlug } from "@orbit/contract";
import { Sacramento } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import styles from "./explore.module.css";

// Sacramento, the app's Explore title. Only pages that import this module fetch it.
const sacramento = Sacramento({ weight: "400", subsets: ["latin"] });
// The script title's font and weight; the page sets its size and spacing.
export const scriptTitle = `${sacramento.className} ${styles.script}`;

// The colours are the app's CATEGORY_COLOR (app/src/app/(tabs)/search.tsx); film is the brand blue. The drawings are
// the app's (app/assets/explore/*.png) as 320px WebP in public/explore, made once with sharp: redo them when those change.
const tint: Record<CategorySlug, string> = {
  hackathons: "#1098ad",
  comedy: "#fcc419",
  music: "#d6336c",
  meetups: "#e8590c",
  workshops: "#099268",
  fests: "#e03131",
  sports: "#2f9e44",
  film: "var(--accent)",
  startups: "#7048e8",
  gaming: "#ae3ec9",
};
// As the app: a lone shape fills its square where a scene doesn't, so music is a little smaller, and fests, wide and
// short, a little bigger.
const artScale: Partial<Record<CategorySlug, number>> = { music: 0.85, fests: 1.15 };

// A category card, as wide as its container. With `href` it's a link (the home page); without, just the picture
// (Coming Soon's orbit).
export function ExploreCard({ slug, label, href }: { slug: CategorySlug; label: string; href?: string }) {
  const style = { "--tint": tint[slug], "--art": artScale[slug] ?? 1 } as CSSProperties;
  const body = (
    <>
      {/* Already small WebPs, so served as they are. */}
      <Image src={`/explore/${slug}.webp`} alt="" width={320} height={320} unoptimized loading="eager" className={styles.art} />
      <span className={styles.face}>
        <span className={styles.name}>{label}</span>
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={styles.card} style={style}>
      {body}
    </Link>
  ) : (
    <div className={styles.card} style={style}>
      {body}
    </div>
  );
}
