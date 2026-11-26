"use client";

import { type ReactNode, useActionState, useEffect, useEffectEvent, useRef } from "react";
import { ui } from "../ui";
import type { Done } from "./actions";
import styles from "./act.module.css";

// One risky action: a button that opens its form, any fields of its own, the reason (which the other side sees) and
// the action itself. It closes once the API has made the change; the API's message shows when it says no. `onDone`
// is for results the page holds itself (People search), which the server's refresh doesn't reach.
export function Act({
  label,
  action,
  hidden,
  who,
  children,
  onDone,
  optional,
}: {
  label: string;
  action: (prev: Done, form: FormData) => Promise<Done>;
  hidden: Record<string, string>;
  who: string; // who sees the reason, e.g. "They see this"
  children?: ReactNode;
  onDone?: () => void;
  optional?: boolean; // the reason may be left empty, and nobody is emailed (Reports)
}) {
  const [state, submit, pending] = useActionState(action, {});
  const box = useRef<HTMLDetailsElement>(null);
  const done = useEffectEvent(() => onDone?.());
  useEffect(() => {
    if (!state.ok) return;
    if (box.current) box.current.open = false;
    done();
  }, [state.ok]);

  return (
    <details ref={box} className={styles.act}>
      <summary className={ui.btn}>{label}</summary>
      <form action={submit} className={styles.form}>
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {children}
        <label className={styles.label}>
          {optional ? "Note (optional)" : "Reason"}
          <textarea name="reason" className={styles.reason} required={!optional} minLength={optional ? undefined : 3} maxLength={optional ? 1000 : 500} placeholder={who} />
        </label>
        <p className={ui.secondary}>{optional ? "Logged." : "Logged, and everyone with this access is emailed."}</p>
        {state.error && (
          <p role="alert" className={styles.alert}>
            {state.error}
          </p>
        )}
        <div>
          <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
            {label}
          </button>
        </div>
      </form>
    </details>
  );
}
