import type { StaffSlotAlert, StaffSlotHolds } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Badge, Container, PageHeader, ui } from "../../ui";
import { Act } from "../act";
import { time } from "../requests/status";
import { releaseHold } from "./actions";

// Slot holds (Play; API: GET /galaxy/slot-holds), for holders of Hosts: players' 10-minute holds running now, each
// releasable, and the freed-slot alerts ("Hear if it frees up") of the last 7 days, newest first.
export const metadata: Metadata = { title: "Slot holds" };

const STATES: Record<StaffSlotAlert["state"], [string, "info" | "success" | "neutral"]> = {
  waiting: ["Waiting", "info"],
  sent: ["Sent", "success"],
  expired: ["Expired", "neutral"],
};

export default function SlotHolds() {
  return (
    <div className={ui.page}>
      <PageHeader title="Slot holds" description="Holds at venues while players pay, and who asked to hear when a slot frees up." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const r = await read<StaffSlotHolds>("/galaxy/slot-holds");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return (
    <>
      <Container title="Holds in progress" count={r.data.holds.length}>
        {r.data.holds.length === 0 ? (
          <p className={ui.secondary}>No holds running.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Venue</th>
                <th>Station</th>
                <th>Person</th>
                <th>Start</th>
                <th>Count</th>
                <th>Time left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.data.holds.map((h) => (
                <tr key={h.id}>
                  <td>{h.venue}</td>
                  <td>{h.station}</td>
                  <td>{h.person ?? "No name yet"}</td>
                  <td>{time(h.start)}</td>
                  <td>{h.count}</td>
                  <td>{h.minutesLeft} min</td>
                  <td>
                    <Act label="Release" action={releaseHold} hidden={{ id: h.id }} who="Staff see this; the player doesn't" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
      <Container title="Freed-slot alerts" count={r.data.alerts.length}>
        {r.data.alerts.length === 0 ? (
          <p className={ui.secondary}>No alerts in the last 7 days.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Venue</th>
                <th>Station</th>
                <th>Person</th>
                <th>Start</th>
                <th>Count</th>
                <th>Asked</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {r.data.alerts.map((a) => (
                <tr key={a.id}>
                  <td>{a.venue}</td>
                  <td>{a.station}</td>
                  <td>{a.person ?? "No name yet"}</td>
                  <td>{time(a.start)}</td>
                  <td>{a.count}</td>
                  <td>{time(a.createdAt)}</td>
                  <td>
                    <Badge tone={STATES[a.state][1]}>{a.sentAt ? `${STATES.sent[0]} ${time(a.sentAt)}` : STATES[a.state][0]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
    </>
  );
}
