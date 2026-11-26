import type { StaffSupportThread } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, Container, PageHeader, Pairs, phone, ui } from "../../../ui";
import { time } from "../../requests/status";
import { Reply, SetStatus } from "../forms";
import { appLabel, SupportBadge, who } from "../status";
import styles from "../support.module.css";

// One support thread (X16; API: GET /galaxy/support/:id): every message in order, the reply box, and Close or Reopen.
export const metadata: Metadata = { title: "Support thread" };

export default function ThreadPage({ params }: PageProps<"/support/[id]">) {
  return (
    <Suspense fallback={null}>
      <Thread params={params} />
    </Suspense>
  );
}

async function Thread({ params }: Pick<PageProps<"/support/[id]">, "params">) {
  const { id } = await params;
  const [r, viewer] = await Promise.all([read<StaffSupportThread>(`/galaxy/support/${encodeURIComponent(id)}`), me()]);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const t = r.data;
  // A person's page is People's; holders of Queues alone see the name.
  const people = viewer.ok && !!viewer.data.staff?.features.includes("people");
  const name = who(t.person);

  const pairs: [string, ReactNode][] = [
    ["Status", <SupportBadge key="s" status={t.status} />],
    ["App", appLabel(t.app)],
    ["From", people ? <Link href={`/users/${t.person.id}`} prefetch={false}>{name}</Link> : name],
    ["Phone", t.person.phone && phone(t.person.phone)],
    ["Email", t.person.email],
    ["Started", time(t.createdAt)],
  ];

  return (
    <div className={ui.page}>
      <PageHeader title={name} description={`${appLabel(t.app)} · last message ${time(t.updatedAt)}`} />

      <Container title="Thread">
        <Pairs pairs={pairs} />
      </Container>

      <Container title="Messages" count={t.messages.length}>
        <ol className={styles.messages}>
          {t.messages.map((m) => (
            <li key={m.id}>
              <p className={ui.secondary}>
                {m.from === "person" ? name : `${m.name ?? "Orbit"}, staff`} · {time(m.at)}
              </p>
              <p className={styles.body}>{m.body}</p>
            </li>
          ))}
        </ol>
      </Container>

      <Container title="Actions">
        <div className={ui.page}>
          <Reply id={t.id} />
          <SetStatus id={t.id} closed={t.status === "closed"} />
        </div>
      </Container>
    </div>
  );
}
