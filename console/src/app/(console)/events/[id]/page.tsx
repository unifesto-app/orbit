import type { EventAnnouncements, TeamEvent } from "@orbit/contract";
import { call, read } from "../../../../api";
import ui from "../../../ui.module.css";
import styles from "./event.module.css";
import { Announce, AutoSwitches } from "./forms";

// An event in the Console: its messages to ticket holders for now (notifications PR 10). Announce and the automatic
// messages for Admins; Crew read what was sent. Its details, tickets and team come in as those pages are built.
// ponytail: no Events list links here yet; reached by its link until the Events page lands.
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function EventPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const got = await read<EventAnnouncements>(`/events/${encodeURIComponent(id)}/announcements`);
  if (!got.ok) throw new Error(got.error.message);
  const event = await call<TeamEvent>("GET", `/events/${encodeURIComponent(id)}`); // Admins only; Crew see no title or forms
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
            <Announce eventId={id} left={left} />
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
