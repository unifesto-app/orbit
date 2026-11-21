import type { ApplicationList, OpeningAdmin } from "@orbit/contract";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { read } from "../../../../api";
import { Alert, Container, PageHeader, Pages, ui } from "../../../ui";
import styles from "../careers.module.css";
import { DeleteApplication, OpeningForm, StatusPicker } from "../form";
import { SITE } from "../site";

// One opening: its editor, then everyone who applied, newest first, each with their résumé (downloaded through
// ../resume/[id], never a public link) and a status. Reading the list is written to the audit log.
export const metadata: Metadata = { title: "Opening" };

export default function OpeningScreen({ params, searchParams }: PageProps<"/careers/[id]">) {
  return (
    <div className={ui.page}>
      <Suspense fallback={null}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// A time as staff read it, in India's time.
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

async function Body({ params, searchParams }: PageProps<"/careers/[id]">) {
  await connection(); // the list is written to the audit log: never for a prefetch
  const { id } = await params;
  const raw = (await searchParams).page;
  const page = Array.isArray(raw) ? raw[0] : raw;
  const [o, a] = await Promise.all([
    read<OpeningAdmin>(`/galaxy/openings/${encodeURIComponent(id)}`),
    read<ApplicationList>(`/galaxy/openings/${encodeURIComponent(id)}/applications?page=${encodeURIComponent(page ?? "1")}`),
  ]);
  if (!o.ok) return <Alert>{o.error.message}</Alert>;
  const { id: openingId, slug, createdAt, updatedAt, applications, fresh, ...opening } = o.data;
  return (
    <>
      <PageHeader
        title={opening.title}
        description={opening.status === "open" ? `Live at heyorbit.in/careers/${slug}.` : "Not on the site: only Open openings show there."}
      />
      {opening.status === "open" && (
        <div className={ui.row}>
          <a href={`${SITE}/careers/${slug}`} target="_blank" rel="noopener noreferrer" className={ui.btn}>
            See it on the site ↗
          </a>
        </div>
      )}
      <Container title="Applications" count={a.ok ? a.data.total : applications}>
        {!a.ok ? (
          <Alert>{a.error.message}</Alert>
        ) : a.data.applications.length === 0 ? (
          <p className={ui.secondary}>Nobody yet.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Résumé</th>
                  <th>Applied</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Links</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {a.data.applications.map((p) => (
                  <tr key={p.id}>
                    <td className={styles.nowrap}>{p.name}</td>
                    <td>
                      <StatusPicker id={p.id} status={p.status} />
                    </td>
                    <td>
                      <a href={`/careers/resume/${p.id}`} download>
                        Download
                      </a>
                    </td>
                    <td className={styles.nowrap}>{when(p.createdAt)}</td>
                    <td>
                      <a href={`mailto:${p.email}`}>{p.email}</a>
                    </td>
                    <td className={styles.nowrap}>{p.phone ?? "–"}</td>
                    <td>
                      {[p.linkedin && ["LinkedIn", p.linkedin], p.link && ["Work", p.link]].filter(Boolean).map((l) => {
                        const [label, href] = l as [string, string];
                        return (
                          <a key={label} href={href} target="_blank" rel="noopener noreferrer nofollow" className={styles.link} title={href}>
                            {label} ↗
                          </a>
                        );
                      })}
                      {!p.linkedin && !p.link && "–"}
                    </td>
                    <td className={styles.note}>{p.note ?? "–"}</td>
                    <td>
                      <DeleteApplication id={p.id} name={p.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {a.ok && <Pages path={`/careers/${id}`} {...a.data} />}
        {fresh > 0 && <p className={ui.secondary}>{fresh} still New.</p>}
      </Container>
      <Container title="Opening">
        <p className={ui.secondary}>
          Made {when(createdAt)}, last saved {when(updatedAt)}. Its link never changes, so a shared one keeps working.
        </p>
        <OpeningForm id={openingId} initial={opening} />
      </Container>
    </>
  );
}
