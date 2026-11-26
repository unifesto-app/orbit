import type { RefundQueue } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Container, ui } from "../../../ui";
import { MoneyHeader, RefundTable } from "../tabs";

// Money › Refunds (API: GET /galaxy/money/refunds): those on their way, and those Razorpay refused, which the poller
// retries hourly for a day and staff can send again.
export const metadata: Metadata = { title: "Refunds" };

export default function Refunds() {
  return (
    <div className={ui.page}>
      <MoneyHeader current="refunds" description="Refunds not yet with the buyer. Razorpay takes 5 to 7 working days once a refund is sent." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const r = await read<RefundQueue>("/galaxy/money/refunds");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return (
    <>
      <Container title="Failed" count={r.data.failed.length}>
        {r.data.failed.length === 0 ? <p className={ui.secondary}>None failed.</p> : <RefundTable rows={r.data.failed} retry />}
      </Container>
      <Container title="On the way" count={r.data.open.length}>
        {r.data.open.length === 0 ? <p className={ui.secondary}>Nothing on the way.</p> : <RefundTable rows={r.data.open} />}
      </Container>
    </>
  );
}
