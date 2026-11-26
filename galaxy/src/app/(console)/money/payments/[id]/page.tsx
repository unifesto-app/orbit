import type { PaymentDetail } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../../../api";
import { Alert, Badge, Container, Pairs, ui } from "../../../../ui";
import { Act } from "../../../act";
import { refund } from "../../actions";
import { inr, MoneyHeader, RefundTable, STATUS, when } from "../../tabs";

// Money › one payment (API: GET /galaxy/money/payments/:id): its frozen terms, Razorpay's ids and fee, its refunds, and
// a staff refund up to what's left.
export const metadata: Metadata = { title: "Payment" };

export default function Payment({ params }: PageProps<"/money/payments/[id]">) {
  return (
    <div className={ui.page}>
      <MoneyHeader current="payments" description="One payment: what was charged, what Razorpay kept, and what went back." />
      <Suspense fallback={null}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

async function Body({ params }: Pick<PageProps<"/money/payments/[id]">, "params">) {
  const { id } = await params;
  const r = await read<PaymentDetail>(`/galaxy/money/payments/${encodeURIComponent(id)}`);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { payment: p, refunds, refundablePaise } = r.data;
  return (
    <>
      <Container title="Details">
        <Pairs
          pairs={[
            ["Status", <Badge key="s" tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>],
            ["Buyer", p.userName ?? "No name yet"],
            ["Event", p.eventTitle],
            ["Host", p.hostName],
            ["Seats", `${p.quantity} × ${inr(p.unitPricePaise)}`],
            ["Fee plan", `${p.plan}${p.feeIncluded ? ", fee in the price" : ""}`],
            ["Buyer fee", inr(p.buyerFeePaise)],
            ["Commission", inr(p.commissionPaise)],
            ["Charged", inr(p.amountPaise)],
            ["Razorpay fee", p.razorpayFeePaise == null ? null : `${inr(p.razorpayFeePaise)} (GST ${inr(p.razorpayTaxPaise ?? 0)})`],
            ["Order", p.razorpayOrderId],
            ["Payment", p.razorpayPaymentId],
            ["Booking", p.bookingId],
            ["Created", when(p.createdAt)],
          ]}
        />
      </Container>
      <Container title="Refunds" count={refunds.length}>
        {refunds.length === 0 ? <p className={ui.secondary}>No refunds.</p> : <RefundTable rows={refunds} />}
        {refundablePaise > 0 && (
          <Act label="Refund" action={refund} hidden={{ id: p.id }} who="The buyer is told the amount; the reason stays with staff">
            <label>
              Amount in rupees, up to {inr(refundablePaise)}
              <input className={ui.input} name="rupees" type="number" min="0.01" step="0.01" max={refundablePaise / 100} required />
            </label>
          </Act>
        )}
      </Container>
    </>
  );
}
