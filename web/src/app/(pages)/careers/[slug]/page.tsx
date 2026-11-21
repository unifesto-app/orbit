import { OPENING_KINDS } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { OPEN_GRAPH, X_HANDLE } from "../../../site";
import { apply } from "../actions";
import styles from "../careers.module.css";
import { opening } from "../openings";
import { ApplyForm } from "./apply";

// One open opening (owner, 22 Nov 2026: "Openings + applications"): what it is, as staff wrote it in Galaxy, and the
// Apply form. A draft or closed one is the site's 404.

export async function generateMetadata({ params }: PageProps<"/careers/[slug]">): Promise<Metadata> {
  const o = await opening((await params).slug);
  if (!o) return { title: "Careers" };
  const description = `${[o.team, o.place, OPENING_KINDS[o.kind]].join(" · ")}. ${o.about}`.replace(/\s+/g, " ").slice(0, 160);
  const url = `/careers/${o.slug}`;
  return {
    title: o.title,
    description,
    alternates: { canonical: url },
    openGraph: { ...OPEN_GRAPH, url, title: `${o.title} · Orbit`, description },
    twitter: { card: "summary_large_image", site: X_HANDLE, title: `${o.title} · Orbit`, description },
  };
}

export default function OpeningScreen({ params }: PageProps<"/careers/[slug]">) {
  return (
    <article>
      <Link href="/careers" className={styles.back}>
        All openings
      </Link>
      <Suspense fallback={<div className={styles.space} />}>
        <Opening params={params} />
      </Suspense>
    </article>
  );
}

async function Opening({ params }: { params: PageProps<"/careers/[slug]">["params"] }) {
  const o = await opening((await params).slug);
  if (!o) return <p className={styles.note}>This opening can’t load right now. Try again in a minute.</p>;
  return (
    <>
      <h1>{o.title}</h1>
      <p className={styles.facts}>
        {[o.team, o.place, OPENING_KINDS[o.kind]].join(" · ")}
        {o.pay && <span className={styles.pay}>{o.pay}</span>}
      </p>
      {o.about.split(/\n\s*\n/).map((p, i) => (
        <p key={i} className={styles.about}>
          {p.trim()}
        </p>
      ))}
      {o.does.length > 0 && (
        <>
          <h2>What you’ll do</h2>
          <ul>
            {o.does.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      {o.needs.length > 0 && (
        <>
          <h2>What we’re looking for</h2>
          <ul>
            {o.needs.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      <h2 id="apply">Apply</h2>
      {/* TURNSTILE_SITE_KEY (web.env) is read per request, as on the waitlist, so one build serves any key. */}
      <ApplyForm action={apply.bind(null, o.slug)} turnstile={process.env.TURNSTILE_SITE_KEY} />
    </>
  );
}
