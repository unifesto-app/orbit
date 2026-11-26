"use client";

import { ANNOUNCEMENTS_A_DAY, type AutoMessages } from "@orbit/contract";
import { useActionState } from "react";
import ui from "../../../ui.module.css";
import { announce, saveAuto, type Sent } from "./actions";
import styles from "./event.module.css";

// Announce: the text, who it goes to, Send. React clears the form after each send; a refused one's text comes back.
export function Announce({ eventId, left }: { eventId: string; left: number }) {
  const [state, send, busy] = useActionState<Sent, FormData>(announce.bind(null, eventId), {});
  return (
    <form action={send} className={styles.form}>
      <label className={styles.label}>
        Message
        <textarea name="text" required maxLength={500} rows={4} className={`${ui.input} ${styles.text}`} placeholder="Doors open at 7. Bring your ID." defaultValue={state.text} />
      </label>
      <fieldset className={styles.choice}>
        <legend className={styles.legend}>Send to</legend>
        <label>
          <input type="radio" name="audience" value="everyone" defaultChecked /> Every ticket holder
        </label>
        <label>
          <input type="radio" name="audience" value="notCheckedIn" /> Only those not checked in
        </label>
      </fieldset>
      {state.error && <p className={styles.alert} role="alert">{state.error}</p>}
      <div className={styles.buttons}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy || left === 0}>
          {busy ? "Sending…" : "Send"}
        </button>
        <span className={ui.secondary}>
          {left === 0 ? "That’s all 3 for today. More tomorrow." : `${left} of ${ANNOUNCEMENTS_A_DAY} left today. Each goes by push, inbox and email.`}
        </span>
      </div>
    </form>
  );
}

const SWITCHES: { key: keyof AutoMessages; label: string }[] = [
  { key: "tomorrow", label: "A day before: when and where" },
  { key: "startingSoon", label: "An hour before: starting soon" },
  { key: "thanks", label: "After it ends: thanks for coming" },
];

export function AutoSwitches({ eventId, now }: { eventId: string; now: AutoMessages }) {
  const [state, save, busy] = useActionState<Sent, FormData>(saveAuto.bind(null, eventId), {});
  return (
    <form action={save} className={styles.form}>
      <fieldset className={styles.choice}>
        <legend className={styles.legend}>Sent to ticket holders on their own</legend>
        {SWITCHES.map((s) => (
          <label key={s.key}>
            <input type="checkbox" name={s.key} defaultChecked={now[s.key]} /> {s.label}
          </label>
        ))}
      </fieldset>
      {state.error && <p className={styles.alert} role="alert">{state.error}</p>}
      <div className={styles.buttons}>
        <button type="submit" className={ui.btn} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        {state.ok && !busy && <span className={ui.secondary}>Saved</span>}
      </div>
    </form>
  );
}
