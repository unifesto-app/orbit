import type { FailedWebhook } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Container, ui } from "../../../ui";
import { MoneyHeader, when } from "../tabs";

// Money › Failed webhooks (API: GET /galaxy/money/failed-webhooks): the last 200 calls to /razorpay/webhook refused,
// mostly bad signatures (a changed webhook secret, or someone else). Only the event and its ids are kept, never the body.
export const metadata: Metadata = { title: "Failed webhooks" };

export default function FailedWebhooks() {
  return (
    <div className={ui.page}>
      <MoneyHeader current="failed" description="Webhook calls Orbit refused, newest first. Many in a row after a deploy usually means the webhook secret differs from Razorpay's." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const r = await read<FailedWebhook[]>("/galaxy/money/failed-webhooks");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return (
    <Container title="Refused" count={r.data.length}>
      {r.data.length === 0 ? (
        <p className={ui.secondary}>None refused.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Why</th>
              <th>What it said</th>
            </tr>
          </thead>
          <tbody>
            {r.data.map((w) => (
              <tr key={w.id}>
                <td>{when(w.receivedAt)}</td>
                <td>{w.reason}</td>
                <td>
                  <code>{w.excerpt}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Container>
  );
}
