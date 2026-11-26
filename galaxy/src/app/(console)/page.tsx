import type { DashboardStats } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { read } from "../../api";
import { Alert, Container, PageHeader, Pairs, ui } from "../ui";
import { Days } from "./charts";
import c from "./charts.module.css";
import { inr } from "./money/tabs";

// The Dashboard (owner, 19 Nov 2026: "remove all in dashboard page", "add Analytics, Traction and all"): Orbit's traction
// at a glance, in place of the old list of sections (the side nav has those). API: GET /galaxy/dashboard, which sends
// only the blocks this staff member's features open; each read is written to the audit log.

// The layout's "%s | Galaxy" template skips its own segment, so spell it out.
export const metadata: Metadata = { title: { absolute: "Dashboard | Galaxy" } };

export default function Dashboard() {
  return (
    <div className={ui.page}>
      <PageHeader title="Dashboard" description="Orbit’s traction at a glance. Days are India’s; a week is the last 7 days, today included." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

const n = (v: number) => v.toLocaleString("en-IN");
const pct = (part: number, of: number) => (of ? `${Math.round((part / of) * 100)}%` : "–");
// This week against the 7 days before it: "+25% on last week", "Same as last week", "None last week".
const change = (week: number, prev: number) =>
  prev === 0 ? (week ? "None last week" : "None last week either") : week === prev ? "Same as last week" : `${week > prev ? "+" : "−"}${Math.round((Math.abs(week - prev) / prev) * 100)}% on last week`;

function Tiles({ tiles }: { tiles: [string, string, string?][] }) {
  return (
    <div className={c.tiles}>
      {tiles.map(([label, value, note]) => (
        <div key={label} className={c.tile}>
          <span className={ui.secondary}>{label}</span>
          <span className={c.tileValue}>{value}</span>
          {note && <span className={ui.secondary}>{note}</span>}
        </div>
      ))}
    </div>
  );
}

// No prefetch: opening Prelaunch or Website is written to the audit log.
const More = ({ href, label }: { href: string; label: string }) => (
  <p>
    <Link href={href} prefetch={false}>
      {label}
    </Link>
  </p>
);

async function Body() {
  await connection(); // read on each visit: written to the audit log
  const r = await read<DashboardStats>("/galaxy/dashboard");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { people, waitlist, website, hosts, events, bookings, revenue, staff } = r.data;
  if (!people && !waitlist && !website && !hosts && !events && !bookings && !revenue && !staff)
    return (
      <Container title="Traction">
        <p className={ui.secondary}>Nothing here for your access yet: the Dashboard shows People, Hosts and events, Money and Staff numbers to those who hold them.</p>
      </Container>
    );

  // The numbers that say whether Orbit is growing, first.
  const traction: [string, string, string?][] = [
    ...(people
      ? ([
          ["Accounts", n(people.total), `+${n(people.today)} today`],
          ["New this week", n(people.week), change(people.week, people.prevWeek)],
          ["Active this week", n(people.active.week), `${n(people.active.day)} today`],
        ] as [string, string, string][])
      : []),
    ...(waitlist ? ([["Waitlist", n(waitlist.total), `+${n(waitlist.week)} this week`]] as [string, string, string][]) : []),
    ...(hosts ? ([["Hosts", n(hosts.total), `${n(hosts.verified)} verified`]] as [string, string, string][]) : []),
    ...(bookings ? ([["Bookings this week", n(bookings.week), change(bookings.week, bookings.prevWeek)]] as [string, string, string][]) : []),
    ...(revenue ? ([["Paid by buyers this week", inr(revenue.week), change(revenue.week, revenue.prevWeek)]] as [string, string, string][]) : []),
    ...(events ? ([["Events coming up", n(events.upcoming), `${n(events.week)} published this week`]] as [string, string, string][]) : []),
  ];

  return (
    <>
      {traction.length > 0 && (
        <Container title="Traction">
          <Tiles tiles={traction} />
          {people && (
            <>
              <p className={ui.secondary}>Sign-ups a day, the last 30 days</p>
              <Days days={people.days} label="Sign-ups a day, last 30 days" series="Signed up" />
            </>
          )}
        </Container>
      )}

      <div className={c.grid}>
        {waitlist && (
          <Container title="Waitlist">
            <Tiles
              tiles={[
                ["On the list", n(waitlist.total)],
                ["Joined today", n(waitlist.today)],
                ["This week", n(waitlist.week), change(waitlist.week, waitlist.prevWeek)],
              ]}
            />
            <Days days={waitlist.days} label="Waitlist joins a day, last 30 days" series="Joined" />
            <More href="/prelaunch" label="Everyone on the waitlist, and what they want ›" />
          </Container>
        )}

        {website && (
          <Container title="Website, last 7 days">
            <Tiles
              tiles={[
                ["Visitors", n(website.visitors)],
                ["Page views", n(website.views)],
                ["Joined the waitlist", n(website.joined), `${pct(website.joined, website.visitors)} of visitors`],
              ]}
            />
            <p className={c.note}>From heyorbit.in’s own visit log: no cookies, and a visitor counts once a day.</p>
            <More href="/website" label="Visits, sources, pages and speed ›" />
          </Container>
        )}

        {people && (
          <Container title="Active people">
            <Pairs
              pairs={[
                ["Today so far (DAU)", n(people.active.day)],
                ["Last 7 days (WAU)", n(people.active.week)],
                ["Last 30 days (MAU)", n(people.active.month)],
                // How many of the month's people come back on a given day: the usual measure of stickiness.
                ["Stickiness", pct(people.active.day, people.active.month)],
              ]}
            />
            <p className={c.note}>People who used the app or site while signed in, from the activity log. Deleted accounts never count.</p>
            <More href="/analytics" label="Daily use, retention, platforms and more ›" />
          </Container>
        )}

        {(hosts || events) && (
          <Container title="Hosts and events">
            <Pairs
              pairs={[
                ...(hosts
                  ? ([
                      ["Hosts", n(hosts.total)],
                      ["Verified", `${n(hosts.verified)} (${pct(hosts.verified, hosts.total)})`],
                      ["New this week", n(hosts.week)],
                      ["Follows", n(hosts.follows)],
                    ] as [string, string][])
                  : []),
                ...(events
                  ? ([
                      ["Events coming up", n(events.upcoming)],
                      ["Published this week", n(events.week)],
                      ["Drafts", n(events.drafts)],
                      ["Cancelled", n(events.cancelled)],
                    ] as [string, string][])
                  : []),
              ]}
            />
          </Container>
        )}

        {(bookings || revenue) && (
          <Container title="Bookings and revenue">
            <Pairs
              pairs={[
                ...(bookings
                  ? ([
                      ["Confirmed bookings this week", n(bookings.week)],
                      ["Check-in rate, last 30 days", bookings.checkInRate === null ? "–" : `${Math.round(bookings.checkInRate * 100)}%`],
                    ] as [string, string][])
                  : []),
                ...(revenue
                  ? ([
                      ["Paid by buyers this week", inr(revenue.week)],
                      ["Orbit’s fees this week", inr(revenue.orbitWeek)],
                    ] as [string, string][])
                  : []),
              ]}
            />
            {/* Analytics is for People holders: no link for the rest. */}
            {people && <More href="/analytics" label={revenue ? "Bookings, check-in and revenue, last 30 days ›" : "Bookings and check-in, last 30 days ›"} />}
          </Container>
        )}

        {staff && (
          <Container title="Staff">
            <Pairs pairs={[["With access", n(staff.active)]]} />
          </Container>
        )}
      </div>
    </>
  );
}
