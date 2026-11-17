import Link from "next/link";
import { Suspense } from "react";
import { me } from "../../../api";
import { PageHeader, ui } from "../../ui";

// The PM board's three pages (owner, 17 Nov 2026), each its own address so leaving Connect Claude unmounts it and
// drops a token shown there. Connect Claude is the platform owner's alone.
const TABS = [
  { key: "board", label: "Board", href: "/pm-board" },
  { key: "activity", label: "Activity", href: "/pm-board/activity" },
  { key: "connect", label: "Connect Claude", href: "/pm-board/connect", owner: true },
] as const;
export type PmTab = (typeof TABS)[number]["key"];

export function PmHeader({ current, description }: { current: PmTab; description: string }) {
  return (
    <>
      <PageHeader title="PM board" description={description} />
      <Suspense fallback={<nav aria-label="PM board" className={ui.tabs} />}>
        <Tabs current={current} />
      </Suspense>
    </>
  );
}

async function Tabs({ current }: { current: PmTab }) {
  const r = await me();
  const owner = r.ok && !!r.data.staff?.owner;
  return (
    <nav aria-label="PM board" className={ui.tabs}>
      {TABS.filter((t) => !("owner" in t) || owner).map((t) => (
        <Link key={t.key} href={t.href} className={ui.tab} aria-current={t.key === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
