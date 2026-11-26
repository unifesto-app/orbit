import type { PaymentStatus, RefundRow } from "@orbit/contract";
import Link from "next/link";
import { Badge, PageHeader, ui } from "../../ui";
import { Act } from "../act";
import { retryRefund } from "./actions";

// Money's pages (Money flow; X2), each its own address, as Notifications' tabs. API: /galaxy/money/*, for holders of
// Money; anyone else gets Galaxy's not-found, as every gated page.
const TABS = [
  { key: "payments", label: "Payments", href: "/money/payments" },
  { key: "bookings", label: "Bookings and tickets", href: "/money/bookings" },
  { key: "refunds", label: "Refunds", href: "/money/refunds" },
  { key: "payouts", label: "Payouts", href: "/money/payouts" },
  { key: "fees", label: "Fees", href: "/money/fees" },
  { key: "failed", label: "Failed webhooks", href: "/money/failed-webhooks" },
] as const;

export function MoneyHeader({ current, description }: { current: (typeof TABS)[number]["key"]; description: string }) {
  return (
    <>
      <PageHeader title="Money" description={description} />
      <nav aria-label="Money" className={ui.tabs}>
        {TABS.map((t) => (
          <Link key={t.key} href={t.href} prefetch={false} className={ui.tab} aria-current={t.key === current ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

// Paise as staff read them: "₹1,236", "₹0" (never "Free": these are amounts, not prices).
export const inr = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);

// A time as staff read it, in India's time.
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// A payment's status as staff read it, with its badge tone.
export const STATUS: Record<PaymentStatus, [string, "success" | "info" | "warning" | "error" | "neutral"]> = {
  created: ["Not paid yet", "neutral"],
  paid: ["Paid", "success"],
  refundPending: ["Refund pending", "warning"],
  refunded: ["Refunded", "info"],
  expired: ["Expired", "neutral"],
  failed: ["Failed", "error"],
};

const KINDS = { auto: "Automatic", staff: "Staff", request: "Asked for" } as const;
const TONES = { requested: "neutral", sent: "info", processed: "success", failed: "error" } as const;

// Refunds as a table, on Refunds and on one payment; `retry` adds Send again for failed ones.
export function RefundTable({ rows, retry }: { rows: RefundRow[]; retry?: boolean }) {
  return (
    <table className={ui.table}>
      <thead>
        <tr>
          <th>Amount</th>
          <th>Status</th>
          <th>Kind</th>
          <th>Reason</th>
          <th>Tries</th>
          <th>Payment</th>
          <th>Created</th>
          {retry && <th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id}>
            <td>{inr(f.amountPaise)}</td>
            <td>
              <Badge tone={TONES[f.status]}>{f.status[0]!.toUpperCase() + f.status.slice(1)}</Badge>
            </td>
            <td>{KINDS[f.kind]}{f.byName ? `, ${f.byName}` : ""}</td>
            <td>{f.reason}</td>
            <td>{f.attempts}</td>
            <td>
              <Link href={`/money/payments/${f.paymentId}`} prefetch={false}>
                {f.razorpayPaymentId ?? "Open"}
              </Link>
            </td>
            <td>{when(f.createdAt)}</td>
            {retry && (
              <td>
                <Act label="Send again" action={retryRefund} hidden={{ id: f.id }} who="Everyone with Money sees this" />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
