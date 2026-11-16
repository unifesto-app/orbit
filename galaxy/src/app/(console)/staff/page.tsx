import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { me, read } from "../../../api";
import { Alert, Badge, Container, day, FEATURE_NAMES, PageHeader, ui } from "../../ui";
import { Act } from "../act";
import { confirmGrant, endGrant } from "../actions";

// Orbit's staff (Roles flow; API: /galaxy/staff), for holders of Staff. An add starts once another holder of Staff
// confirms it, never the one who added it nor the person; the platform owner's own adds start after 24 hours instead.
// Taking a feature away is at once.
export const metadata: Metadata = { title: "Staff" };

type Grant = { id: string; userId: string; name: string | null; feature: keyof typeof FEATURE_NAMES; addedBy: string; status: "waitingConfirm" | "startsLater" | "active"; startsAt: string | null };

export default function Staff() {
  return (
    <div className={ui.page}>
      <PageHeader title="Staff" description="Who has access to Galaxy, feature by feature." />
      <Suspense fallback={null}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  // Opening the list is written to the audit log, so it reads only for a real visit, never a link's prefetch.
  await connection();
  const [r, mine] = await Promise.all([read<Grant[]>("/galaxy/staff"), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const self = mine.ok ? mine.data.id : null;
  const nameOf = (id: string) => (id === self ? "You" : (r.data.find((g) => g.userId === id)?.name ?? "Someone"));
  const waiting = r.data.filter((g) => g.status !== "active");
  const active = r.data.filter((g) => g.status === "active");

  return (
    <>
      <p className={ui.secondary}>
        To add someone, find them in <Link href="/users">Users</Link> and choose Give access.
      </p>

      {waiting.length > 0 && (
        <Container title="Waiting" count={waiting.length}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Feature</th>
                <th>Added by</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((g) => (
                <tr key={g.id}>
                  <td>{g.userId === self ? "You" : (g.name ?? "No name yet")}</td>
                  <td>{FEATURE_NAMES[g.feature]}</td>
                  <td>{nameOf(g.addedBy)}</td>
                  <td>
                    {g.status === "waitingConfirm" ? (
                      <Badge tone="info">Waiting to be confirmed</Badge>
                    ) : (
                      <Badge tone="warning">Starts {g.startsAt ? day(g.startsAt) : "later"}</Badge>
                    )}
                  </td>
                  <td>
                    <div className={ui.row}>
                      {g.status === "waitingConfirm" && g.addedBy !== self && g.userId !== self && (
                        <Act label="Confirm" action={confirmGrant} hidden={{ id: g.id }} who="Everyone with Staff sees this" />
                      )}
                      <Act label="Cancel" action={endGrant} hidden={{ id: g.id }} who="Everyone with Staff sees this" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Container>
      )}

      <Container title="Staff" count={active.length}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Feature</th>
              <th>Since</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {active.map((g) => (
              <tr key={g.id}>
                <td>{g.userId === self ? "You" : (g.name ?? "No name yet")}</td>
                <td>{FEATURE_NAMES[g.feature]}</td>
                <td>{g.startsAt ? day(g.startsAt) : "–"}</td>
                <td>{g.userId !== self && <Act label="Take away" action={endGrant} hidden={{ id: g.id }} who="They and everyone with Staff see this" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={ui.secondary}>The platform owner has every feature and isn’t listed.</p>
      </Container>
    </>
  );
}
