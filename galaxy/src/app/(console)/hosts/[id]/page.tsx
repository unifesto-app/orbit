import { HOST_KINDS } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Badge, Container, day, PageHeader, Pairs, ui } from "../../../ui";
import { Act } from "../../act";
import { liftHost, setParent, suspendHost, unverifyHost, verifyHost } from "../../actions";
import { HostStatus } from "../status";

// A host as staff see it (Galaxy flow, Hosts; API: GET /galaxy/hosts/:id, which logs the view). Every action is risky
// and the API refuses staff on the host's team, invited, or gone from it in the last 30 days.
export const metadata: Metadata = { title: "Host" };

type HostRef = { id: string; slug: string; name: string };
type HostFile = HostRef & {
  kind: keyof typeof HOST_KINDS;
  city: string;
  website: string | null;
  status: string;
  visibility: string;
  suspendReason: string | null;
  verified: { at: string; by: string | null } | null;
  parent: HostRef | null;
  clubs: (HostRef & { status: string })[];
  followers: number;
  team: { userId: string; name: string | null; role: string; owner: boolean }[];
  owner: { name: string | null; phone: string | null; email: string | null };
};

export default function HostPage({ params }: PageProps<"/hosts/[id]">) {
  return (
    <Suspense fallback={null}>
      <Host params={params} />
    </Suspense>
  );
}

async function Host({ params }: Pick<PageProps<"/hosts/[id]">, "params">) {
  const { id } = await params;
  await connection(); // opening it is written to the audit log: never for a prefetch
  const r = await read<HostFile>(`/galaxy/hosts/${encodeURIComponent(id)}`);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const h = r.data;
  const who = `${h.name}'s Admins see this`;
  const suspendedByStaff = h.status === "suspended" && h.suspendReason !== null;

  return (
    <div className={ui.page}>
      <PageHeader title={h.name} description={`heyorbit.in/${h.slug}`} />

      <Container title="Details">
        <Pairs
          pairs={[
            ["Status", <HostStatus key="s" status={h.status} />],
            ["Verified", h.verified ? <Badge tone="info">Since {day(h.verified.at)}</Badge> : "No"],
            ["Kind", HOST_KINDS[h.kind] ?? h.kind],
            ["City", h.city],
            ["Followers", h.followers.toLocaleString("en-IN")],
            ["Visibility", h.visibility === "public" ? "Public" : "Private"],
            ["Website", h.website],
            ["Parent", h.parent ? <Link href={`/hosts/${h.parent.id}`} prefetch={false}>{h.parent.name}</Link> : null],
            ["Owner", [h.owner.name, h.owner.phone, h.owner.email].filter(Boolean).join(" · ")],
            ...(h.suspendReason ? [["Suspended for", h.suspendReason] as [string, string]] : []),
          ]}
        />
      </Container>

      <Container title="Team" count={h.team.length}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {h.team.map((m) => (
              <tr key={m.userId}>
                <td>{m.name ?? "No name yet"}</td>
                <td>
                  {m.role[0]!.toUpperCase() + m.role.slice(1)}
                  {m.owner && ", Owner"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Container>

      {h.clubs.length > 0 && (
        <Container title="Clubs" count={h.clubs.length}>
          <ul className={ui.list}>
            {h.clubs.map((c) => (
              <li key={c.id}>
                <Link href={`/hosts/${c.id}`} prefetch={false}>
                  {c.name}
                </Link>{" "}
                <HostStatus status={c.status} />
              </li>
            ))}
          </ul>
        </Container>
      )}

      <Container title="Actions">
        <div className={ui.page}>
          {h.verified ? (
            <Act label="Remove verification" action={unverifyHost} hidden={{ id: h.id }} who={who} />
          ) : (
            // The name staff checked goes with it: a rename since then refuses it.
            <Act label="Verify" action={verifyHost} hidden={{ id: h.id, name: h.name }} who={who} />
          )}
          {suspendedByStaff ? (
            <Act label="Lift suspension" action={liftHost} hidden={{ id: h.id }} who={who} />
          ) : (
            <Act label="Suspend" action={suspendHost} hidden={{ id: h.id }} who={who} />
          )}
          <Act label="Set parent" action={setParent} hidden={{ id: h.id }} who={who}>
            <label>
              Parent’s link <span className={ui.secondary}>(empty takes it out from under one)</span>
              <input className={ui.input} type="text" name="parent" defaultValue={h.parent?.slug ?? ""} placeholder="heyorbit.in/…" />
            </label>
          </Act>
        </div>
      </Container>
    </div>
  );
}
