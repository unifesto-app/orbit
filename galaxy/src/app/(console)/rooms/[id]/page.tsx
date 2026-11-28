import type { StaffRoom } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, Badge, Container, PageHeader, Pairs, ui } from "../../../ui";
import { Act } from "../../act";
import { barFromRooms, removeRoomCard } from "../../actions";
import { time } from "../../requests/status";

// One room (API: GET /galaxy/rooms/:eventId, which logs the view): every card put up, with the account behind it.
// Remove takes a card down for good; Bar keeps the person out of every room until someone lifts it on their People page.
export const metadata: Metadata = { title: "Room" };

export default function RoomPage({ params }: PageProps<"/rooms/[id]">) {
  return (
    <Suspense fallback={null}>
      <Room params={params} />
    </Suspense>
  );
}

async function Room({ params }: Pick<PageProps<"/rooms/[id]">, "params">) {
  const { id } = await params;
  await connection(); // opening it is written to the audit log: never for a prefetch
  const [r, viewer] = await Promise.all([read<StaffRoom>(`/galaxy/rooms/${encodeURIComponent(id)}`), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { room, members } = r.data;
  // A person's page is People's; holders of Queues alone see the name.
  const people = viewer.ok && !!viewer.data.staff?.features.includes("people");

  return (
    <div className={ui.page}>
      <PageHeader title={room.title} description={`Room of ${room.hostName}`} />

      <Container title="Room">
        <Pairs
          pairs={[
            ["Link", `heyorbit.in/event/${room.slug}`],
            ["Starts", room.startsAt && time(room.startsAt)],
            ["Closes", room.closesAt && time(room.closesAt)],
            ["In the room", String(room.members)],
            ["Removed", String(room.removed)],
          ]}
        />
      </Container>

      <Container title="Cards" count={members.length}>
        {members.length === 0 ? (
          <p className={ui.secondary}>Nobody has joined yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Line</th>
                <th>Reach</th>
                <th>State</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} id={m.id /* a report links to the card: /rooms/[id]#memberId */}>
                  <td>
                    {people ? (
                      <Link href={`/users/${m.userId}`} prefetch={false}>
                        {m.name ?? "No name yet"}
                      </Link>
                    ) : (
                      (m.name ?? "No name yet")
                    )}
                  </td>
                  <td>{m.line}</td>
                  <td>{m.reach.map((x) => `${x.label}: ${x.value}`).join(" · ")}</td>
                  <td>
                    {m.removedAt ? (
                      <Badge tone="error">{`Removed ${time(m.removedAt)}${m.removedBy ? ` by ${m.removedBy}` : ""}`}</Badge>
                    ) : m.leftAt ? (
                      <Badge tone="neutral">Left</Badge>
                    ) : m.letIn ? (
                      <Badge tone="success">In</Badge>
                    ) : (
                      <Badge tone="warning">Not checked in</Badge>
                    )}
                    {m.barred && (
                      <>
                        {" "}
                        <Badge tone="error">Barred from rooms</Badge>
                      </>
                    )}
                  </td>
                  <td>{time(m.joinedAt)}</td>
                  <td>
                    {!m.removedAt && <Act label="Remove card" action={removeRoomCard} hidden={{ eventId: room.eventId, memberId: m.id }} who="They see this" />}
                    {!m.barred && <Act label="Bar from rooms" action={barFromRooms} hidden={{ eventId: room.eventId, memberId: m.id }} who="They see this" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
    </div>
  );
}
