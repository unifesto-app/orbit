import type { ContentAdmin } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, Container, ui } from "../../ui";
import { AdsEditor, AsksEditor, HelpEditor } from "./editors";

// App content (owner, 19 Nov 2026: "build CMS for Orbit App in galaxy web"; API: /galaxy/app-content), for holders of
// Platform: the words Orbit itself writes in the app, each list saved whole (contract/src/content.ts). Hosts' events
// and pages are theirs and never edited here.
export const metadata: Metadata = { title: "App content" };

export default function AppContentPage() {
  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <h1 className={ui.h1}>App content</h1>
        <p className={ui.secondary}>What Orbit itself says in the app. Phones pick up a saved change within a couple of minutes of opening it.</p>
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
      {s ? `Last saved ${when(s.at)}${s.by ? ` by ${s.by}` : ""}.` : "Never saved: the app shows Orbit’s first words, as below."}
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
      <Container title="Ad strips" count={content.ads.length}>
        <p className={ui.secondary}>
          Orbit’s own offers, never a host’s paid reach. Home shows the first two live ads marked Home, after your events and after everything coming up;
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
      </Container>
    </>
  );
}
