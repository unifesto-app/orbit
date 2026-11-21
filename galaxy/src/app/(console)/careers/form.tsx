"use client";

import { APPLICATION_STATUSES, type ApplicationStatus, type Opening, OPENING_KINDS, OPENING_STATUSES } from "@orbit/contract";
import { type ReactNode, startTransition, useActionState, useState, useTransition } from "react";
import { ui } from "../../ui";
import act from "../act.module.css";
import { removeApplication, type Saved, saveOpening, setStatus } from "./actions";
import styles from "./careers.module.css";

// The opening's editor, the same for a new one and a saved one. Lists are one line each, as the site shows them.
// Sent by hand (onSubmit), not as the form's action: React empties a form once its action ends, which would lose
// everything typed when the API refuses a save. `action` stays set so a submit before the page's script loads is
// stopped by React's placeholder instead of going out as a plain GET with the fields in the address.
export function OpeningForm({ id, initial }: { id: string | null; initial?: Opening }) {
  const [s, submit, pending] = useActionState((prev: Saved, f: FormData) => saveOpening(id, prev, f), {});
  const o = initial;
  return (
    <form
      action={submit}
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(() => submit(f));
      }}
    >
      <div className={styles.fields}>
        <Field label="Title">
          <input name="title" className={ui.input} required maxLength={80} defaultValue={o?.title} placeholder="Product designer" />
        </Field>
        <Field label="Team">
          <input name="team" className={ui.input} required maxLength={40} defaultValue={o?.team} placeholder="Design" />
        </Field>
        <Field label="Where">
          <input name="place" className={ui.input} required maxLength={60} defaultValue={o?.place} placeholder="Remote in India" />
        </Field>
        <Field label="Kind">
          <select name="kind" className={ui.input} defaultValue={o?.kind ?? "full"}>
            {Object.entries(OPENING_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pay" note="optional">
          <input name="pay" className={ui.input} maxLength={60} defaultValue={o?.pay} placeholder="₹8–12 lakh a year" />
        </Field>
        <Field label="Status" note="only Open shows on the site">
          <select name="status" className={ui.input} defaultValue={o?.status ?? "draft"}>
            {Object.entries(OPENING_STATUSES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="About the role" note="a blank line starts a new paragraph">
        <textarea name="about" className={`${act.reason} ${styles.about}`} required maxLength={4000} defaultValue={o?.about} />
      </Field>
      <Field label="What you’ll do" note="one a line, up to 12">
        <textarea name="does" className={act.reason} defaultValue={o?.does.join("\n")} />
      </Field>
      <Field label="What we’re looking for" note="one a line, up to 12">
        <textarea name="needs" className={act.reason} defaultValue={o?.needs.join("\n")} />
      </Field>
      {s.error && (
        <p role="alert" className={act.alert}>
          {s.error}
        </p>
      )}
      <div className={ui.row}>
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          {id ? "Save" : "Create opening"}
        </button>
        {s.ok && !pending && (
          <span role="status" className={ui.secondary}>
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <label className={act.label}>
      <span>
        {label} {note && <span className={ui.secondary}>({note})</span>}
      </span>
      {children}
    </label>
  );
}

// An applicant's status, saved as soon as it's picked; a refused save goes back to what it was.
export function StatusPicker({ id, status }: { id: string; status: ApplicationStatus }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string>();
  return (
    <>
      <select
        aria-label="Status"
        className={ui.input}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const before = value;
          const next = e.currentTarget.value as ApplicationStatus;
          setValue(next);
          start(async () => {
            const r = await setStatus(id, next);
            setError(r.error);
            if (r.error) setValue(before);
          });
        }}
      >
        {Object.entries(APPLICATION_STATUSES).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      {error && <span role="alert" className={styles.error}>{error}</span>}
    </>
  );
}

// Deleting asks once more: it can't be undone.
export function DeleteApplication({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <details className={act.act}>
      <summary className={ui.btnLink}>Delete</summary>
      <div className={styles.confirm}>
        <p>Delete {name}’s application and résumé for good? Do this when they ask.</p>
        <button
          type="button"
          className={ui.btn}
          disabled={pending}
          onClick={() => start(async () => setError((await removeApplication(id)).error))}
        >
          Delete for good
        </button>
        {error && <span role="alert" className={styles.error}>{error}</span>}
      </div>
    </details>
  );
}
