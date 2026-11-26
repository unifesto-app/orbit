import { SUPPORT_STATUSES, type StaffSupportList, type SupportStatus } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, ui } from "../../ui";
import { time } from "../requests/status";
import { appLabel, STATUS_LABELS, who } from "./status";

// Support (X16; API: GET /galaxy/support), for holders of Queues: what people wrote from Help in the Orbit app, Event
// Partner and Play Partner, the newest message first. Contacts come masked.
export const metadata: Metadata = { title: "Support" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function Support({ searchParams }: PageProps<"/support">) {
  return (
    <div className={ui.page}>
      <PageHeader title="Support" description="Messages people sent from Help in the apps, newest first." />
      <Suspense fallback={<nav aria-label="Thread status" className={ui.tabs} />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/support">, "searchParams">) {
  const raw = first((await searchParams).status);
  const status: SupportStatus = SUPPORT_STATUSES.includes(raw as SupportStatus) ? (raw as SupportStatus) : "open";
  const r = await read<StaffSupportList>(`/galaxy/support?status=${status}`);

  return (
    <>
      <nav aria-label="Thread status" className={ui.tabs}>
        {SUPPORT_STATUSES.map((s) => (
          <Link key={s} href={`/support?status=${s}`} prefetch={false} className={ui.tab} aria-current={s === status ? "page" : undefined}>
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>
      {!r.ok ? (
        <Alert>{r.error.message}</Alert>
      ) : (
        <Container title={STATUS_LABELS[status]} count={r.data.threads.length}>
          {r.data.threads.length === 0 ? (
            <p className={ui.secondary}>Nothing here.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>From</th>
                  <th>App</th>
                  <th>Last message</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {r.data.threads.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/support/${t.id}`} prefetch={false}>
                        {who(t.person)}
                      </Link>
                    </td>
                    <td>{appLabel(t.app)}</td>
                    <td>{t.preview}</td>
                    <td>{time(t.updatedAt)}</td>
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
