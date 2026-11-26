import { REPORT_REASON_LABELS, type StaffReportDetail } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, Container, PageHeader, Pairs, phone, ui } from "../../../ui";
import { Act } from "../../act";
import { dismissReport, resolveReport } from "../../actions";
import { time } from "../../requests/status";
import { ReportBadge } from "../status";

// One report (X15; API: GET /galaxy/reports/:id). Resolve or dismiss only closes it; acting on the event or host
// (unpublish, cancel, suspend) is on that event's or host's own page, linked here.
export const metadata: Metadata = { title: "Report" };

export default function ReportPage({ params }: PageProps<"/reports/[id]">) {
  return (
    <Suspense fallback={null}>
      <Report params={params} />
    </Suspense>
  );
}

async function Report({ params }: Pick<PageProps<"/reports/[id]">, "params">) {
  const { id } = await params;
  const [r, viewer] = await Promise.all([read<StaffReportDetail>(`/galaxy/reports/${encodeURIComponent(id)}`), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const q = r.data;
  // A person's page is People's; holders of Queues alone see the name.
  const people = viewer.ok && !!viewer.data.staff?.features.includes("people");
  const name = q.reporter.name ?? "No name yet";
  const kind = q.subject.kind === "event" ? "Event" : "Host";
  // No prefetch: opening a host's page is written to the audit log.
  const subject = (
    <Link href={`/${q.subject.kind === "event" ? "events" : "hosts"}/${q.subject.id}`} prefetch={false}>
      {q.subject.name}
    </Link>
  );

  const pairs: [string, ReactNode][] = [
    ["Status", <ReportBadge key="s" status={q.status} />],
    [kind, subject],
    ["Link", `heyorbit.in/${q.subject.kind}/${q.subject.slug}`],
    ["Reason", REPORT_REASON_LABELS[q.reason]],
    ["Their note", q.note],
    ["Open reports on it", String(q.openOnSubject)],
    ["Sent by", people ? <Link href={`/users/${q.reporter.id}`} prefetch={false}>{name}</Link> : name],
    ["Phone", q.reporter.phone && phone(q.reporter.phone)],
    ["Email", q.reporter.email],
    ["Decided", q.decidedAt && `${time(q.decidedAt)}${q.decidedBy ? ` by ${q.decidedBy.name ?? "staff"}` : ""}`],
    ["Staff note", q.staffNote],
  ];

  return (
    <div className={ui.page}>
      <PageHeader title={q.subject.name} description={`${kind} reported ${time(q.createdAt)}`} />

      <Container title="Report">
        <Pairs pairs={pairs} />
      </Container>

      {q.status === "open" && (
        <Container title="Actions">
          <div className={ui.page}>
            <p className={ui.secondary}>To unpublish, cancel or suspend, open the {kind.toLowerCase()}&apos;s page: {subject}.</p>
            <Act label="Resolve" action={resolveReport} hidden={{ id: q.id }} who="Staff see this; the reporter doesn't" optional />
            <Act label="Dismiss" action={dismissReport} hidden={{ id: q.id }} who="Staff see this; the reporter doesn't" optional />
          </div>
        </Container>
      )}
    </div>
  );
}
