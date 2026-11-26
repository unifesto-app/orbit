import type { StaffPayoutAccount } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Badge, Container, ui } from "../../../ui";
import { Act } from "../../act";
import { checkAccount } from "../actions";
import { MoneyHeader, when } from "../tabs";

// Money › Payout accounts (API: GET /galaxy/money/payout-accounts): where each host is paid, in full, for holders of
// Money only. A new or replaced account waits here, checked first, until it's verified (Orbit pays to it) or rejected
// with a reason the host's Admins read in their app.
export const metadata: Metadata = { title: "Payout accounts" };

const TONES = { checking: "warning", verified: "success", rejected: "error" } as const;
const NAMES = { checking: "To check", verified: "Verified", rejected: "Rejected" } as const;

export default function PayoutAccountsPage() {
  return (
    <div className={ui.page}>
      <MoneyHeader
        current="accounts"
        description="Where each host is paid. Check the name and number against the host before verifying; a replaced account comes back here."
      />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const r = await read<StaffPayoutAccount[]>("/galaxy/money/payout-accounts");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return (
    <Container title="Payout accounts" count={r.data.length}>
      {r.data.length === 0 ? (
        <p className={ui.secondary}>No host has added one yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Host</th>
              <th>Holder</th>
              <th>Account</th>
              <th>Status</th>
              <th>Checked</th>
              <th>Changed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.data.map((a) => (
              <tr key={a.hostId}>
                <td>{a.hostName}</td>
                <td>{a.holder}</td>
                <td>{a.kind === "upi" ? a.upi : `${a.accountNumber} · ${a.ifsc} · ${a.bankName}`}</td>
                <td>
                  <Badge tone={TONES[a.state]}>{NAMES[a.state]}</Badge>
                  {a.reason ? ` ${a.reason}` : ""}
                </td>
                <td>{a.checkedAt ? `${a.checkedByName ?? "–"}, ${when(a.checkedAt)}` : "–"}</td>
                <td>{when(a.updatedAt)}</td>
                <td>
                  <div className={ui.row}>
                    {a.state !== "verified" && (
                      <Act label="Verify" action={checkAccount} hidden={{ id: a.hostId, seen: a.updatedAt, verdict: "verify" }} who="Everyone with Money sees this; the host's Admins are told it's verified" />
                    )}
                    {a.state !== "rejected" && (
                      <Act label="Reject" action={checkAccount} hidden={{ id: a.hostId, seen: a.updatedAt, verdict: "reject" }} who="The host's Admins see this" />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Container>
  );
}
