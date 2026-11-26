import { categories, HOST_KINDS, type StaffEventRequest } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, Container, PageHeader, Pairs, phone, ui } from "../../../ui";
import { Act } from "../../act";
import { approveRequest, askChanges, declineRequest } from "../../actions";
import { RequestBadge, time } from "../status";

// One Event Request (Hosts flow, H1.5; API: GET /galaxy/event-requests/:id). Approve makes the host (live, Unverified)
// and its first event as a draft; asking for changes or declining sends the reason to the requester. The API refuses
// staff their own request.
export const metadata: Metadata = { title: "Request" };

export default function RequestPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <Suspense fallback={null}>
      <Request params={params} />
    </Suspense>
  );
}

async function Request({ params }: Pick<PageProps<"/requests/[id]">, "params">) {
  const { id } = await params;
  const [r, viewer] = await Promise.all([read<StaffEventRequest>(`/galaxy/event-requests/${encodeURIComponent(id)}`), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const q = r.data;
  const e = q.event;
  // A person's page is People's; holders of Hosts alone see the name.
  const people = viewer.ok && !!viewer.data.staff?.features.includes("people");
  // The API refuses a staff member answering their own request (403 self); hide the buttons too.
  const own = viewer.ok && viewer.data.id === q.user.id;
  const name = q.user.name ?? "No name yet";
  const toldThem = "The requester sees this";

  const pairs: [string, ReactNode][] = [
    ["Status", <RequestBadge key="s" status={q.status} />],
    ["Sent by", people ? <Link href={`/users/${q.user.id}`} prefetch={false}>{name}</Link> : name],
    ["Phone", q.user.phone && phone(q.user.phone)],
    ["Email", q.user.email],
    ["Last changed", time(q.updatedAt)],
    ["Answered", q.decidedAt && time(q.decidedAt)],
  ];
  if (q.note) pairs.push(["Reason given", q.note]);
  // No prefetch: opening a host's page is written to the audit log.
  if (q.hostId) pairs.push(["Host", <Link key="h" href={`/hosts/${q.hostId}`} prefetch={false}>Open the new host</Link>]);

  return (
    <div className={ui.page}>
      <PageHeader title={q.host.name} description={`Sent ${time(q.createdAt)}`} />

      <Container title="Request">
        <Pairs pairs={pairs} />
      </Container>

      <Container title="Host">
        <Pairs
          pairs={[
            ["Name", q.host.name],
            ["Kind", HOST_KINDS[q.host.kind] ?? q.host.kind],
            ["City", q.host.city],
            ["About", q.host.about],
          ]}
        />
      </Container>

      <Container title="First event">
        {e ? (
          <Pairs
            pairs={[
              ["Title", e.title],
              ["Category", categories.find((c) => c.slug === e.category)?.label ?? e.category],
              ["Starts", time(e.startsAt)],
              ["Venue", e.venue],
              ["Tickets", e.paid ? "Paid" : "Free"],
              ["Expected size", e.expectedSize?.toLocaleString("en-IN")],
            ]}
          />
        ) : (
          <p className={ui.secondary}>Host only, no event yet.</p>
        )}
      </Container>

      {!own && (q.status === "open" || q.status === "changes") && (
        <Container title="Actions">
          <div className={ui.page}>
            {q.status === "open" && (
              <>
                <Act label="Approve" action={approveRequest} hidden={{ id: q.id }} who="Staff see this; the requester doesn't" />
                <Act label="Ask for changes" action={askChanges} hidden={{ id: q.id }} who={toldThem} />
              </>
            )}
            <Act label="Decline" action={declineRequest} hidden={{ id: q.id }} who={toldThem} />
          </div>
        </Container>
      )}
    </div>
  );
}
