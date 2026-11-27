"use client";

import { type EventDetails, FEST_TYPES, type StaffEvent } from "@orbit/contract";
import { type ReactNode, useActionState } from "react";
import { boxOf, isLong, keysOf, LABELS } from "../../../details";
import { Pairs, ui } from "../../ui";
import { type Done, setEventDetails } from "../actions";
import styles from "../act.module.css";

// An event's kind details (kind details plan): what its category's page shows, the meetup's inRoom switch and the age.
// Shown as the category reads them; Edit saves the category's boxes whole. Staff may flip inRoom after the start, which
// hosts can't.
export function KindDetails({ event: e }: { event: StaffEvent["event"] }) {
  const [state, submit, pending] = useActionState<Done, FormData>(setEventDetails, {});
  const keys = keysOf(e.category);
  const meetup = e.category === "meetups";
  const shown = (k: keyof EventDetails) => <span key={k} style={{ whiteSpace: "pre-line" }}>{boxOf(k, e.details) || null}</span>;
  return (
    <div className={ui.page}>
      <Pairs
        pairs={[
          ...keys.map((k): [string, ReactNode] => [LABELS[k], e.details[k] === undefined ? null : shown(k)]),
          ...(meetup ? [["Guests meet in the app", e.inRoom ? "Yes" : "No"] as [string, string]] : []),
          ["Age", e.minAge ? `${e.minAge}+` : "Any"],
        ]}
      />
      <details>
        <summary className={ui.btn}>Edit</summary>
        <form action={submit} className={styles.form}>
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="category" value={e.category ?? ""} />
          {keys.map((k) => (
            <label key={k} className={styles.label}>
              {LABELS[k]}
              {k === "festType" ? (
                <select name={k} defaultValue={e.details.festType ?? ""} className={ui.input}>
                  <option value="">None</option>
                  {FEST_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              ) : k === "teamMin" || k === "teamMax" ? (
                <input name={k} type="number" min={1} max={10} defaultValue={boxOf(k, e.details)} className={ui.input} />
              ) : isLong(k) ? (
                <textarea name={k} defaultValue={boxOf(k, e.details)} className={styles.reason} />
              ) : (
                <input name={k} defaultValue={boxOf(k, e.details)} maxLength={120} className={ui.input} />
              )}
            </label>
          ))}
          {meetup && (
            <label className={styles.label}>
              <span>
                <input type="checkbox" name="inRoom" defaultChecked={e.inRoom} /> Let checked-in guests meet in the app
              </span>
            </label>
          )}
          <label className={styles.label}>
            Age
            <select name="minAge" defaultValue={e.minAge ?? ""} className={ui.input}>
              <option value="">Any</option>
              <option value="18">18+</option>
              <option value="21">21+</option>
            </select>
          </label>
          <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
            Save
          </button>
          {state.error && (
            <p role="alert" className={styles.alert}>
              {state.error}
            </p>
          )}
        </form>
      </details>
    </div>
  );
}
