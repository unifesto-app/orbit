import type { Payouts } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Badge, Container, ui } from "../../../ui";
import { Act } from "../../act";
import { cancelPayout, newPayout, payoutPaid } from "../actions";
import { inr, MoneyHeader, when } from "../tabs";

// Money › Payouts (API: GET /galaxy/money/payouts): each event's earnings worked out by the API, and the payouts sent
// by hand from the bank, marked paid with the bank's UTR.
export const metadata: Metadata = { title: "Payouts" };

const TONES = { requested: "warning", paid: "success", cancelled: "neutral" } as const;
const NAMES = { requested: "To pay", paid: "Paid", cancelled: "Cancelled" } as const;

export default function PayoutsPage() {
  return (
    <div className={ui.page}>
      <MoneyHeader current="payouts" description="What each event has earned its host, and what's been paid out. Earnings are sales less commission, any fee in the price, and refunds." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const r = await read<Payouts>("/galaxy/money/payouts");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return (
    <>
      <Container title="Payouts" count={r.data.payouts.length}>
        {r.data.payouts.length === 0 ? (
          <p className={ui.secondary}>No payouts yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Event</th>
                <th>Host</th>
                <th>Amount</th>
                <th>Status</th>
                <th>UTR</th>
                <th>By</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.data.payouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.eventTitle ?? "Slots"}</td>
                  <td>{p.hostName}</td>
                  <td>{inr(p.amountPaise)}</td>
                  <td>
                    <Badge tone={TONES[p.status]}>{NAMES[p.status]}</Badge>
                  </td>
                  <td>{p.utr ?? "–"}</td>
                  <td>{p.byName ?? "–"}</td>
                  <td>{when(p.at)}</td>
                  <td>
                    {p.status === "requested" && (
                      <div className={ui.row}>
                        <Act label="Mark paid" action={payoutPaid} hidden={{ id: p.id }} who="The host's admins are told it's paid">
                          <label>
                            UTR from the bank
                            <input className={ui.input} name="utr" required pattern="[A-Za-z0-9]{6,40}" />
                          </label>
                        </Act>
                        <Act label="Cancel" action={cancelPayout} hidden={{ id: p.id }} who="The host's admins see this" />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
      <Container title="Earnings by event or venue" count={r.data.earnings.length}>
        {r.data.earnings.length === 0 ? (
          <p className={ui.secondary}>No paid sales yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Event</th>
                <th>Host</th>
                <th>Sales</th>
                <th>Commission</th>
                <th>Refunded</th>
                <th>Earnings</th>
                <th>Paid out</th>
                <th>To pay</th>
                <th>Left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.data.earnings.map((e) => (
                <tr key={e.eventId ?? e.hostId}>
                  <td>{e.eventTitle ?? "Slots"}</td>
                  <td>{e.hostName}</td>
                  <td>{inr(e.salesPaise)}</td>
                  <td>{inr(e.commissionPaise + e.includedPaise)}</td>
                  <td>{inr(e.refundedPaise)}</td>
                  <td>{inr(e.earningsPaise)}</td>
                  <td>{inr(e.paidOutPaise)}</td>
                  <td>{inr(e.requestedPaise)}</td>
                  <td>{inr(e.availablePaise)}</td>
                  <td>
                    {e.availablePaise > 0 && (
                      <Act label="New payout" action={newPayout} hidden={e.eventId ? { eventId: e.eventId } : { hostId: e.hostId }} who="Everyone with Money sees this">
                        <label>
                          Amount in rupees, up to {inr(e.availablePaise)}
                          <input className={ui.input} name="rupees" type="number" min="0.01" step="0.01" max={e.availablePaise / 100} required />
                        </label>
                      </Act>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
    </>
  );
}
