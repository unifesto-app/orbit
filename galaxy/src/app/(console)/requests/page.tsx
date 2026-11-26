import { HOST_KINDS, REQUEST_STATUSES, type RequestStatus, type StaffEventRequest } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, Pages, phone, ui } from "../../ui";
import { STATUS_LABELS, time } from "./status";

// Event Requests (Hosts flow, H1.5; API: GET /galaxy/event-requests), for holders of Hosts: people asking to
// host, oldest first so the longest waiting is answered first. Contacts come masked.
export const metadata: Metadata = { title: "Requests" };

type List = { requests: StaffEventRequest[]; total: number; page: number; pageSize: number };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function Requests({ searchParams }: PageProps<"/requests">) {
  return (
    <div className={ui.page}>
      <PageHeader title="Requests" description="People asking to host on Orbit, oldest first." />
      <Suspense fallback={<nav aria-label="Request status" className={ui.tabs} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/requests">, "searchParams">) {
  const sp = await searchParams;
  const raw = first(sp.status);
  const status: RequestStatus = REQUEST_STATUSES.includes(raw as RequestStatus) ? (raw as RequestStatus) : "open";
  const page = first(sp.page) ?? "1"; // the API answers page 1 for anything it can't read
  const r = await read<List>(`/galaxy/event-requests?status=${status}&page=${encodeURIComponent(page)}`);

  return (
    <>
      <nav aria-label="Request status" className={ui.tabs}>
        {REQUEST_STATUSES.map((s) => (
          <Link key={s} href={`/requests?status=${s}`} prefetch={false} className={ui.tab} aria-current={s === status ? "page" : undefined}>
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>
      {!r.ok ? (
        <Alert>{r.error.message}</Alert>
      ) : (
        <Container title={STATUS_LABELS[status]} count={r.data.total}>
          {r.data.requests.length === 0 ? (
            <p className={ui.secondary}>No requests here.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Kind</th>
                  <th>City</th>
                  <th>First event</th>
                  <th>Sent by</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {r.data.requests.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link href={`/requests/${q.id}`} prefetch={false}>
                        {q.host.name}
                      </Link>
                    </td>
                    <td>{HOST_KINDS[q.host.kind] ?? q.host.kind}</td>
                    <td>{q.host.city}</td>
                    <td>{q.event ? `${q.event.title}, ${time(q.event.startsAt)}` : <span className={ui.secondary}>Host only</span>}</td>
                    <td>{q.user.name ?? (q.user.phone ? phone(q.user.phone) : q.user.email) ?? "No name yet"}</td>
                    <td>{time(q.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pages path={`/requests?status=${status}`} {...r.data} />
        </Container>
      )}
    </>
  );
}
