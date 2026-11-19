import type { AnalyticsStats } from "@orbit/contract";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, Pairs, ui } from "../../ui";
import { Bins, Days, Ranked } from "../charts";
import c from "../charts.module.css";

// Analytics (owner, 19 Nov 2026: "user analytics, mau, dau etc", "app analytics and more"): who uses Orbit, how often,
// on what, and whether they come back. Active people come from the API's activity log (api/src/activity.ts): one row per
// person a day, kept 90 days, so the charts start on the day the log did. API: GET /galaxy/analytics, for holders of
// People; each read is written to the audit log.
export const metadata: Metadata = { title: "Analytics" };

export default function Analytics() {
  return (
    <div className={ui.page}>
      <PageHeader title="Analytics" description="Who uses Orbit, how often, on what, and whether they come back. Days are India’s." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

const n = (v: number) => v.toLocaleString("en-IN");
const pct = (part: number, of: number) => (of ? `${Math.round((part / of) * 100)}%` : "–");
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function Tiles({ tiles }: { tiles: [string, string, string?][] }) {
  return (
    <div className={c.tiles}>
      {tiles.map(([label, value, note]) => (
        <div key={label} className={c.tile}>
          <span className={ui.secondary}>{label}</span>
          <span className={c.tileValue}>{value}</span>
          {note && <span className={ui.secondary}>{note}</span>}
        </div>
      ))}
    </div>
  );
}

async function Body() {
  await connection(); // read on each visit: written to the audit log
  const r = await read<AnalyticsStats>("/galaxy/analytics");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const t = r.data;
  const a = t.active;

  return (
    <>
      <Container title="Active people">
        <Tiles
          tiles={[
            ["Today (DAU)", n(a.day), "so far"],
            ["Last 7 days (WAU)", n(a.week)],
            ["Last 30 days (MAU)", n(a.month)],
            // How many of the month's people use Orbit on a given day: the usual measure of how much it's part of their week.
            ["Stickiness", pct(a.day, a.month), "today of the month"],
          ]}
        />
        {t.since ? (
          <>
            <p className={ui.secondary}>People active a day, the last 30 days</p>
            <Days days={t.days.map((d) => ({ day: d.day, count: d.active }))} label="People active a day, last 30 days" series="Active" />
            <p className={ui.secondary}>Of them, new that day (signed up the same day)</p>
            <Days days={t.days.map((d) => ({ day: d.day, count: d.new }))} label="New people active a day, last 30 days" series="New" />
            <p className={c.note}>
              Counting since {day(t.since)}: a person counts once a day on each of iOS, Android and the web, while signed in. Staff working in Galaxy
              aren’t counted.
            </p>
          </>
        ) : (
          <p className={c.note}>Nobody counted yet. The log starts with the first signed-in use after this version of the API is live.</p>
        )}
      </Container>

      <div className={c.grid}>
        <Container title="Retention">
          {t.retention.some((w) => w.size) ? (
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Signed up the week of</th>
                  <th>People</th>
                  <th>Week 1</th>
                  <th>Week 2</th>
                  <th>Week 3</th>
                  <th>Week 4</th>
                </tr>
              </thead>
              <tbody>
                {t.retention.map((w) => (
                  <tr key={w.week}>
                    <td>{short(w.week)}</td>
                    <td>{n(w.size)}</td>
                    {w.weeks.map((s, i) => (
                      // Blank, not 0%, while that week is still going.
                      <td key={i}>{s === null || !w.size ? "" : `${Math.round(s * 100)}%`}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={c.empty}>No sign-ups in the last 8 full weeks yet.</p>
          )}
          <p className={c.note}>The share of each week’s sign-ups who used Orbit again in each of the four weeks after. A week is Monday to Sunday.</p>
        </Container>

        <Container title="Platforms, last 30 days">
          <Ranked data={t.platforms} of={a.month} label="Active people by platform" />
          <p className={c.note}>Someone on both iPhone and the web counts under each.</p>
        </Container>

        <Container title="App versions, last 7 days">
          <Ranked data={t.versions} of={a.week} label="Active people by app version" />
          <p className={c.note}>Builds from before this count show as App (older build) under Platforms.</p>
        </Container>

        <Container title="How people sign in, last 30 days">
          <Ranked data={t.signIns} label="Sign-ins by way" series="Sign-ins" />
          <p className={c.note}>Each sign-in by its latest check (a code asked for later, to confirm a change, replaces how it began). Staff signing in to Galaxy aren’t counted.</p>
        </Container>

        <Container title="Ways to sign in set up">
          <Ranked data={t.ways} of={t.follows.people} label="Accounts with each way to sign in" series="Accounts" />
        </Container>

        <Container title="Ages">
          <Bins data={t.ages} label="Accounts by age" />
        </Container>

        <Container title="Gender">
          <Ranked data={t.genders} of={t.follows.people} label="Accounts by gender" series="Accounts" />
        </Container>

        <Container title="Cities">
          <Ranked data={t.cities} of={t.follows.people} label="Accounts by city" series="Accounts" />
        </Container>

        <Container title="Following hosts">
          <Pairs
            pairs={[
              ["Accounts", n(t.follows.people)],
              ["Following a host", `${n(t.follows.following)} (${pct(t.follows.following, t.follows.people)})`],
              ["Follows per account", t.follows.average.toFixed(2)],
            ]}
          />
        </Container>

        <Container title="Deletions">
          <Pairs
            pairs={[
              ["Waiting out their 30 days", n(t.deletions.pending)],
              ["Deleted, last 30 days", n(t.deletions.month)],
            ]}
          />
        </Container>
      </div>
    </>
  );
}
