import { PAYMENT_STATUSES, type PaymentList, type PaymentStatus } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Badge, Container, Pages, ui } from "../../../ui";
import { first, inr, MoneyHeader, STATUS, when } from "../tabs";

// Money › Payments (API: GET /galaxy/money/payments): every Razorpay order, newest first, by status.
export const metadata: Metadata = { title: "Payments" };

export default function Payments({ searchParams }: PageProps<"/money/payments">) {
  return (
    <div className={ui.page}>
      <MoneyHeader current="payments" description="Every order sent to Razorpay, newest first. Amounts are what the buyer paid, fee included. Times are India's." />
      <Suspense fallback={null}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/money/payments">, "searchParams">) {
  const sp = await searchParams;
  const raw = first(sp.status);
  const status = PAYMENT_STATUSES.includes(raw as PaymentStatus) ? (raw as PaymentStatus) : undefined;
  const q = first(sp.q)?.trim() ?? "";
  const page = first(sp.page) ?? "1";
  const qs = new URLSearchParams({ ...(status && { status }), ...(q && { q }) }).toString();
  const r = await read<PaymentList>(`/galaxy/money/payments?${qs}&page=${encodeURIComponent(page)}`);
  return (
    <>
      <nav aria-label="Payment status" className={ui.tabs}>
        <Link href="/money/payments" prefetch={false} className={ui.tab} aria-current={!status ? "page" : undefined}>
          All
        </Link>
        {PAYMENT_STATUSES.map((s) => (
          <Link key={s} href={`/money/payments?status=${s}`} prefetch={false} className={ui.tab} aria-current={s === status ? "page" : undefined}>
            {STATUS[s][0]}
          </Link>
        ))}
      </nav>
      <form className={ui.row}>
        {status && <input type="hidden" name="status" value={status} />}
        <input className={ui.input} name="q" defaultValue={q} placeholder="Razorpay order or payment id" aria-label="Razorpay order or payment id" />
        <button className={ui.btn}>Find</button>
      </form>
      {!r.ok ? (
        <Alert>{r.error.message}</Alert>
      ) : (
        <Container title={status ? STATUS[status][0] : "All"} count={r.data.total}>
          {r.data.payments.length === 0 ? (
            <p className={ui.secondary}>No payments here.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Buyer</th>
                  <th>Event</th>
                  <th>Host</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {r.data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/money/payments/${p.id}`} prefetch={false}>
                        {p.razorpayOrderId}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
                    </td>
                    <td>{inr(p.amountPaise)}</td>
                    <td>{p.userName ?? "No name yet"}</td>
                    <td>{p.eventTitle ?? "–"}</td>
                    <td>{p.hostName}</td>
                    <td>{when(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pages path={`/money/payments${qs ? `?${qs}` : ""}`} {...r.data} />
        </Container>
      )}
    </>
  );
}
