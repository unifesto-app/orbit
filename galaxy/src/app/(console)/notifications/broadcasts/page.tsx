import type { Broadcasts } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, Badge, Container, ui } from "../../../ui";
import { time } from "../../requests/status";
import { NotificationsHeader } from "../tabs";
import { segmentName, STATUS, TYPES } from "./shared";

// Notifications › Broadcasts (notifications build plan, PR 9; API: GET /galaxy/notifications/broadcasts), for holders of
// Platform: the latest 100, newest first. Without Platform the API answers 404, and so does this page.
export const metadata: Metadata = { title: "Broadcasts" };

export default function BroadcastsPage() {
  return (
    <div className={ui.page}>
      <NotificationsHeader current="broadcasts" description="A message from Orbit to a segment. A second person with Platform confirms each one before it goes." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const [r, who] = await Promise.all([read<Broadcasts>("/galaxy/notifications/broadcasts"), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const items = r.data.items;
  return (
    <>
      {who.ok && who.data.staff?.features.includes("platform") && (
        <div className={ui.row}>
          <Link href="/notifications/broadcasts/new" prefetch={false} className={`${ui.btn} ${ui.primary}`}>
            New broadcast
          </Link>
        </div>
      )}
      <Container title="Broadcasts" count={items.length}>
        {items.length === 0 ? (
          <p className={ui.secondary}>No broadcasts yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>To</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Written by</th>
                <th>Confirmed by</th>
                <th>Made</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/notifications/broadcasts/${b.id}`} prefetch={false}>
                      {b.title}
                    </Link>
                  </td>
                  <td>{TYPES[b.type]}</td>
                  <td>{segmentName(b.segment)}</td>
                  <td>
                    <Badge tone={STATUS[b.status][1]}>{STATUS[b.status][0]}</Badge>
                  </td>
                  <td>
                    {b.sent} of {b.audienceCount}
                  </td>
                  <td>{b.author.name ?? "–"}</td>
                  <td>{b.confirmer ? (b.confirmer.name ?? "–") : b.autoSent ? "Sent after the 24 h wait" : b.autoAt ? `By itself, ${time(b.autoAt)}` : "–"}</td>
                  <td>{time(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
    </>
  );
}
