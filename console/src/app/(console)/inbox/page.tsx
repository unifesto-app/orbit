import type { InboxPage } from "@orbit/contract";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../api";
import { INBOX_APP, kindLabel, whenLabel } from "../../../inbox";
import ui from "../../ui.module.css";
import { MarkAll, SeenOnView } from "./read";
import styles from "./inbox.module.css";

// The Console's Inbox: Event Partner's messages (app "launch"), newest first, 30 a page. Viewing a page marks its unread
// rows read; their dots stay until the next visit, so the host still sees what was new.
export default function Inbox({ searchParams }: PageProps<"/inbox">) {
  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <h1 className={ui.h1}>Inbox</h1>
        <p className={ui.secondary}>Messages for your teams and events. The same inbox as the Orbit Event Partner app.</p>
      </header>
      {/* The messages are this person's, read at request time; the heading renders ahead of them. */}
      <Suspense fallback={<p className={ui.secondary}>Loading…</p>}>
        <Messages searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Messages({ searchParams }: Pick<PageProps<"/inbox">, "searchParams">) {
  const { before } = await searchParams;
  const cursor = typeof before === "string" ? before : undefined;
  const r = await read<InboxPage>(`/me/inbox?app=${INBOX_APP}${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`);
  const unseen = r.ok ? r.data.items.filter((i) => !i.read).map((i) => i.id) : [];

  return (
    <>
      <section className={ui.container}>
        <div className={styles.head}>
          <h2 className={ui.containerHeader}>Messages{r.ok && r.data.unread > 0 ? ` (${r.data.unread} unread)` : ""}</h2>
          {r.ok && r.data.unread > 0 && <MarkAll />}
        </div>
        <div className={ui.containerBody}>
          {!r.ok ? (
            <p className={ui.secondary}>{r.error.message}</p>
          ) : r.data.items.length === 0 ? (
            <p className={ui.secondary}>{cursor ? "No older messages." : "Nothing yet. Messages about your teams and events show here."}</p>
          ) : (
            <ul className={styles.list}>
              {r.data.items.map((m) => (
                <li key={m.id} className={styles.row}>
                  <span className={styles.dot} data-unread={!m.read || undefined} aria-label={m.read ? undefined : "Unread"} />
                  <div className={styles.body}>
                    <div className={styles.line}>
                      <span className={styles.from}>{m.from}</span>
                      <span className={ui.secondary}>{kindLabel(m.kind)}</span>
                      <time className={`${ui.secondary} ${styles.time}`} dateTime={m.at}>
                        {whenLabel(m.at)}
                      </time>
                    </div>
                    <p>{m.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {r.ok && (cursor || r.data.next) && (
            <div className={styles.pages}>
              {cursor && <Link href="/inbox">Newest</Link>}
              {r.data.next && <Link href={`/inbox?before=${encodeURIComponent(r.data.next)}`}>Older</Link>}
            </div>
          )}
        </div>
      </section>
      <SeenOnView ids={unseen} />
    </>
  );
}
