import Link from "next/link";
import { Suspense } from "react";
import { me } from "../../../api";
import { PageHeader, ui } from "../../ui";

// Notifications' pages, each its own address, as the PM board's tabs. Holders of Platform or People open Kinds and the
// log; Broadcasts shows only to holders of Platform.
const TABS = [
  { key: "kinds", label: "Kinds", href: "/notifications" },
  { key: "log", label: "Delivery log", href: "/notifications/log" },
] as const;
const BROADCASTS = { key: "broadcasts", label: "Broadcasts", href: "/notifications/broadcasts" } as const;
type Tab = (typeof TABS)[number] | typeof BROADCASTS;

const TabLink = ({ t, current }: { t: Tab; current: Tab["key"] }) => (
  <Link href={t.href} prefetch={false} className={ui.tab} aria-current={t.key === current ? "page" : undefined}>
    {t.label}
  </Link>
);

async function BroadcastsTab({ current }: { current: Tab["key"] }) {
  const r = await me();
  return r.ok && r.data.staff?.features.includes("platform") ? <TabLink t={BROADCASTS} current={current} /> : null;
}

export function NotificationsHeader({ current, description }: { current: Tab["key"]; description: string }) {
  return (
    <>
      <PageHeader title="Notifications" description={description} />
      <nav aria-label="Notifications" className={ui.tabs}>
        {TABS.map((t) => (
          <TabLink key={t.key} t={t} current={current} />
        ))}
        <Suspense fallback={null}>
          <BroadcastsTab current={current} />
        </Suspense>
      </nav>
    </>
  );
}

// Its own file so the delivery log's client search can use it without this header's server read.
export { kindName } from "./kind-name";
