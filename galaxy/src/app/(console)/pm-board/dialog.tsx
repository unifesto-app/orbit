"use client";

import { PM_STATUSES, type PmStatus, type PmTask, type PmTaskRow, type PmTrack } from "@orbit/contract";
import { useEffect, useRef, useState } from "react";
import { Alert, ui } from "../../ui";
import { addNote, readTask, saveTask } from "./actions";
import { STATUS_NAMES } from "./board";
import styles from "./pm.module.css";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// The next free key in a track: "P" with P1 to P13 taken gives "P14".
const nextKey = (track: string, tasks: PmTaskRow[]) => {
  const n = tasks.filter((t) => t.track === track).map((t) => Number(/(\d+)$/.exec(t.key)?.[1] ?? 0));
  return `${track}${Math.max(0, ...n) + 1}`;
};

// One task to read and edit, or a new one (taskKey null). It reads the task fresh on opening and saves with when it
// read it, so a save never lands over a change made since (often Claude's); the API answers that with a message.
export function TaskDialog({
  taskKey,
  tracks,
  tasks,
  defaultTrack,
  onClose,
}: {
  taskKey: string | null;
  tracks: PmTrack[];
  tasks: PmTaskRow[];
  defaultTrack: string;
  onClose: () => void;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const [task, setTask] = useState<PmTask | null>(null);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(!taskKey);

  useEffect(() => box.current?.showModal(), []);
  useEffect(() => {
    if (!taskKey) return;
    let live = true;
    readTask(taskKey).then((r) => {
      if (!live) return;
      setTask(r.task ?? null);
      setError(r.error);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [taskKey]);

  const close = () => box.current?.close(); // the dialog's close event calls onClose

  const save = async (f: FormData) => {
    const key = task?.key ?? String(f.get("key") ?? "").trim();
    if (!task && tasks.some((t) => t.key.toLowerCase() === key.toLowerCase())) return setError(`${key} already exists. Pick another key.`);
    const text = (k: string) => String(f.get(k) ?? "");
    const r = await saveTask({
      key,
      track: text("track"),
      title: text("title").trim(),
      status: text("status") as PmStatus,
      owner: text("owner").trim(),
      dueDate: text("dueDate"),
      labels: text("labels").split(",").map((l) => l.trim()).filter(Boolean),
      notes: text("notes"),
      ...(task ? { ifUpdatedAt: task.updatedAt } : {}),
    });
    if (r.error) setError(r.error);
    else close();
  };

  const note = async (f: FormData) => {
    if (!task) return;
    const r = await addNote(task.key, String(f.get("message") ?? "").trim());
    if (r.error) return setError(r.error);
    const again = await readTask(task.key);
    if (again.task) setTask(again.task);
  };

  return (
    <dialog ref={box} className={styles.dialog} onClose={onClose} aria-labelledby="pm-dialog-title">
      <h2 id="pm-dialog-title" className={styles.dialogTitle}>
        {task ? `${task.key} · ${task.title}` : taskKey ? taskKey : "New task"}
      </h2>
      <Alert>{error}</Alert>
      {!ready ? (
        <p className={ui.secondary}>Loading…</p>
      ) : taskKey && !task ? null : (
        <form action={save} className={styles.form}>
          <div className={styles.grid}>
            <label className={styles.field}>
              Key
              <input className={ui.input} name="key" defaultValue={task?.key ?? nextKey(defaultTrack, tasks)} readOnly={!!task} required maxLength={32} />
            </label>
            <label className={styles.field}>
              Track
              <select className={ui.input} name="track" defaultValue={task?.track ?? defaultTrack} required>
                {tracks.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.key} · {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Status
              <select className={ui.input} name="status" defaultValue={task?.status ?? "PLANNED"}>
                {PM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_NAMES[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Owner
              <input className={ui.input} name="owner" defaultValue={task?.owner ?? ""} maxLength={80} />
            </label>
            <label className={styles.field}>
              Due
              <input className={ui.input} type="date" name="dueDate" defaultValue={task?.dueDate ?? ""} />
            </label>
            <label className={styles.field}>
              Labels <span className={ui.secondary}>(commas between)</span>
              <input className={ui.input} name="labels" defaultValue={task?.labels.join(", ") ?? ""} />
            </label>
          </div>
          <label className={styles.field}>
            Title
            <input className={ui.input} name="title" defaultValue={task?.title ?? ""} required maxLength={500} />
          </label>
          <label className={styles.field}>
            Notes
            <textarea className={`${ui.input} ${styles.notes}`} name="notes" defaultValue={task?.notes ?? ""} maxLength={20000} rows={8} />
          </label>
          <div className={ui.row}>
            <button className={`${ui.btn} ${ui.primary}`}>{task ? "Save" : "Create task"}</button>
            <button type="button" className={ui.btn} onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {task && (
        <section className={styles.history}>
          <h3 className={styles.historyTitle}>Activity</h3>
          <form action={note} className={ui.row}>
            <input className={ui.input} name="message" placeholder="Add a note" aria-label="Add a note" required maxLength={2000} />
            <button className={ui.btn}>Add</button>
          </form>
          <ul className={styles.log}>
            {task.activity.map((a) => (
              <li key={a.id}>
                <span className={ui.secondary}>
                  {when(a.at)} · {a.actor}
                </span>
                <span className={styles.message}>{a.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </dialog>
  );
}
