import type { CareersStats } from "@orbit/contract";
import { connection } from "next/server";
import { read } from "../../../api";
import { Alert, Container, ui } from "../../ui";
import { Days, Ranked } from "../charts";
import c from "../charts.module.css";

// Careers analytics (owner, 22 Nov 2026: "bring analytics for careers"; API: GET /galaxy/careers/stats, for holders of
// People), above the openings: applications from the applications table, visitors and sources from the site's own
// cookieless visit log (a visitor is a visitor-day; "applied" is a careers visit the Apply form was sent from).

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

export async function Analytics() {
  await connection(); // the read is written to the audit log: never for a prefetch
  const r = await read<CareersStats>("/galaxy/careers/stats");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const t = r.data;
  const f = t.funnel;
  const tiles: [string, string | number][] = [
    ["Applications", t.total],
    ["Today", t.today],
    ["Last 7 days", t.week],
    ["Open roles", t.open],
    ["Careers visitors", t.visitors],
    ["Opened a role and applied", pct(f.applied, f.opening)],
  ];
  return (
    <>
      <Container title="At a glance">
        <div className={c.tiles}>
          {tiles.map(([label, value]) => (
            <div key={label} className={c.tile}>
              <span className={ui.secondary}>{label}</span>
              <span className={c.tileValue}>{value}</span>
            </div>
          ))}
        </div>
        <p className={ui.secondary}>Applications a day, the last 30 days</p>
        <Days days={t.days} label="Applications a day, last 30 days" series="Applications" />
        <p className={c.note}>Visitors are the last 30 days of the careers pages, a visitor counted once a day. Times are India&apos;s.</p>
      </Container>
      <div className={c.grid}>
        <Container title="Pipeline">
          <Ranked series="Applications" label="Applications by status" of={t.total} data={t.statuses} />
        </Container>
        <Container title="From visit to application">
          <Ranked
            series="Visitors"
            label="Careers visitors who reached each step"
            of={t.visitors}
            data={[
              { name: "Visited careers", count: t.visitors },
              { name: "Saw the list", count: f.list },
              { name: "Opened a role", count: f.opening },
              { name: "Applied", count: f.applied },
            ]}
          />
          <p className={c.note}>Some visitors open a role from a link without seeing the list.</p>
        </Container>
        <Container title="Where visitors came from">
          {t.sources.length === 0 ? (
            <p className={ui.secondary}>No careers visits yet.</p>
          ) : (
            <Ranked
              series="Visitors"
              label="Careers visitors by source, and how many applied"
              data={t.sources.map((s) => ({ name: s.name, count: s.visitors, value: `${s.visitors} · ${s.applied} applied (${pct(s.applied, s.visitors)})` }))}
            />
          )}
          <p className={c.note}>Each visitor counts under the source of their first careers page that day. Applications sent before sources were tracked aren&apos;t counted as applied here.</p>
        </Container>
        <Container title="By city">
          {t.cities.length === 0 ? <p className={ui.secondary}>No applications yet.</p> : <Ranked series="Applications" label="Applications by city" of={t.total} data={t.cities} />}
        </Container>
        <Container title="By role">
          {t.roles.length === 0 ? <p className={ui.secondary}>No applications yet.</p> : <Ranked wide series="Applications" label="Applications by role, all cities" of={t.total} data={t.roles} />}
        </Container>
        <Container title="Most applied">
          {t.openings.length === 0 ? <p className={ui.secondary}>No applications yet.</p> : <Ranked wide series="Applications" label="The openings with the most applications" data={t.openings} />}
        </Container>
      </div>
    </>
  );
}
