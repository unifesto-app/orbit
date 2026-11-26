import { REPORT_REASON_LABELS, REPORT_STATUSES, type ReportStatus, type StaffReportList } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, phone, ui } from "../../ui";
import { time } from "../requests/status";
import { STATUS_LABELS } from "./status";

// Reports (X15; API: GET /galaxy/reports), for holders of Queues: people flagging an event or a host from its page in
// the app, newest first. Contacts come masked.
export const metadata: Metadata = { title: "Reports" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function Reports({ searchParams }: PageProps<"/reports">) {
  return (
    <div className={ui.page}>
      <PageHeader title="Reports" description="Events and hosts people flagged in the app, newest first." />
      <Suspense fallback={<nav aria-label="Report status" className={ui.tabs} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/reports">, "searchParams">) {
  const raw = first((await searchParams).status);
  const status: ReportStatus = REPORT_STATUSES.includes(raw as ReportStatus) ? (raw as ReportStatus) : "open";
  const r = await read<StaffReportList>(`/galaxy/reports?status=${status}`);

  return (
    <>
      <nav aria-label="Report status" className={ui.tabs}>
        {REPORT_STATUSES.map((s) => (
          <Link key={s} href={`/reports?status=${s}`} prefetch={false} className={ui.tab} aria-current={s === status ? "page" : undefined}>
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>
      {!r.ok ? (
        <Alert>{r.error.message}</Alert>
      ) : (
        <Container title={STATUS_LABELS[status]} count={r.data.reports.length}>
          {r.data.reports.length === 0 ? (
            <p className={ui.secondary}>No reports here.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>About</th>
                  <th>Kind</th>
                  <th>Reason</th>
                  <th>Open on it</th>
                  <th>Sent by</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {r.data.reports.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link href={`/reports/${q.id}`} prefetch={false}>
                        {q.subject.name}
                      </Link>
                    </td>
                    <td>{q.subject.kind === "event" ? "Event" : "Host"}</td>
                    <td>{REPORT_REASON_LABELS[q.reason]}</td>
                    <td>{q.openOnSubject}</td>
                    <td>{q.reporter.name ?? (q.reporter.phone ? phone(q.reporter.phone) : q.reporter.email) ?? "No name yet"}</td>
                    <td>{time(q.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Container>
      )}
    </>
  );
}
