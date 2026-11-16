import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { me, read } from "../../../api";
import { HostStatus } from "../hosts/status";
import { People } from "../people";
import { Alert, Container, day, Pages, ui } from "../../ui";

// Team members (Galaxy flow, Hosts; API: GET /galaxy/teams), for holders of Hosts and events: everyone on a host's
// team, newest first. Admin is the only role so far; Curator, Co-curator and Crew join with the Hosts flow's roles.
export const metadata: Metadata = { title: "Team members" };

type Seat = { id: string; userId: string; name: string | null; role: string; since: string; hostId: string; host: string; status: string; owner: boolean };
type Seats = { seats: Seat[]; total: number; page: number; pageSize: number };

export default function Teams({ searchParams }: PageProps<"/teams">) {
  return (
    <div className={ui.page}>
      <People current="teams" description="Everyone on a host's team, newest first." />
      <Suspense fallback={null}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function List({ searchParams }: Pick<PageProps<"/teams">, "searchParams">) {
  const raw = (await searchParams).page;
  const page = Array.isArray(raw) ? raw[0] : raw; // the API answers page 1 for anything it can't read
  const [r, viewer] = await Promise.all([read<Seats>(`/galaxy/teams?page=${encodeURIComponent(page ?? "1")}`), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  // A person's page is People's; holders of Hosts alone see the name.
  const people = viewer.ok && !!viewer.data.staff?.features.includes("people");

  return (
    <Container title="Team members" count={r.data.total}>
      {r.data.seats.length === 0 ? (
        <p className={ui.secondary}>No host has a team yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Host</th>
              <th>Role</th>
              <th>Since</th>
              <th>Host status</th>
            </tr>
          </thead>
          <tbody>
            {r.data.seats.map((s) => (
              <tr key={s.id}>
                <td>
                  {/* No prefetch: opening a person's or a host's page is written to the audit log. */}
                  {people ? (
                    <Link href={`/users/${s.userId}`} prefetch={false}>
                      {s.name ?? "No name yet"}
                    </Link>
                  ) : (
                    (s.name ?? "No name yet")
                  )}
                </td>
                <td>
                  <Link href={`/hosts/${s.hostId}`} prefetch={false}>
                    {s.host}
                  </Link>
                </td>
                <td>
                  {s.role[0]!.toUpperCase() + s.role.slice(1)}
                  {s.owner && ", Owner"}
                </td>
                <td>{day(s.since)}</td>
                <td>
                  <HostStatus status={s.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pages path="/teams" {...r.data} />
    </Container>
  );
}
