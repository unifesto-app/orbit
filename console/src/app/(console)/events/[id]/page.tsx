import type { EventAnnouncements, TeamEvent } from "@orbit/contract";
import { Suspense } from "react";
import { call, read } from "../../../../api";
import ui from "../../../ui.module.css";
import styles from "./event.module.css";
import { Announce, AutoSwitches } from "./forms";

// An event in the Console: its messages to ticket holders for now (notifications PR 10). Announce and the automatic
// messages for Admins; Crew read what was sent. Its details, tickets and team come in as those pages are built.
// ponytail: no Events list links here yet; reached by its link until the Events page lands.
// Announcements close a week after the end (the API refuses with 409 too).
const closed = (e: TeamEvent) => !!e.endsAt && Date.now() > Date.parse(e.endsAt) + 7 * 86_400_000;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Read at request time (cacheComponents), so the page renders inside Suspense, as the Inbox does.
export default function EventPage({ params }: PageProps<"/events/[id]">) {
  return (
    <Suspense fallback={<div className={ui.page}><p className={ui.secondary}>Loading…</p></div>}>
      <Event params={params} />
    </Suspense>
  );
}

async function Event({ params }: Pick<PageProps<"/events/[id]">, "params">) {
  const { id } = await params;
  const got = await read<EventAnnouncements>(`/events/${encodeURIComponent(id)}/announcements`);
  if (!got.ok) throw new Error(got.error.message);
  // Admins only: a 404 is Crew, who see no title or forms; anything else is a failure.
  const event = await call<TeamEvent>("GET", `/events/${encodeURIComponent(id)}`);
  if (!event.ok && event.status !== 404) throw new Error(event.error.message);
  const admin = event.ok;
  const { items, left, autoMessages } = got.data;
  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <h1 className={ui.h1}>{admin ? event.data.title : "Event"}</h1>
        <p className={ui.secondary}>Messages to the people holding a ticket</p>
      </header>
      {admin && (
        <section className={ui.container}>
          <h2 className={ui.containerHeader}>Announce</h2>
          <div className={ui.containerBody}>
            {closed(event.data) ? <p className={ui.secondary}>This event ended more than a week ago, so announcements are closed.</p> : <Announce eventId={id} left={left} />}
          </div>
        </section>
      )}
      {admin && (
        <section className={ui.container}>
          <h2 className={ui.containerHeader}>Automatic messages</h2>
          <div className={ui.containerBody}>
            <AutoSwitches eventId={id} now={autoMessages} />
          </div>
        </section>
      )}
      <section className={ui.container}>
        <h2 className={ui.containerHeader}>Sent ({items.length})</h2>
        <div className={ui.containerBody}>
          {items.length === 0 && <p className={ui.secondary}>Nothing sent yet.</p>}
          {items.map((a) => (
            <div key={a.id} className={styles.sent}>
              <span>{a.text}</span>
              <span className={ui.secondary}>
                {when(a.createdAt)} · {a.audience === "everyone" ? "Everyone" : "Not checked in"} · {a.reached} reached{a.author ? ` · by ${a.author}` : ""}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
