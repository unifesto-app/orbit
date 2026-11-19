import type { SiteStats } from "@orbit/contract";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, Pairs, ui } from "../../ui";
import { Days, Ranked } from "../charts";
import c from "../charts.module.css";

// Website (owner, 19 Nov 2026: "website and pages analytics in galaxy web", "Our own visit log"): visits to heyorbit.in
// from the site's own log (contract visit.ts): no cookies, each visitor a code that changes daily, so a visitor here is
// a visitor-day. Conversion is read from the log alone, joins and visits alike, so it starts on the day the log did.
// API: GET /galaxy/website/stats, for holders of People.
export const metadata: Metadata = { title: "Website" };

export default function Website() {
  return (
    <div className={ui.page}>
      <PageHeader title="Website" description="Visits to heyorbit.in over the last 30 days, from the site's own log: no cookies, and a visitor counts once a day. Times are India's." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// "42 s", "3 min 5 s".
const secs = (s: number | null) => {
  if (s === null) return "–";
  const n = Math.round(s);
  return n < 60 ? `${n} s` : `${Math.floor(n / 60)} min ${n % 60} s`;
};
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Core Web Vitals in words, by Google's thresholds (good, then poor): the 75th percentile of views.
const rate = (v: number | null, good: number, poor: number, show: (v: number) => string) =>
  v === null ? "–" : `${show(v)} · ${v <= good ? "Good" : v <= poor ? "Needs work" : "Poor"}`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const msOf = (ms: number) => `${ms} ms`;

async function Body() {
  await connection(); // read on each visit: written to the audit log
  const r = await read<SiteStats>("/galaxy/website/stats");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const t = r.data;
  if (!t.since)
    return (
      <Container title="Visits">
        <p className={ui.secondary}>No visits logged yet. They show here once the site with the visit log is live.</p>
      </Container>
    );
  const f = t.funnel;
  const tiles: [string, string | number][] = [
    ["Visitors", t.visitors],
    ["Page views", t.views],
    ["Visitors today", t.today.visitors],
    ["Joined", pct(f.joined, f.visitors)],
    ["Time on a page", secs(t.seconds)],
    ["Load time", t.vitals.lcp === null ? "–" : sec(t.vitals.lcp)],
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
        <p className={ui.secondary}>Visitors a day, the last 30 days</p>
        <Days days={t.days.map((d) => ({ day: d.day, count: d.visitors }))} label="Visitors a day, last 30 days" series="Visitors" />
        <p className={c.note}>Logged since {day(t.since)}. Joins before then, and visits from browsers that block the log, aren&apos;t counted here.</p>
      </Container>
      <div className={c.grid}>
        <Container title="From visit to join">
          <Ranked
            series="Visitors"
            label="Visitors who reached each step"
            of={f.visitors}
            data={[
              { name: "Visited", count: f.visitors },
              { name: "Started the form", count: f.started },
              { name: "Got a code", count: f.code },
              { name: "Joined", count: f.joined },
            ]}
          />
        </Container>
        <Container title="Where visitors came from">
          <Ranked
            series="Visitors"
            label="Visitors by source, and how many joined"
            data={t.sources.map((s) => ({ name: s.name, count: s.visitors, value: `${s.visitors} · ${s.joined} joined (${pct(s.joined, s.visitors)})` }))}
          />
          <p className={c.note}>Each visitor counts under the source of their first page that day.</p>
        </Container>
        <Container title="Pages">
          <Ranked
            series="Views"
            label="Views by page"
            data={t.pages.map((p) => ({ name: p.name, count: p.views, value: `${count(p.views, "view", "views")} · ${count(p.visitors, "visitor", "visitors")} · ${secs(p.seconds)}` }))}
          />
          <p className={c.note}>Time is the median a view, counting only while the page was on screen.</p>
        </Container>
        <Container title="Speed">
          <Pairs
            pairs={[
              ["Load (largest paint)", rate(t.vitals.lcp, 2500, 4000, sec)],
              ["Response to taps (INP)", rate(t.vitals.inp, 200, 500, msOf)],
              ["Layout shift (CLS)", rate(t.vitals.cls, 0.1, 0.25, String)],
              ["Server response (TTFB)", rate(t.vitals.ttfb, 800, 1800, msOf)],
            ]}
          />
          <p className={c.note}>
            {t.vitals.samples
              ? `The slowest quarter of ${count(t.vitals.samples, "view", "views")} is at or above these, by Google’s Core Web Vitals.`
              : "Load times show once visits from real browsers are logged."}
          </p>
        </Container>
        <Container title="Phone or computer">
          <Ranked series="Visitors" label="Visitors by system" of={t.visitors} data={t.os} />
        </Container>
        <Container title="Browser or app">
          <Ranked series="Visitors" label="Visitors by browser or app" of={t.visitors} data={t.apps} />
        </Container>
        <Container title="Cities">
          <Ranked series="Visitors" label="Visitors by city" of={t.visitors} data={t.cities} />
        </Container>
        <Container title="Countries">
          <Ranked series="Visitors" label="Visitors by country" of={t.visitors} data={t.countries.map((x) => ({ ...x, name: country(x.name) }))} />
        </Container>
      </div>
    </>
  );
}

// "India" from Cloudflare's "IN"; a code it can't name stays as it is.
const regions = new Intl.DisplayNames(["en"], { type: "region" });
function country(code: string) {
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}
