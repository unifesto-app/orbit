import type { StaffRooms } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, ui } from "../../ui";
import { time } from "../requests/status";

// Rooms (inRoom, Feature 3; API: GET /galaxy/rooms), for holders of Queues: meetups whose checked-in guests meet in the
// app, newest first. Rooms of a host the viewer is on are left out.
export const metadata: Metadata = { title: "Rooms" };

export default function Rooms() {
  return (
    <div className={ui.page}>
      <PageHeader title="Rooms" description="Meetups whose checked-in guests meet in the app, newest first." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const r = await read<StaffRooms>("/galaxy/rooms");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return (
    <Container title="Rooms" count={r.data.rooms.length}>
      {r.data.rooms.length === 0 ? (
        <p className={ui.secondary}>No meetups with a room yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Host</th>
              <th>Starts</th>
              <th>Closes</th>
              <th>In the room</th>
              <th>Removed</th>
            </tr>
          </thead>
          <tbody>
            {r.data.rooms.map((x) => (
              <tr key={x.eventId}>
                <td>
                  {/* No prefetch: opening a room is written to the audit log. */}
                  <Link href={`/rooms/${x.eventId}`} prefetch={false}>
                    {x.title}
                  </Link>
                  {x.status !== "published" && <span className={ui.secondary}> · {x.status === "cancelled" ? "Cancelled" : x.status}</span>}
                </td>
                <td>{x.hostName}</td>
                <td>{x.startsAt ? time(x.startsAt) : "–"}</td>
                <td>{x.closesAt ? time(x.closesAt) : "–"}</td>
                <td>{x.members}</td>
                <td>{x.removed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Container>
  );
}
