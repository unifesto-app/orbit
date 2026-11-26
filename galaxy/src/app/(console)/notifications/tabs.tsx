import type { Channel, GalaxyKind } from "@orbit/contract";
import Link from "next/link";
import { PageHeader, ui } from "../../ui";

// Notifications' pages, each its own address, as the PM board's tabs. Kinds and the log open to Platform or People; Wording to Platform.
const TABS = [
  { key: "kinds", label: "Kinds", href: "/notifications" },
  { key: "log", label: "Delivery log", href: "/notifications/log" },
  { key: "wording", label: "Wording", href: "/notifications/wording" },
] as const;

export function NotificationsHeader({ current, description }: { current: (typeof TABS)[number]["key"]; description: string }) {
  return (
    <>
      <PageHeader title="Notifications" description={description} />
      <nav aria-label="Notifications" className={ui.tabs}>
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} prefetch={false} className={ui.tab} aria-current={t.key === current ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
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

// "hostAnnouncement" as "Host announcement".
export const kindName = (kind: string) => {
  const s = kind.replace(/([A-Z])/g, " $1").toLowerCase();
  return s[0]!.toUpperCase() + s.slice(1);
};
