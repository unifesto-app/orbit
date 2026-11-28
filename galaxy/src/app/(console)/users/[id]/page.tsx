import type { StaffFeature } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, Badge, Container, day, FEATURE_NAMES, PageHeader, Pairs, phone, ui } from "../../../ui";
import { type Person, unbarFromRooms } from "../../actions";
import { Act } from "../../act";
import { HostStatus } from "../../hosts/status";
import { PersonActions } from "../search";

// A person as staff see them (Galaxy flow, People; API: GET /galaxy/people/:id, which logs the view). Bookings and
// messages join it with their slices.
export const metadata: Metadata = { title: "User" };

type PersonFile = Person & {
  phoneVerified: boolean;
  emailVerified: boolean;
  dob: string | null;
  gender: string | null;
  suspendedUntil: string | null;
  suspensionReason: string | null;
  deletionDue: string | null;
  roomBarredAt: string | null;
  review: boolean; // an App Store or Play reviewer's account (api/src/auth/review.ts)
  owner: boolean | null; // null, with staff, for viewers without Staff
  staff: StaffFeature[] | null;
  hosts: { id: string; slug: string; name: string; status: string; owner: boolean }[];
  devices: { name: string; client: "app" | "web"; since: string; lastActive: string }[];
  history: { action: string; by: string | null; reason: string | null; at: string }[];
};

// What staff (or the person, for a lapse) did, in words.
const DID: Record<string, string> = {
  "people.suspend": "Suspended the account",
  "people.lift": "Lifted the suspension",
  "people.lapse": "Suspension ran out",
  "staff.grant": "Gave staff access",
  "staff.confirm": "Confirmed staff access",
  "staff.end": "Ended staff access",
  "rooms.remove": "Removed a room card",
  "rooms.bar": "Barred from rooms",
  "rooms.unbar": "Lifted the bar from rooms",
};

const time = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default function UserPage({ params }: PageProps<"/users/[id]">) {
  return (
    <Suspense fallback={null}>
      <User params={params} />
    </Suspense>
  );
}

async function User({ params }: Pick<PageProps<"/users/[id]">, "params">) {
  const { id } = await params;
  await connection(); // opening it is written to the audit log: never for a prefetch
  const [r, viewer] = await Promise.all([read<PersonFile>(`/galaxy/people/${encodeURIComponent(id)}`), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const p = r.data;
  const features = viewer.ok ? [...(viewer.data.staff?.features ?? [])] : [];
  const verified = (yes: boolean) => <span className={ui.secondary}>{yes ? "Verified" : "Not verified"}</span>;

  return (
    <div className={ui.page}>
      <PageHeader title={p.name ?? "No name yet"} description={`On Orbit since ${day(p.since)}`} />

      <Container title="Details">
        <Pairs
          pairs={[
            [
              "Status",
              p.suspended ? (
                <Badge tone="error">{p.suspendedUntil ? `Suspended until ${day(p.suspendedUntil)}` : "Closed for good"}</Badge>
              ) : (
                <Badge tone="success">Active</Badge>
              ),
            ],
            ...(p.review ? [["Account", <Badge key="rv" tone="info">Review account: for App Store and Play reviewers, not a real person</Badge>] as [string, ReactNode]] : []),
            ["Phone", p.phone && <>{phone(p.phone)} {verified(p.phoneVerified)}</>],
            ["Email", p.email && <>{p.email} {verified(p.emailVerified)}</>],
            ["Date of birth", p.dob && day(p.dob)],
            ["Gender", p.gender],
            ...(p.staff ? [["Staff access", p.owner ? "Platform owner" : p.staff.length ? p.staff.map((f) => FEATURE_NAMES[f]).join(", ") : "None"] as [string, string]] : []),
            ...(p.suspensionReason ? [["Suspended for", p.suspensionReason] as [string, string]] : []),
            ...(p.roomBarredAt ? [["Rooms", <Badge key="r" tone="error">{`Barred from rooms since ${day(p.roomBarredAt)}`}</Badge>] as [string, ReactNode]] : []),
            ...(p.deletionDue ? [["Deletion", <Badge key="d" tone="warning">{`Deletes on ${day(p.deletionDue)} unless they keep the account`}</Badge>] as [string, ReactNode]] : []),
          ]}
        />
      </Container>

      <Container title="Hosts" count={p.hosts.length}>
        {p.hosts.length === 0 ? (
          <p className={ui.secondary}>Not an Admin of any host.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {p.hosts.map((h) => (
                <tr key={h.id}>
                  <td>
                    {/* A host's page is Hosts'. No prefetch: opening it is written to the audit log. */}
                    {features.includes("hosts") ? (
                      <Link href={`/hosts/${h.id}`} prefetch={false}>
                        {h.name}
                      </Link>
                    ) : (
                      h.name
                    )}
                  </td>
                  <td>{h.owner ? "Admin, Owner" : "Admin"}</td>
                  <td>
                    <HostStatus status={h.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>

      <Container title="Devices" count={p.devices.length}>
        {p.devices.length === 0 ? (
          <p className={ui.secondary}>Not signed in anywhere.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Device</th>
                <th>On</th>
                <th>Signed in</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {p.devices.map((d) => (
                <tr key={d.since + d.name}>
                  <td>{d.name}</td>
                  <td>{d.client === "app" ? "App" : "Web"}</td>
                  <td>{day(d.since)}</td>
                  <td>{time(d.lastActive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>

      <Container title="History" count={p.history.length}>
        {p.history.length === 0 ? (
          <p className={ui.secondary}>Nothing has been done to this account.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>What</th>
                <th>By</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {p.history.map((h, i) => (
                <tr key={i}>
                  <td>{DID[h.action] ?? h.action}</td>
                  <td>{h.by ?? "No name yet"}</td>
                  <td>{h.reason ?? "–"}</td>
                  <td>{time(h.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>

      {viewer.ok && viewer.data.id !== p.id && (
        <Container title="Actions">
          <PersonActions person={p} features={features} stack />
          {p.roomBarredAt && features.includes("queues") && <Act label="Lift bar from rooms" action={unbarFromRooms} hidden={{ id: p.id }} who="Staff see this" />}
        </Container>
      )}
    </div>
  );
}
