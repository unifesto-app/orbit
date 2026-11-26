import type { HostFees } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Container, Pages, ui } from "../../../ui";
import { Act } from "../../act";
import { setFees } from "../actions";
import { first, MoneyHeader } from "../tabs";

// Money › Fees (API: GET /galaxy/money/fees, PUT …/:hostId): each host's plan, 3% buyer + 2% host or 5% buyer + 0%
// host (owner, 25 Nov 2026), and whether the buyer fee sits inside the price. A change is for sales from then on.
export const metadata: Metadata = { title: "Fees" };

const PLANS = { "3+2": "3% buyer, 2% host", "5+0": "5% buyer, 0% host" } as const;

export default function Fees({ searchParams }: PageProps<"/money/fees">) {
  return (
    <div className={ui.page}>
      <MoneyHeader current="fees" description="Each host's fee plan. A change holds for sales from then on; past payments keep their terms." />
      <Suspense fallback={null}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/money/fees">, "searchParams">) {
  const sp = await searchParams;
  const q = first(sp.q)?.trim() ?? "";
  const page = first(sp.page) ?? "1";
  const r = await read<HostFees>(`/galaxy/money/fees?q=${encodeURIComponent(q)}&page=${encodeURIComponent(page)}`);
  return (
    <>
      <form className={ui.row}>
        <input className={ui.input} name="q" defaultValue={q} placeholder="Host name" aria-label="Host name" />
        <button className={ui.btn}>Find</button>
      </form>
      {!r.ok ? (
        <Alert>{r.error.message}</Alert>
      ) : (
        <Container title="Hosts" count={r.data.total}>
          {r.data.hosts.length === 0 ? (
            <p className={ui.secondary}>No hosts here.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Plan</th>
                  <th>Buyer fee</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.data.hosts.map((h) => (
                  <tr key={h.id}>
                    <td>{h.name}</td>
                    <td>{PLANS[h.plan]}</td>
                    <td>{h.feeIncluded ? "In the price" : "On top"}</td>
                    <td>
                      <Act label="Change" action={setFees} hidden={{ id: h.id }} who="The host's admins are told the new plan">
                        <label>
                          Plan
                          <select className={ui.input} name="plan" defaultValue={h.plan}>
                            {Object.entries(PLANS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={ui.row}>
                          <input type="checkbox" name="feeIncluded" defaultChecked={h.feeIncluded} /> Buyer fee inside the price
                        </label>
                      </Act>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pages path={`/money/fees${q ? `?q=${encodeURIComponent(q)}` : ""}`} {...r.data} />
        </Container>
      )}
    </>
  );
}
