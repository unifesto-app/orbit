import { EVENT_STATUSES, type EventStatus, type StaffEvents } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, Pages, ui } from "../../ui";
import { time } from "../requests/status";
import { EventBadge, STATUS_LABELS } from "./status";

// Events (X1; API: GET /galaxy/events), for holders of Hosts: every host's events, newest first, by status, and one
// host's alone from its name in the table.
export const metadata: Metadata = { title: "Events" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function Events({ searchParams }: PageProps<"/events">) {
  return (
    <div className={ui.page}>
      <PageHeader title="Events" description="Every host's events, newest first." />
      <Suspense fallback={<nav aria-label="Event status" className={ui.tabs} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/events">, "searchParams">) {
  const sp = await searchParams;
  const raw = first(sp.status);
  const status = EVENT_STATUSES.includes(raw as EventStatus) ? (raw as EventStatus) : null;
  const host = first(sp.host) ?? null;
  const page = first(sp.page) ?? "1"; // the API answers page 1 for anything it can't read
  const query = (s: EventStatus | null) => new URLSearchParams({ ...(s && { status: s }), ...(host && { host }) }).toString();
  const r = await read<StaffEvents>(`/galaxy/events?${query(status)}&page=${encodeURIComponent(page)}`);
  const at = (s: EventStatus | null) => `/events${query(s) && `?${query(s)}`}`;

  return (
    <>
      <nav aria-label="Event status" className={ui.tabs}>
        {[null, ...EVENT_STATUSES].map((s) => (
          <Link key={s ?? "all"} href={at(s)} prefetch={false} className={ui.tab} aria-current={s === status ? "page" : undefined}>
            {s ? STATUS_LABELS[s] : "All"}
          </Link>
        ))}
      </nav>
      {!r.ok ? (
        <Alert>{r.error.message}</Alert>
      ) : (
        <Container title={host && r.data.events[0] ? r.data.events[0].host.name : status ? STATUS_LABELS[status] : "All"} count={r.data.total}>
          {host && (
            <p>
              <Link href={status ? `/events?status=${status}` : "/events"} prefetch={false}>
                Every host
              </Link>
            </p>
          )}
          {r.data.events.length === 0 ? (
            <p className={ui.secondary}>No events here.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Host</th>
                  <th>Status</th>
                  <th>Starts</th>
                  <th>City</th>
                  <th>Tickets sold</th>
                  <th>Made</th>
                </tr>
              </thead>
              <tbody>
                {r.data.events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/events/${e.id}`} prefetch={false}>
                        {e.title}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/events?${new URLSearchParams({ ...(status && { status }), host: e.host.id })}`} prefetch={false}>
                        {e.host.name}
                      </Link>
                    </td>
                    <td>
                      <EventBadge status={e.status} />
                    </td>
                    <td>{e.startsAt ? time(e.startsAt) : <span className={ui.secondary}>Not set</span>}</td>
                    <td>{e.city ?? "–"}</td>
                    <td>{e.sold.toLocaleString("en-IN")}</td>
                    <td>{time(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pages path={at(status)} {...r.data} />
        </Container>
      )}
    </>
  );
}
