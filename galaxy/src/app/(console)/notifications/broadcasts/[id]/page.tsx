import type { Broadcast } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { me, read } from "../../../../../api";
import { Alert, Badge, Container, Pairs, ui } from "../../../../ui";
import { Act } from "../../../act";
import { time } from "../../../requests/status";
import { NotificationsHeader } from "../../tabs";
import { cancelBroadcast } from "../actions";
import { Confirm } from "../forms";
import { channelNames, segmentName, STATUS, TYPES } from "../shared";

// One broadcast: its wording and audience, Confirm for a second Platform holder (never the author), Cancel while it is
// waiting, scheduled or part sent, and how far it has got (API: GET /galaxy/notifications/broadcasts/:id).
export const metadata: Metadata = { title: "Broadcast" };

export default function BroadcastPage({ params }: PageProps<"/notifications/broadcasts/[id]">) {
  return (
    <div className={ui.page}>
      <NotificationsHeader current="broadcasts" description="A message from Orbit to a segment. A second person with Platform confirms each one before it goes." />
      <Suspense fallback={null}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r, who] = await Promise.all([read<Broadcast>(`/galaxy/notifications/broadcasts/${encodeURIComponent(id)}`), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const b = r.data;
  const mine = who.ok && who.data.id === b.author.id;
  const open = b.status === "waiting" || b.status === "scheduled" || b.status === "sending";
  return (
    <>
      <Container title={b.title}>
        <p>{b.text}</p>
        <Pairs
          pairs={[
            ["Status", <Badge tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Badge>],
            ["Type", TYPES[b.type]],
            ["To", segmentName(b.segment)],
            ["Channels", channelNames(b)],
            ["Audience", `${b.audienceCount.toLocaleString("en-IN")} people when written`],
            ["Progress", `${b.sent.toLocaleString("en-IN")} sent, ${b.failed.toLocaleString("en-IN")} failed`],
            ["Send", b.sendAt ? time(b.sendAt) : "Once confirmed"],
            ["Written by", `${b.author.name ?? "–"}, ${time(b.createdAt)}`],
            ["Confirmed by", b.confirmer ? (b.confirmer.name ?? "–") : b.autoSent ? "Sent after the 24 h wait" : b.autoAt ? `No one else holds Platform: goes by itself ${time(b.autoAt)}` : "–"],
            ...(b.reason ? ([["Why cancelled", b.reason]] as [string, string][]) : []),
          ]}
        />
      </Container>
      {open && (
        <div className={ui.row}>
          {b.status === "waiting" && !mine && <Confirm id={b.id} />}
          {b.status === "waiting" && mine && !b.autoAt && <span className={ui.secondary}>Someone else with Platform has to confirm it.</span>}
          <Act label="Cancel broadcast" action={cancelBroadcast} hidden={{ id: b.id }} who="Everyone with Platform sees this in the audit log" />
        </div>
      )}
    </>
  );
}
