import type { StaffVenues } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Badge, Container, PageHeader, phone, ui } from "../../ui";
import { time } from "../requests/status";

// Venues (X9; API: GET /galaxy/venues), for holders of Hosts: every Venue host, A to Z. An approved venue request makes
// the host; Play Partner's setup adds the address, hours and stations, so until then it's Setup pending.
export const metadata: Metadata = { title: "Venues" };

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;

export default function Venues() {
  return (
    <div className={ui.page}>
      <PageHeader title="Venues" description="Every venue on Orbit, set up or waiting for setup in Play Partner." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const r = await read<StaffVenues>("/galaxy/venues");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const all = r.data.venues;
  return (
    <Container title="All" count={all.length}>
      {all.length === 0 ? (
        <p className={ui.secondary}>No venues yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Venue</th>
              <th>Status</th>
              <th>Area</th>
              <th>Desk phone</th>
              <th>Stations</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {all.map(({ host, venue, stations }) => (
              <tr key={host.id}>
                <td>
                  {/* No prefetch: opening a host's page is written to the audit log. */}
                  <Link href={`/hosts/${host.id}`} prefetch={false}>
                    {host.name}
                  </Link>
                </td>
                <td>{venue ? <Badge tone="success">Live</Badge> : <Badge tone="warning">Setup pending</Badge>}</td>
                <td>{venue ? `${venue.area}, ${host.city}` : host.city}</td>
                <td>{venue ? phone(venue.deskPhone) : "–"}</td>
                <td>
                  {stations.length === 0 ? (
                    <span className={ui.secondary}>None yet</span>
                  ) : (
                    stations.map((s) => (
                      <div key={s.id} className={s.archived ? ui.secondary : undefined}>
                        {`${s.name} · ${s.count} ${s.unit} · ${rupees(s.pricePaise)} an hour${s.archived ? " · Archived" : ""}`}
                      </div>
                    ))
                  )}
                </td>
                <td>{time(host.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Container>
  );
}
