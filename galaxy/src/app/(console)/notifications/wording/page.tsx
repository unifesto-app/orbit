import type { GalaxyKinds } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, Container, ui } from "../../../ui";
import { CHANNEL_NAMES, GROUPS, kindName, NotificationsHeader } from "../tabs";

// Notifications › Wording (notifications build plan, PR 8), for holders of Platform: every kind by group, each opening
// its own page to reword it per channel.
export const metadata: Metadata = { title: "Wording" };

export default function WordingPage() {
  return (
    <div className={ui.page}>
      <NotificationsHeader current="wording" description="What each message says, by email, push and inbox. A saved change goes out within a minute, no deploy." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const who = await me();
  if (!(who.ok && who.data.staff?.features.includes("platform"))) notFound();
  const r = await read<GalaxyKinds>("/galaxy/notifications/kinds");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return GROUPS.map(([group, title]) => {
    const kinds = r.data.kinds.filter((k) => k.group === group);
    return (
      <Container key={group} title={title} count={kinds.length}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Channels</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k.kind}>
                <td>
                  <Link href={`/notifications/wording/${k.kind}`} prefetch={false}>
                    {kindName(k.kind)}
                  </Link>
                </td>
                <td>{k.channels.map((ch) => CHANNEL_NAMES[ch]).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Container>
    );
  });
}
