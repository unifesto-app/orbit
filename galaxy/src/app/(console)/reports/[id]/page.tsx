import { REPORT_REASON_LABELS, type StaffReportDetail } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, Container, PageHeader, Pairs, phone, ui } from "../../../ui";
import { Act } from "../../act";
import { dismissReport, resolveReport } from "../../actions";
import { time } from "../../requests/status";
import { KINDS, ReportBadge } from "../status";

// One report (X15; API: GET /galaxy/reports/:id). Resolve or dismiss only closes it; acting on the event or host
// (unpublish, cancel, suspend) is on that event's or host's own page, linked here. A person in a room is acted on in
// that room's page (remove the card, bar from rooms), linked to their card.
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
  // The event's and host's pages are Hosts'; holders of Queues alone see the name.
  const hostsToo = viewer.ok && !!viewer.data.staff?.features.includes("hosts");
  const name = q.reporter.name ?? "No name yet";
  const s = q.subject;
  const kind = KINDS[s.kind];
  // No prefetch: opening a host's page is written to the audit log.
  const subject = hostsToo ? (
    <Link href={`/${s.kind === "host" ? "hosts" : "events"}/${q.subject.id}`} prefetch={false}>
      {q.subject.name}
    </Link>
  ) : (
    q.subject.name
  );

  // Rooms are Queues', so anyone here may open one. No prefetch: opening a room is written to the audit log.
  const room =
    s.kind === "person" ? (
      <Link href={`/rooms/${s.id}${s.person.memberId ? `#${s.person.memberId}` : ""}`} prefetch={false}>
        {s.person.memberId ? "Their card in the room" : "The room"}
      </Link>
    ) : null;
  const personName = s.kind === "person" ? (s.person.name ?? "No name yet") : "";

  const pairs: [string, ReactNode][] = [
    ["Status", <ReportBadge key="s" status={q.status} />],
    ...((s.kind === "person"
      ? [
          ["Person", people ? <Link href={`/users/${s.person.userId}`} prefetch={false}>{personName}</Link> : personName],
          ["Their card", s.person.line ?? "Gone with their account"],
          ["Room", room],
          ["Event", subject],
        ]
      : [[kind, subject]]) as [string, ReactNode][]),
    ["Link", `heyorbit.in/${s.kind === "host" ? "host" : "event"}/${q.subject.slug}`],
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
      <PageHeader title={s.kind === "person" ? `${personName} in ${s.name}` : s.name} description={`${kind} reported ${time(q.createdAt)}`} />

      <Container title="Report">
        <Pairs pairs={pairs} />
      </Container>

      {q.status === "open" && (
        <Container title="Actions">
          <div className={ui.page}>
            <p className={ui.secondary}>
              {s.kind === "person" ? (
                <>To remove their card or bar them from rooms, open {room}.</>
              ) : hostsToo ? (
                <>
                  To unpublish, cancel or suspend, open the {kind.toLowerCase()}&apos;s page: {subject}.
                </>
              ) : (
                "Ask someone with Hosts to act on it."
              )}
            </p>
            <Act label="Resolve" action={resolveReport} hidden={{ id: q.id }} who="Staff see this; the reporter doesn't" optional />
            <Act label="Dismiss" action={dismissReport} hidden={{ id: q.id }} who="Staff see this; the reporter doesn't" optional />
          </div>
        </Container>
      )}
    </div>
  );
}
