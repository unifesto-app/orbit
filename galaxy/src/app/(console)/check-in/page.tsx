import type { CheckInEvents } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, Pages, ui } from "../../ui";
import { time } from "../requests/status";

// Check-in (X5; API: GET /galaxy/check-in), for holders of Hosts: events whose door is open (24 hours before the start
// to 3 hours after the end) or that ended in the last 7 days, booked seats against how many came in.
export const metadata: Metadata = { title: "Check-in" };

const rate = (booked: number, inside: number) => (booked ? `${Math.round((inside / booked) * 100)}%` : "–");

export default function CheckIn({ searchParams }: PageProps<"/check-in">) {
  return (
    <div className={ui.page}>
      <PageHeader title="Check-in" description="Events with their door open, or closed in the last 7 days." />
      <Suspense fallback={null}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/check-in">, "searchParams">) {
  const raw = (await searchParams).page;
  const page = (Array.isArray(raw) ? raw[0] : raw) ?? "1";
  const r = await read<CheckInEvents>(`/galaxy/check-in?page=${encodeURIComponent(page)}`);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return (
    <Container title="Events" count={r.data.total}>
      {r.data.events.length === 0 ? (
        <p className={ui.secondary}>No doors open, and none closed this week.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Host</th>
              <th>Starts</th>
              <th>Booked</th>
              <th>In</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {r.data.events.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/check-in/${e.id}`} prefetch={false}>
                    {e.title}
                  </Link>
                </td>
                <td>{e.hostName}</td>
                <td>{time(e.startsAt)}</td>
                <td>{e.booked}</td>
                <td>{e.in}</td>
                <td>{rate(e.booked, e.in)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pages path="/check-in" {...r.data} />
    </Container>
  );
}
