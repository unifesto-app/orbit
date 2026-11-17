import type { StaffFeature } from "@orbit/contract";
import Link from "next/link";
import { Suspense } from "react";
import { me } from "../../api";
import { PageHeader, ui } from "../ui";

// Every kind of person on Orbit on one People screen, a text tab each, as AWS's tabs are (owner, 17 Nov 2026: "One
// People screen"; icons dropped the same day: "dont use icons always. same like aws"). A kind with no data yet is a
// disabled tab saying what brings it. Guests a host adds are attendees, and special guests on an event page are
// speakers, so there's no Guests tab.
// Each viewer sees only the tabs their staff features open (owner: "Hide them"); `needs` is any one of them, as the
// API's requireFeature reads it.
type Kind = { key: string; label: string; needs: StaffFeature[] } & ({ href: string } | { later: string });

const KINDS: Kind[] = [
  { key: "users", label: "Users", needs: ["people", "staff"], href: "/users" },
  { key: "hosts", label: "Hosts", needs: ["hosts"], href: "/hosts" },
  { key: "venues", label: "Venues", needs: ["hosts"], later: "Turf, courts and gaming cafés come with slots." },
  { key: "artists", label: "Artists", needs: ["hosts"], later: "Bands and comedians come with performer profiles." },
  { key: "teams", label: "Team members", needs: ["hosts"], href: "/teams" },
  { key: "speakers", label: "Speakers", needs: ["hosts"], later: "Speakers, mentors, judges and special guests come with events." },
  { key: "attendees", label: "Attendees", needs: ["people"], later: "People who booked, and guests a host adds, come with bookings." },
  { key: "staff", label: "Staff", needs: ["staff"], href: "/staff" },
];

export type PeopleKind = "users" | "hosts" | "teams" | "staff";

// The first tab a viewer can open, for someone who lands on one they can't.
export const firstTab = (features: readonly StaffFeature[]) =>
  KINDS.find((k) => "href" in k && k.needs.some((f) => features.includes(f))) as { href: string } | undefined;

export function People({ current, description }: { current: PeopleKind; description: string }) {
  return (
    <>
      <PageHeader title="People" description={description} />
      {/* The tabs wait for who's viewing; an empty bar holds their place. */}
      <Suspense fallback={<nav aria-label="Kinds of people" className={ui.tabs} />}>
        <Tabs current={current} />
      </Suspense>
    </>
  );
}

async function Tabs({ current }: { current: PeopleKind }) {
  const r = await me();
  const features = r.ok ? (r.data.staff?.features ?? []) : [];
  return (
    <nav aria-label="Kinds of people" className={ui.tabs}>
      {KINDS.filter((k) => k.needs.some((f) => features.includes(f))).map((k) =>
        "href" in k ? (
          // No prefetch: Users and Staff are written to the audit log when opened.
          <Link key={k.key} href={k.href} prefetch={false} className={ui.tab} aria-current={k.key === current ? "page" : undefined}>
            {k.label}
          </Link>
        ) : (
          <span key={k.key} className={ui.tab} aria-disabled="true" title={k.later}>
            {k.label}
          </span>
        ),
      )}
    </nav>
  );
}
