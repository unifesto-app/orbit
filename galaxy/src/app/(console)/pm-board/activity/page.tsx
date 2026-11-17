import type { PmActivity } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Container, ui } from "../../../ui";
import styles from "../pm.module.css";
import { PmHeader } from "../tabs";

// Every change to the board and every note, newest first, from Galaxy and from Claude Code alike (API:
// GET /galaxy/pm/activity). Messages are partly Claude's, so they're plain text.
export const metadata: Metadata = { title: "PM activity" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default function PmActivityPage() {
  return (
    <div className={ui.page}>
      <PmHeader current="activity" description="Every change and note on the board, newest first." />
      <Suspense fallback={null}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const r = await read<PmActivity[]>("/galaxy/pm/activity");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return (
    <Container title="Activity" count={r.data.length}>
      {r.data.length === 0 ? (
        <p className={ui.secondary}>Nothing yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
            </tr>
          </thead>
          <tbody>
            {r.data.map((a) => (
              <tr key={a.id}>
                <td>{when(a.at)}</td>
                <td>{a.actor}</td>
                <td className={styles.message}>{a.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Container>
  );
}
