import type { AskAdmin, ContentAdmin } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Badge, Container, ui } from "../../ui";
import { AdsEditor, AsksEditor, AskSwitch, FeaturedEditor, HelpEditor, KnowledgeEditor, PromotedEditor } from "./editors";

// App content (owner, 19 Nov 2026: "build CMS for Orbit App in galaxy web"; API: /galaxy/app-content), for holders of
// Platform: the words Orbit itself writes in the app, each list saved whole (contract/src/content.ts). Hosts' events
// and pages are theirs and never edited here.
export const metadata: Metadata = { title: "App content" };

export default function AppContentPage() {
  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <h1 className={ui.h1}>App content</h1>
        <p className={ui.secondary}>What Orbit itself puts in the app. Phones pick up a saved change within a couple of minutes of opening it.</p>
      </header>
      <Suspense fallback={null}>
        <Load />
      </Suspense>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function LastSaved({ s }: { s: ContentAdmin["saved"][keyof ContentAdmin["saved"]] }) {
  return (
    <p className={ui.secondary}>
      {s ? `Last saved ${when(s.at)}${s.by ? ` by ${s.by}` : ""}.` : "Never saved: the app shows what’s below, as it did before App content."}
    </p>
  );
}

async function Load() {
  const r = await read<ContentAdmin>("/galaxy/app-content");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { content, saved } = r.data;
  // The server's clock, once per request after the signed-in read, so the ad badges agree when the page comes alive.
  const now = new Date().getTime();
  return (
    <>
      <Container title="Featured" count={content.featured.length}>
        <p className={ui.secondary}>
          Home’s carousel, right after a promoted event, in this order, unlabelled: an event or host with its own 4:3 picture, or Orbit’s own image slide.
          The carousel fills the rest itself, six slides in all.
        </p>
        <LastSaved s={saved.featured} />
        <FeaturedEditor initial={content.featured} at={saved.featured?.at ?? null} now={now} />
      </Container>

      <Container title="Promoted" count={content.promoted.length}>
        <p className={ui.secondary}>
          Events marked Promoted: the label on their rows, first in lists and search, the carousel’s first slide and the banner in the middle of Home (those
          two need a 4:3 poster). Set here until hosts can buy Boost.
        </p>
        <LastSaved s={saved.promoted} />
        <PromotedEditor initial={content.promoted} at={saved.promoted?.at ?? null} now={now} />
      </Container>

      <Container title="Ad strips" count={content.ads.length}>
        <p className={ui.secondary}>
          Orbit’s own offers, never a host’s paid reach: three lines of words, or an uploaded 4.5:1 image. Home shows the first two live ads marked Home, after your events and after everything coming up;
          Search and Account show the first live one marked for each. An ad is live from its start to its end, by the phone’s clock.
        </p>
        <LastSaved s={saved.ads} />
        <AdsEditor initial={content.ads} at={saved.ads?.at ?? null} now={now} />
      </Container>

      <Container title="Help answers" count={content.help.length}>
        <p className={ui.secondary}>Account › Help and support. Questions show as rows; each answer opens under its question.</p>
        <LastSaved s={saved.help} />
        <HelpEditor initial={content.help} at={saved.help?.at ?? null} />
      </Container>

      <Container title="Ask Orbit" count={content.asks.length}>
        <p className={ui.secondary}>The chips on the chat’s welcome and on Search. A tap opens the chat with the words typed in.</p>
        <LastSaved s={saved.asks} />
        <AsksEditor initial={content.asks} at={saved.asks?.at ?? null} />
        <AskPanel />
      </Container>

      <Container title="Knowledge for Ask Orbit" count={content.knowledge.length}>
        <p className={ui.secondary}>
          What Ask Orbit knows beyond the Help answers and what’s on Orbit: policies, how things work, what to say when. Anyone can get these words back by
          asking Orbit, so put nothing internal here.
        </p>
        <LastSaved s={saved.knowledge} />
        <KnowledgeEditor initial={content.knowledge} at={saved.knowledge?.at ?? null} />
      </Container>
    </>
  );
}

const STATUS: Record<AskAdmin["log"][number]["status"], [string, "success" | "warning" | "error"]> = {
  ok: ["Answered", "success"],
  refused: ["Refused", "warning"],
  error: ["Failed", "error"],
};
const dollars = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

// The assistant itself (API: GET /galaxy/ask): its switch, whether the server has a model key, what it cost per India
// day, and the latest 50 questions with their replies. Reading them is logged.
async function AskPanel() {
  const r = await read<AskAdmin>("/galaxy/ask");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { on, keySet, days, log } = r.data;
  return (
    <>
      <AskSwitch on={on} />
      <p className={ui.secondary}>{keySet ? "Model key set." : "Model key not set: the chat says Ask Orbit is resting until it is."}</p>
      <h3 className={ui.containerHeader}>Cost per day</h3>
      {days.length === 0 ? (
        <p className={ui.secondary}>No questions in the last 30 days.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Day</th>
              <th>Questions</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td>{new Date(`${d.day}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</td>
                <td>{d.asks}</td>
                <td>{dollars(d.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className={ui.containerHeader}>Latest questions</h3>
      {log.length === 0 ? (
        <p className={ui.secondary}>Nobody has asked yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Question</th>
              <th>Reply</th>
              <th>State</th>
              <th>Tokens</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {log.map((a, i) => (
              <tr key={i}>
                <td>{when(a.at)}</td>
                <td>{a.who ?? "No name yet"}</td>
                <td>{a.question}</td>
                <td>{a.reply ?? "–"}</td>
                <td>
                  <Badge tone={STATUS[a.status][1]}>{STATUS[a.status][0]}</Badge>
                </td>
                <td>{a.tokens.toLocaleString("en-IN")}</td>
                <td>{dollars(a.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
