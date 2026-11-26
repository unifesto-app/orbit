import type { Channel, GalaxyKind } from "@orbit/contract";
import Link from "next/link";
import { Suspense } from "react";
import { me } from "../../../api";
import { PageHeader, ui } from "../../ui";

// Notifications' pages, each its own address, as the PM board's tabs. Kinds and the log open to Platform or People;
// Wording to Platform only, so its tab shows to them alone.
const TABS = [
  { key: "kinds", label: "Kinds", href: "/notifications" },
  { key: "log", label: "Delivery log", href: "/notifications/log" },
  { key: "wording", label: "Wording", href: "/notifications/wording" },
] as const;
type Key = (typeof TABS)[number]["key"];

const Tab = ({ t, current }: { t: (typeof TABS)[number]; current: Key }) => (
  <Link href={t.href} prefetch={false} className={ui.tab} aria-current={t.key === current ? "page" : undefined}>
    {t.label}
  </Link>
);
async function WordingTab({ current }: { current: Key }) {
  const who = await me();
  return who.ok && who.data.staff?.features.includes("platform") ? <Tab t={TABS[2]} current={current} /> : null;
}

export function NotificationsHeader({ current, description }: { current: Key; description: string }) {
  return (
    <>
      <PageHeader title="Notifications" description={description} />
      <nav aria-label="Notifications" className={ui.tabs}>
        <Tab t={TABS[0]} current={current} />
        <Tab t={TABS[1]} current={current} />
        <Suspense fallback={null}>
          <WordingTab current={current} />
        </Suspense>
      </nav>
    </>
  );
}

// The catalog's groups, in order, with their titles.
export const GROUPS: [GalaxyKind["group"], string][] = [
  ["account", "Account"],
  ["booking", "Booking and tickets"],
  ["events", "Events you hold a ticket for"],
  ["following", "Following and from Orbit"],
  ["host", "Host apps"],
  ["staff", "Galaxy staff"],
];
export const CHANNEL_NAMES: Record<Channel, string> = { email: "Email", push: "Push", inbox: "Inbox" };
export { kindName } from "./kind-name";
