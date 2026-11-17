"use client";

import { PM_STATUSES, type PmStatus, type PmTaskRow, type PmTrack } from "@orbit/contract";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useEffectEvent, useOptimistic, useRef, useState } from "react";
import { Alert, Badge, ui } from "../../ui";
import { moveTask, saveTrack } from "./actions";
import { TaskDialog } from "./dialog";
import styles from "./pm.module.css";

// The board (owner, 17 Nov 2026: "Columns by status"): a column per status, tasks dragged between them, and a status
// picker on every card for the keyboard and touch, which drag and drop leaves out. Text on it is partly Claude's, so it's
// shown as plain text only. Parked and Dropped sit behind a switch.

export const STATUS_NAMES: Record<PmStatus, string> = {
  PLANNED: "Planned",
  NEXT: "Next",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  IN_REVIEW: "In review",
  DONE: "Done",
  PARKED: "Parked",
  DROPPED: "Dropped",
};
const FLOW: PmStatus[] = ["PLANNED", "NEXT", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE"];
const SHELVED: PmStatus[] = ["PARKED", "DROPPED"];
const CLOSED: PmStatus[] = ["DONE", "PARKED", "DROPPED"];

export function Board({ tracks, tasks, today }: { tracks: PmTrack[]; tasks: PmTaskRow[]; today: string }) {
  const router = useRouter();
  const [shown, move] = useOptimistic(tasks, (all, m: { key: string; status: PmStatus }) => all.map((t) => (t.key === m.key ? { ...t, status: m.status } : t)));
  const [q, setQ] = useState("");
  const [track, setTrack] = useState<string | null>(null);
  const [shelved, setShelved] = useState(false);
  const [error, setError] = useState<string>();
  const [said, setSaid] = useState(""); // read out by screen readers after a move
  const [open, setOpen] = useState<string | null>(null); // a task key, or "" for a new task
  const [over, setOver] = useState<PmStatus | null>(null);

  // Claude changes the board over MCP, which nothing here hears of. Next keeps this page, hidden, when you leave it
  // (cacheComponents) and runs its effects again when you come back: read the board again then.
  const seen = useRef(false);
  const reread = useEffectEvent(() => router.refresh());
  useEffect(() => {
    if (seen.current) reread();
    seen.current = true;
  }, []);

  const names = Object.fromEntries(tracks.map((t) => [t.key, t.name]));
  const rank = Object.fromEntries(tracks.map((t, i) => [t.key, i]));
  const needle = q.trim().toLowerCase();
  const visible = shown.filter(
    (t) => (!track || t.track === track) && (!needle || [t.key, t.title, t.owner ?? "", ...t.labels].some((s) => s.toLowerCase().includes(needle))),
  );
  // Done, newest first; the rest by due date, then the tracks' order, then their own.
  const byDue = (a: PmTaskRow, b: PmTaskRow) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (rank[a.track] ?? 0) - (rank[b.track] ?? 0) || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
  const column = (s: PmStatus) => visible.filter((t) => t.status === s).sort(s === "DONE" ? (a, b) => b.updatedAt.localeCompare(a.updatedAt) : byDue);

  const change = (key: string, status: PmStatus) => {
    const t = shown.find((x) => x.key === key);
    if (!t || t.status === status) return;
    setError(undefined);
    startTransition(async () => {
      move({ key, status });
      const r = await moveTask(key, status);
      if (r.error) {
        setError(r.error);
        router.refresh();
      } else setSaid(`Moved ${key} to ${STATUS_NAMES[status]}.`);
    });
  };

  return (
    <>
      <div className={ui.row}>
        <input className={ui.input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by key, title, owner or label" aria-label="Filter tasks" />
        <button type="button" className={`${ui.btn} ${ui.primary}`} onClick={() => setOpen("")}>
          New task
        </button>
        <NewTrack />
        <button type="button" className={ui.btn} onClick={() => router.refresh()}>
          Refresh
        </button>
        <label className={ui.row}>
          <input type="checkbox" checked={shelved} onChange={(e) => setShelved(e.target.checked)} /> Show parked and dropped
        </label>
      </div>

      <div className={ui.row} role="group" aria-label="Tracks">
        <button type="button" className={styles.chip} aria-pressed={!track} onClick={() => setTrack(null)}>
          All tracks
        </button>
        {tracks.map((t) => (
          <button key={t.key} type="button" className={styles.chip} aria-pressed={track === t.key} onClick={() => setTrack(track === t.key ? null : t.key)}>
            {t.key} · {t.name} <span className={ui.secondary}>{shown.filter((x) => x.track === t.key && !CLOSED.includes(x.status)).length}</span>
          </button>
        ))}
      </div>

      <Alert>{error}</Alert>
      <p aria-live="polite" className={styles.said}>
        {said}
      </p>

      <div className={styles.columns}>
        {(shelved ? [...FLOW, ...SHELVED] : FLOW).map((s) => {
          const list = column(s);
          return (
            <section
              key={s}
              className={styles.column}
              data-over={over === s ? "" : undefined}
              aria-label={STATUS_NAMES[s]}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s);
              }}
              onDragLeave={() => setOver((o) => (o === s ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                change(e.dataTransfer.getData("text/plain"), s);
              }}
            >
              <h2 className={styles.columnHeader}>
                {STATUS_NAMES[s]} <span className={ui.counter}>({list.length})</span>
              </h2>
              <ul className={styles.cards}>
                {list.map((t) => (
                  <li
                    key={t.key}
                    className={styles.card}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.key);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <div className={styles.cardTop}>
                      <span className={styles.key}>{t.key}</span>
                      <span className={ui.secondary}>{names[t.track] ?? t.track}</span>
                    </div>
                    <button type="button" className={styles.title} onClick={() => setOpen(t.key)}>
                      {t.title}
                    </button>
                    {t.labels.length > 0 && (
                      <div className={styles.labels}>
                        {t.labels.map((l) => (
                          <Badge key={l} tone="neutral">
                            {l}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className={styles.cardFoot}>
                      <span className={ui.secondary}>
                        {[t.owner, t.dueDate && `Due ${t.dueDate}`].filter(Boolean).join(" · ")}
                        {t.dueDate && t.dueDate < today && !CLOSED.includes(t.status) && <Badge tone="error">Overdue</Badge>}
                      </span>
                      <select className={styles.status} value={t.status} aria-label={`Status of ${t.key}`} onChange={(e) => change(t.key, e.target.value as PmStatus)}>
                        {PM_STATUSES.map((x) => (
                          <option key={x} value={x}>
                            {STATUS_NAMES[x]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {open !== null && <TaskDialog taskKey={open || null} tracks={tracks} tasks={shown} defaultTrack={track ?? tracks[0]?.key ?? ""} onClose={() => setOpen(null)} />}
    </>
  );
}

// A new track, or a new name for one: its short key and its name.
function NewTrack() {
  const [error, setError] = useState<string>();
  const box = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={box} className={styles.popover}>
      <summary className={ui.btn}>New track</summary>
      <form
        className={styles.popoverForm}
        action={async (f) => {
          const r = await saveTrack(String(f.get("key") ?? "").trim(), String(f.get("name") ?? "").trim());
          setError(r.error);
          if (!r.error && box.current) box.current.open = false;
        }}
      >
        <label className={styles.field}>
          Key <span className={ui.secondary}>(short, like P or WEB; an existing key renames it)</span>
          <input className={ui.input} name="key" required maxLength={16} pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" />
        </label>
        <label className={styles.field}>
          Name
          <input className={ui.input} name="name" required maxLength={160} />
        </label>
        <Alert>{error}</Alert>
        <div>
          <button className={`${ui.btn} ${ui.primary}`}>Save track</button>
        </div>
      </form>
    </details>
  );
}
