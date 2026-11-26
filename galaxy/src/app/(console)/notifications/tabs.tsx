import Link from "next/link";
import { PageHeader, ui } from "../../ui";

// Notifications' two pages, each its own address, as the PM board's tabs. Holders of Platform or People open both.
const TABS = [
  { key: "kinds", label: "Kinds", href: "/notifications" },
  { key: "log", label: "Delivery log", href: "/notifications/log" },
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

// "hostAnnouncement" as "Host announcement".
export const kindName = (kind: string) => {
  const s = kind.replace(/([A-Z])/g, " $1").toLowerCase();
  return s[0]!.toUpperCase() + s.slice(1);
};
