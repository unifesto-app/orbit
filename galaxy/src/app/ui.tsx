import type { StaffFeature } from "@orbit/contract";
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
