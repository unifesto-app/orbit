import { type OpeningList, OPENING_STATUSES } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Badge, Container, day, PageHeader, ui } from "../../ui";
import { SITE } from "./site";

// Careers (owner, 22 Nov 2026: "careers page at heyorbit.in/careers, link to galaxy", "Openings + applications"; API:
// /galaxy/openings), for holders of People: the openings heyorbit.in/careers shows while Open, and who has applied.
export const metadata: Metadata = { title: "Careers" };

export default function Careers() {
  return (
    <div className={ui.page}>
      <PageHeader title="Careers" description="Openings at heyorbit.in/careers, and the people who apply. Only Open ones show on the site, within a minute of saving." />
      <div className={ui.row}>
        <Link href="/careers/new" className={`${ui.btn} ${ui.primary}`}>
          New opening
        </Link>
        <a href={`${SITE}/careers`} target="_blank" rel="noopener noreferrer" className={ui.btn}>
          See the site ↗
        </a>
      </div>
      <Suspense fallback={null}>
        <List />
      </Suspense>
    </div>
  );
}

const TONE = { draft: "neutral", open: "success", closed: "warning" } as const;

async function List() {
  const r = await read<OpeningList>("/galaxy/openings");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { openings } = r.data;
  return (
    <Container title="Openings" count={openings.length}>
      {openings.length === 0 ? (
        <p className={ui.secondary}>None yet. Make one with New opening; it stays a draft until you set it to Open.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Role</th>
              <th>Team</th>
              <th>Where</th>
              <th>Status</th>
              <th>Applications</th>
              <th>New</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {openings.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/careers/${o.id}`}>{o.title}</Link>
                </td>
                <td>{o.team}</td>
                <td>{o.place}</td>
                <td>
                  <Badge tone={TONE[o.status]}>{OPENING_STATUSES[o.status]}</Badge>
                </td>
                <td>{o.applications}</td>
                <td>{o.fresh || "–"}</td>
                <td>{day(o.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Container>
  );
}
