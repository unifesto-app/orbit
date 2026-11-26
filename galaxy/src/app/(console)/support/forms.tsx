"use client";

import { SUPPORT_BODY_MAX } from "@orbit/contract";
import { useActionState, useEffect, useRef } from "react";
import { ui } from "../../ui";
import type { Done } from "../actions";
import { replySupport, setSupportStatus } from "../actions";
import styles from "../act.module.css";

// The reply box: sent, it clears and the page reads again with the reply in it. The API's message shows when it says no.
export function Reply({ id }: { id: string }) {
  const [state, submit, pending] = useActionState(replySupport, {} as Done);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state.ok]);
  return (
    <form ref={form} action={submit} className={styles.form}>
      <input type="hidden" name="id" value={id} />
      <label className={styles.label}>
        Reply
        <textarea name="body" className={styles.reason} required maxLength={SUPPORT_BODY_MAX} placeholder="They see this in the app, and get a push and an email saying Orbit replied" />
      </label>
      <p className={ui.secondary}>Logged. Marks the thread answered.</p>
      {state.error && (
        <p role="alert" className={styles.alert}>
          {state.error}
        </p>
      )}
      <div>
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          Send reply
        </button>
      </div>
    </form>
  );
}

// Close, or Reopen a closed thread.
export function SetStatus({ id, closed }: { id: string; closed: boolean }) {
  const [state, submit, pending] = useActionState(setSupportStatus, {} as Done);
  return (
    <form action={submit}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={closed ? "open" : "closed"} />
      <button className={ui.btn} disabled={pending}>
        {closed ? "Reopen" : "Close"}
      </button>
      {state.error && (
        <p role="alert" className={styles.alert}>
          {state.error}
        </p>
      )}
    </form>
  );
}
