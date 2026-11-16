import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Badge, Container, ui } from "../../ui";
import { People } from "../people";
import { HostStatus } from "./status";

// Hosts (Galaxy flow, Hosts; API: GET /galaxy/hosts), for holders of Hosts and events.
export const metadata: Metadata = { title: "Hosts" };

type Found = { id: string; slug: string; name: string; city: string; status: string; verified: boolean };

export default function Hosts({ searchParams }: PageProps<"/hosts">) {
  return (
    <div className={ui.page}>
      <People current="hosts" description="Find a host by name, or by any link it has had." />
      <Suspense fallback={null}>
        <Search searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Search({ searchParams }: Pick<PageProps<"/hosts">, "searchParams">) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const found = q ? await read<Found[]>(`/galaxy/hosts?q=${encodeURIComponent(q)}`) : null;

  return (
    <>
      <Form action="/hosts" className={ui.row}>
        <input className={ui.input} name="q" defaultValue={q} placeholder="Name or link" aria-label="Name or link" minLength={2} required />
        <button className={`${ui.btn} ${ui.primary}`}>Search</button>
      </Form>
      {found && !found.ok && <Alert>{found.error.message}</Alert>}
      {found?.ok && (
        <Container title="Hosts" count={found.data.length}>
          {found.data.length === 0 ? (
            <p className={ui.secondary}>No host matches.</p>
          ) : (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Link</th>
                  <th>City</th>
                  <th>Status</th>
                  <th>Verified</th>
                </tr>
              </thead>
              <tbody>
                {found.data.map((h) => (
                  <tr key={h.id}>
                    <td>
                      {/* No prefetch: opening a host's page is written to the audit log. */}
                      <Link href={`/hosts/${h.id}`} prefetch={false}>
                        {h.name}
                      </Link>
                    </td>
                    <td>heyorbit.in/{h.slug}</td>
                    <td>{h.city}</td>
                    <td>
                      <HostStatus status={h.status} />
                    </td>
                    <td>{h.verified ? <Badge tone="info">Verified</Badge> : <span className={ui.secondary}>No</span>}</td>
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
