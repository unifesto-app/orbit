import { FEATURES, type InterestList } from "@orbit/contract";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, PageHeader, Pages, ui } from "../../ui";
import s from "./page.module.css";

// Prelaunch (owner, 17 Nov 2026: "create a page in galaxy web - prelaunch in that display all the info"): everyone on
// the landing page's waitlist, newest first, with the features they want and what their visit said. Rows from before
// 18 Nov 2026 have an email only. API: GET /galaxy/prelaunch, for holders of People.
export const metadata: Metadata = { title: "Prelaunch" };

export default function Prelaunch({ searchParams }: PageProps<"/prelaunch">) {
  return (
    <div className={ui.page}>
      <PageHeader title="Prelaunch" description="Everyone on the waitlist at heyorbit.in, newest first. Country is Cloudflare's; region and city show once its visitor location headers are on." />
      <Suspense fallback={null}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// A time as staff read it, in India's time.
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// "Chrome on iPhone" from a user agent, for reading at a glance; the whole string is on hover.
// ponytail: a few common names, not a parser; the full user agent is kept for anything finer.
function device(ua?: string) {
  if (!ua) return null;
  const app = /Instagram/.test(ua) ? "Instagram" : /FBAN|FBAV/.test(ua) ? "Facebook" : /LinkedInApp/.test(ua) ? "LinkedIn" : /Twitter for|TwitterAndroid/.test(ua) ? "X" : /Edg\/|EdgiOS|EdgA\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  return app && os ? `${app} on ${os}` : (app ?? os ?? "Other");
}

// Where they came from, by site only. heyorbit.in itself (a reload, or an app's in-app browser passing the page on) is
// no source, so it reads as Direct; the Campaign column still shows a tagged link.
const site = (referrer?: string) => {
  try {
    const host = referrer ? new URL(referrer).hostname.replace(/^www\./, "") : null;
    return host === "heyorbit.in" ? null : host;
  } catch {
    return referrer ?? null;
  }
};

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
                  <td title={p.referrer}>{site(p.referrer) ?? "Direct"}</td>
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
