import type { Metadata } from "next";
import Link from "next/link";

// The root not-found ships with every route, so it stays a Server Component with no client JS.
export const metadata: Metadata = { title: "Page not found · Orbit" };

export default function NotFound() {
  return (
    <main className="nf-wrap">
      <div className="nf-orbit" aria-hidden="true">
        <span className="nf-ring"><span className="nf-dot" /></span>
        <span className="nf-code">404</span>
      </div>
      <h1 className="nf-title">This page is out of orbit</h1>
      <p className="nf-text">The link may be old or mistyped, or the event may have ended.</p>
      <Link href="/" className="button">Back to Discover</Link>
    </main>
  );
}
