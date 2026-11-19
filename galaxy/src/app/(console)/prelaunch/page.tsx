import { deviceOf, type Feature, FEATURES, type InterestList, type InterestStats, SHARED, sourceOf } from "@orbit/contract";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, Pages, ui } from "../../ui";
import { Bins, Days, Hours, Ranked } from "../charts";
import c from "../charts.module.css";
import s from "./page.module.css";

// Prelaunch (owner, 17 Nov 2026: "create a page in galaxy web - prelaunch in that display all the info"): everyone on
// the landing page's waitlist, newest first, with the features they want and what their visit said. Rows from before
// 18 Nov 2026 have an email only. API: GET /galaxy/prelaunch, for holders of People.
export const metadata: Metadata = { title: "Prelaunch" };

export default function Prelaunch({ searchParams }: PageProps<"/prelaunch">) {
  return (
    <div className={ui.page}>
      <PageHeader title="Prelaunch" description="The waitlist at heyorbit.in: all of it summed up, then everyone, newest first. Times are India's. Country is Cloudflare's, and region and city too for joins since 18 Nov 2026." />
      <Suspense fallback={null}>
        <Analytics searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// A time as staff read it, in India's time.
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// "Chrome on iPhone", read as the analytics read it (contract deviceOf); the whole string is on hover.
function device(ua?: string) {
  if (!ua) return null;
  const { app, os } = deviceOf(ua);
  return app && os ? `${app} on ${os}` : (app ?? os ?? "Other");
}

// "India" from Cloudflare's "IN"; a code it can't name stays as it is.
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const country = (code: string) => {
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
};

// The whole waitlist summed up (API GET /galaxy/prelaunch/stats), above the list. Only joins are kept: no visits, so
// no conversion.
// Short names for the chart, where FEATURES' full labels would be cut.
const WANTS: Record<Feature, string> = {
  fests: "Fests",
  slots: "Turf, courts, gaming",
  hackathons: "Hackathons",
  inroom: "inRoom at meetups",
  performers: "Comedians and bands",
  host: "Hosting events",
};

async function Analytics({ searchParams }: Pick<PageProps<"/prelaunch">, "searchParams">) {
  const page = (await searchParams).page;
  if (page && page !== "1") return null; // on the first page only, so paging the list doesn't sum it all again
  await connection();
  const r = await read<InterestStats>("/galaxy/prelaunch/stats");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const t = r.data;
  const shared = t.sources.find((x) => x.name === SHARED)?.count ?? 0;
  const picked = t.asked - t.wantedNone;
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
  const tiles: [string, string | number][] = [
    ["People", t.total],
    ["Joined today", t.today],
    ["Last 7 days", t.week],
    ["Median age", t.medianAge ?? "–"],
    ["Picked a feature", pct(picked, t.asked)],
    ["From shares", shared],
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
        <p className={ui.secondary}>Joins a day, the last 30 days</p>
        <Days days={t.days} />
      </Container>
      <div className={c.grid}>
        <Container title="What they want">
          <Ranked label="People who picked each feature" of={t.asked} data={t.wants.map((w) => ({ name: WANTS[w.feature], count: w.count }))} />
          <p className={c.note}>
            A person can pick several. {t.wantedNone} picked none.{t.asked < t.total && ` Out of ${t.asked}: the first ${t.total - t.asked} joined before features were asked.`}
          </p>
        </Container>
        <Container title="Where they came from">
          <Ranked label="People by source" of={t.total} data={t.sources} />
        </Container>
        <Container title="Age">
          <Bins label="People by age" data={t.ages} />
        </Container>
        <Container title="Hour they join">
          <Hours hours={t.hours} />
        </Container>
        <Container title="Phone or computer">
          <Ranked label="People by system" of={t.total} data={t.os} />
        </Container>
        <Container title="Browser or app">
          <Ranked label="People by browser or app" of={t.total} data={t.apps} />
        </Container>
        <Container title="Cities">
          <Ranked label="People by city" data={t.cities} />
          <p className={c.note}>From Cloudflare, for joins since 18 Nov 2026: {t.located} of {t.total} so far.</p>
        </Container>
        <Container title="Email domains">
          <Ranked label="People by email domain" of={t.total} data={t.emailDomains} />
          <p className={c.note}>College and work domains show where people study and work.</p>
        </Container>
        {t.campaigns.length > 0 && (
          <Container title="Tagged links">
            <Ranked label="People by tagged link" data={t.campaigns} />
          </Container>
        )}
        <Container title="Countries">
          <Ranked label="People by country" data={t.countries.map((c) => ({ ...c, name: country(c.name) }))} />
        </Container>
      </div>
    </>
  );
}

async function Body({ searchParams }: Pick<PageProps<"/prelaunch">, "searchParams">) {
  await connection(); // the list is written to the audit log: never for a prefetch
  const raw = (await searchParams).page;
  const page = Array.isArray(raw) ? raw[0] : raw; // the API answers page 1 for anything it can't read
  const r = await read<InterestList>(`/galaxy/prelaunch?page=${encodeURIComponent(page ?? "1")}`);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const list = r.data;
  return (
    <Container title="Waitlist" count={list.total}>
      {list.people.length === 0 ? (
        <p className={ui.secondary}>Nobody yet.</p>
      ) : (
        <div className={s.scroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>WhatsApp</th>
                <th>Date of birth</th>
                <th>Wants</th>
                <th>Email</th>
                <th>Joined</th>
                <th>Country</th>
                <th>Region, city</th>
                <th>Came from</th>
                <th>Campaign</th>
                <th>Device</th>
                <th>Languages</th>
                <th>Time zone</th>
                <th>Screen</th>
                <th>IP address</th>
              </tr>
            </thead>
            <tbody>
              {list.people.map((p) => (
                <tr key={p.id}>
                  <td>{p.name ?? "–"}</td>
                  <td>{p.phone ?? "–"}</td>
                  <td>{p.dob ?? "–"}</td>
                  <td>{p.features.map((f) => FEATURES[f] ?? f).join(", ") || "–"}</td>
                  <td>{p.email ?? "–"}</td>
                  <td>{when(p.createdAt)}</td>
                  <td>{p.country ?? "–"}</td>
                  <td>{[p.region, p.city].filter(Boolean).join(", ") || "–"}</td>
                  <td title={p.referrer}>{sourceOf(p)}</td>
                  <td>{p.utm ? Object.entries(p.utm).map(([k, v]) => `${k.replace(/^utm_/, "")}: ${v}`).join(", ") : "–"}</td>
                  <td title={p.userAgent}>{device(p.userAgent) ?? "–"}</td>
                  <td title={p.acceptLanguage}>{p.language ?? p.acceptLanguage?.split(",")[0] ?? "–"}</td>
                  <td>{p.timezone ?? "–"}</td>
                  <td>{p.screen ?? "–"}</td>
                  <td>{p.ip ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pages path="/prelaunch" {...list} />
    </Container>
  );
}
