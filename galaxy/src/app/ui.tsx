import type { StaffFeature } from "@orbit/contract";
import Link from "next/link";
import type { ReactNode } from "react";
import ui from "./ui.module.css";

export { ui };

export function PageHeader({ title, count, description }: { title: string; count?: number; description?: string }) {
  return (
    <header className={ui.pageHeader}>
      <h1 className={ui.h1}>
        {title}
        {count !== undefined && <span className={ui.counter}> ({count})</span>}
      </h1>
      {description && <p className={ui.secondary}>{description}</p>}
    </header>
  );
}

export function Container({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className={ui.container}>
      <h2 className={ui.containerHeader}>
        {title}
        {count !== undefined && <span className={ui.counter}> ({count})</span>}
      </h2>
      <div className={ui.containerBody}>{children}</div>
    </section>
  );
}

// Staff features by the names the app's Galaxy uses (app/src/galaxy/data.ts).
export const FEATURE_NAMES: Record<StaffFeature, string> = {
  people: "People",
  hosts: "Hosts and events",
  queues: "Queues",
  money: "Money",
  platform: "Platform",
  staff: "Staff",
};

// "+919000000101" as Indian numbers are read, "+91 90000 00101". A masked one passes through.
export const phone = (e164: string) => e164.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");

// A day as staff read it, in India's time.
export const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

type Tone = "success" | "info" | "warning" | "error" | "neutral";
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${ui.badge} ${ui[tone]}`}>{children}</span>;
}

// The API's message when it says no.
export function Alert({ children }: { children?: string }) {
  return children ? (
    <p role="alert" className={ui.alert}>
      {children}
    </p>
  ) : null;
}

// AWS's key-value pairs, as on a resource's Details.
export function Pairs({ pairs }: { pairs: [string, ReactNode][] }) {
  return (
    <dl className={ui.pairs}>
      {pairs.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

// A list's pages under its table, on the right as AWS has them; only the page number goes in the address. No prefetch:
// some of Galaxy's lists are written to the audit log.
export function Pages({ path, total, page, pageSize }: { path: string; total: number; page: number; pageSize: number }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last === 1 && page === 1) return null;
  const sep = path.includes("?") ? "&" : "?"; // a path may carry its own query, as Requests' status
  return (
    <nav aria-label="Pages" className={`${ui.row} ${ui.pager}`}>
      {page > 1 && (
        // From past the end (an old link), straight back to the last page.
        <Link className={ui.btn} href={`${path}${sep}page=${Math.min(page - 1, last)}`} prefetch={false}>
          Previous
        </Link>
      )}
      <span className={ui.secondary}>
        Page {page} of {last}
      </span>
      {page < last && (
        <Link className={ui.btn} href={`${path}${sep}page=${page + 1}`} prefetch={false}>
          Next
        </Link>
      )}
    </nav>
  );
}
