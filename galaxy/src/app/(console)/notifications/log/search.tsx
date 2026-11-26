"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Badge, Container, ui } from "../../../ui";
import { time } from "../../requests/status";
import { searchDeliveries } from "../actions";
import { kindName } from "../kind-name";

// Why a send didn't go, in plain words (api/src/notifications.ts writes these reasons).
const REASONS: Record<string, string> = {
  killSwitch: "Switched off in Galaxy",
  switchOff: "They switched it off",
  capReached: "Over the daily limit",
  noDevice: "No phone signed in",
  noEmail: "No proved email",
  accountState: "Account suspended or closing",
  optionalHeld: "Optional email, not sent yet",
  notSetUp: "Sending not set up",
  stale: "Too late to send",
  gone: "Phone or address no longer there",
  refused: "Refused by the provider",
  throttled: "Provider busy, trying again",
  unknown: "Provider error",
  error: "Our error",
};
const tones: Record<string, "success" | "info" | "warning" | "error" | "neutral"> = {
  sent: "success",
  delivered: "success",
  queued: "info",
  held: "info",
  sending: "info",
  failed: "error",
  dropped: "warning",
  skipped: "neutral",
};
const STATUS: Record<string, string> = { held: "Held for quiet hours" };
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

// `people`: holders of People also get a link to the person's page, which is theirs alone.
export function LogSearch({ people }: { people: boolean }) {
  const [found, search, pending] = useActionState(searchDeliveries, { q: "" });
  const log = found.log;
  return (
    <>
      <form action={search} className={ui.row}>
        <input className={ui.input} name="q" defaultValue={found.q} placeholder="Phone, email or account id" aria-label="Phone, email or account id" required />
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          Search
        </button>
      </form>
      <Alert>{found.error}</Alert>
      {log && (
        <Container title={log.person ? (log.person.name ?? "No name yet") : "No account"} count={log.deliveries.length}>
          {log.person && people && (
            <p className={ui.secondary}>
              <Link href={`/users/${log.person.id}`} prefetch={false}>
                Open their page
              </Link>
            </p>
          )}
          {log.deliveries.length === 0 ? (
            <p className={ui.secondary}>Nothing sent to them in the last 180 days.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Message</th>
                  <th>Channel</th>
                  <th>To</th>
                  <th>Status</th>
                  <th>Why</th>
                  <th>Tries</th>
                  <th>Made</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {log.deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>{kindName(d.kind)}</td>
                    <td>{cap(d.channel)}</td>
                    <td>{d.to ?? "–"}</td>
                    <td>
                      <Badge tone={tones[d.status] ?? "neutral"}>{STATUS[d.status] ?? cap(d.status)}</Badge>
                    </td>
                    <td>{d.reason ? (REASONS[d.reason] ?? d.reason) : "–"}</td>
                    <td>{d.tries}</td>
                    <td>{time(d.createdAt)}</td>
                    <td>{d.sentAt ? time(d.sentAt) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Container>
      )}
    </>
  );
}
