"use client";

import { allCities } from "@orbit/contract";
import { type ReactNode, startTransition, useActionState, useState, useTransition } from "react";
import { ui } from "../../../ui";
import act from "../../act.module.css";
import styles from "../../careers/careers.module.css";
import { compose, confirmBroadcast } from "./actions";

// The compose form. The audience is counted for the segment as it stands before Save is open; changing the segment asks
// for a new count. Sent by hand (onSubmit), as Careers' form, so a refused save keeps everything typed.
export function ComposeForm() {
  const [s, submit, pending] = useActionState(compose, {});
  const [segment, setSegment] = useState("all");
  const [when, setWhen] = useState("now");
  const [counted, setCounted] = useState(false);
  const [type, setType] = useState("news");
  return (
    <form
      action={submit}
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        if (f.get("intent") === "count") setCounted(true);
        startTransition(() => submit(f));
      }}
    >
      <div className={styles.fields}>
        <Field label="Type" note={type === "notice" ? "reaches everyone, switches or not: outages and changes to terms only" : "people who switched off From Orbit don’t get it"}>
          <select name="type" className={ui.input} value={type} onChange={(e) => setType(e.currentTarget.value)}>
            <option value="news">News</option>
            <option value="notice">Service notice</option>
          </select>
        </Field>
        <Field label="To">
          <select
            name="segment"
            className={ui.input}
            value={segment}
            onChange={(e) => {
              setSegment(e.currentTarget.value);
              setCounted(false);
            }}
          >
            <option value="all">Everyone</option>
            <option value="city">People in a city</option>
            <option value="host">A host’s followers</option>
            <option value="event">An event’s guests</option>
          </select>
        </Field>
        {segment === "city" && (
          <Field label="City">
            <select name="city" className={ui.input} defaultValue="Hyderabad" onChange={() => setCounted(false)}>
              {allCities.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}, {c.state}
                </option>
              ))}
            </select>
          </Field>
        )}
        {segment === "host" && (
          <Field label="Host id" note="from the host’s page in Galaxy">
            <input name="hostId" className={ui.input} required onChange={() => setCounted(false)} />
          </Field>
        )}
        {segment === "event" && (
          <Field label="Event id">
            <input name="eventId" className={ui.input} required onChange={() => setCounted(false)} />
          </Field>
        )}
        <Field label="Send">
          <select name="when" className={ui.input} value={when} onChange={(e) => setWhen(e.currentTarget.value)}>
            <option value="now">Once confirmed</option>
            <option value="later">At a time</option>
          </select>
        </Field>
        {when === "later" && (
          <Field label="At" note="India time">
            <input type="datetime-local" name="sendAt" className={ui.input} required />
          </Field>
        )}
      </div>
      <fieldset className={ui.row}>
        <legend className={act.label}>Channels (the inbox always)</legend>
        <label>
          <input type="checkbox" name="channels" value="push" defaultChecked /> Push
        </label>
        <label>
          <input type="checkbox" name="channels" value="email" defaultChecked /> Email
        </label>
      </fieldset>
      <Field label="Title" note="the email’s subject">
        <input name="title" className={ui.input} required maxLength={80} />
      </Field>
      <Field label="Text">
        <textarea name="text" className={act.reason} required maxLength={500} />
      </Field>
      {s.error && (
        <p role="alert" className={act.alert}>
          {s.error}
        </p>
      )}
      <div className={ui.row}>
        <button name="intent" value="count" className={ui.btn} formNoValidate disabled={pending}>
          Count audience
        </button>
        {counted && s.count !== undefined && !pending && <span role="status">Reaches {s.count.toLocaleString("en-IN")} people</span>}
        <button name="intent" value="save" className={`${ui.btn} ${ui.primary}`} disabled={pending || !counted || s.count === undefined}>
          Save for a second person
        </button>
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

// Confirm: it goes (or waits for its time) as soon as it's pressed, so the preview says who it reaches first.
export function Confirm({ id, preview }: { id: string; preview: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className={ui.row}>
      <span className={ui.secondary}>{preview}</span>
      <button className={`${ui.btn} ${ui.primary}`} disabled={pending} onClick={() => start(async () => setError((await confirmBroadcast(id)).error))}>
        Confirm and send
      </button>
      {error && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
