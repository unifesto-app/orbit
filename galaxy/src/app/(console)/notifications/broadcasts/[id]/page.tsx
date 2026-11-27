import type { Broadcast } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../../../api";
import { Alert, Badge, Container, Pairs, ui } from "../../../../ui";
import { Act } from "../../../act";
import { time } from "../../../requests/status";
import { NotificationsHeader } from "../../tabs";
import { cancelBroadcast } from "../actions";
import { Confirm } from "../forms";
import { channelNames, segmentName, STATUS, TYPES } from "../shared";

// "Goes to 1,240 people by push and email"; the inbox always gets it.
const preview = (b: Broadcast) =>
  `Goes to ${b.audienceCount.toLocaleString("en-IN")} ${b.audienceCount === 1 ? "person" : "people"} ${b.channels.length ? `by ${b.channels.join(" and ")}` : "in their inbox only"}`;

// One broadcast: its wording and audience, Confirm for a second Platform holder (the author only while no one else holds
// Platform: the API says so in canConfirm), Cancel while it is waiting, scheduled or part sent, and how far it has got
// (API: GET /galaxy/notifications/broadcasts/:id).
export const metadata: Metadata = { title: "Broadcast" };

export default function BroadcastPage({ params }: PageProps<"/notifications/broadcasts/[id]">) {
  return (
    <div className={ui.page}>
      <NotificationsHeader current="broadcasts" description="A message from Orbit to a segment. A second person with Platform confirms each one before it goes, or the author when no one else holds Platform." />
      <Suspense fallback={null}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await read<Broadcast>(`/galaxy/notifications/broadcasts/${encodeURIComponent(id)}`);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const b = r.data;
  const open = b.status === "waiting" || b.status === "scheduled" || b.status === "sending";
  return (
    <>
      <Container title={b.title}>
        <p>{b.text}</p>
        <Pairs
          pairs={[
            ["Status", <Badge key="s" tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Badge>],
            ["Type", TYPES[b.type]],
            ["To", segmentName(b.segment)],
            ["Channels", channelNames(b)],
            ["Audience", `${b.audienceCount.toLocaleString("en-IN")} people when written`],
            ["Progress", `${b.sent.toLocaleString("en-IN")} sent, ${b.failed.toLocaleString("en-IN")} failed`],
            ["Send", b.sendAt ? time(b.sendAt) : "Once confirmed"],
            ["Written by", `${b.author.name ?? "–"}, ${time(b.createdAt)}`],
            ["Confirmed by", b.confirmer ? (b.confirmer.name ?? "–") : b.autoSent ? "Sent after the 24 h wait" : "–"],
            ...(b.reason ? ([["Why cancelled", b.reason]] as [string, string][]) : []),
          ]}
        />
      </Container>
      {open && (
        <div className={ui.row}>
          {b.canConfirm && <Confirm id={b.id} preview={preview(b)} />}
          {b.status === "waiting" && !b.canConfirm && <span className={ui.secondary}>Someone else with Platform has to confirm it.</span>}
          <Act label="Cancel broadcast" action={cancelBroadcast} hidden={{ id: b.id }} who="Everyone with Platform sees this in the audit log" />
        </div>
      )}
    </>
  );
}
