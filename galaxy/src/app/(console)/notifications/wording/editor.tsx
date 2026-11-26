"use client";

import { type Channel, fillVars, PUSH_BODY_MAX, unknownVars, type WordingChannel } from "@orbit/contract";
import { useRef, useState, useTransition } from "react";
import { Pairs, ui } from "../../../ui";
import act from "../../act.module.css";
import { type Answer, type Draft, resetWording, saveWording, testWording } from "./actions";

// One channel's wording: the code's (with samples), the editor (email subject + body, push title + body, inbox body),
// variable chips that insert {name} where the cursor was, a live preview with the samples, and the three buttons.
type Field = "subject" | "title" | "body";
const FIELDS: Record<Channel, [Field, string, number][]> = {
  email: [
    ["subject", "Subject", 120],
    ["body", "Line", 1000],
  ],
  push: [
    ["title", "Title", 80],
    ["body", "Words", PUSH_BODY_MAX],
  ],
  inbox: [["body", "Text", 1000]],
};

export function WordingEditor({
  kind,
  channel,
  vars,
  code,
  saved,
  subjectOff,
}: {
  kind: string;
  channel: Channel;
  vars: Record<string, string>;
  code: WordingChannel["code"];
  saved: WordingChannel["saved"];
  subjectOff: string[];
}) {
  const fields = FIELDS[channel];
  // Empty with nothing saved: the code's wording above is filled with samples, so saving it as is would fix them in.
  const blank = { subject: "", title: "", body: "" };
  const [draft, setDraft] = useState<Record<Field, string>>(saved ? { subject: saved.subject ?? "", title: saved.title ?? "", body: saved.body } : blank);
  const [readAt, setReadAt] = useState(saved?.updatedAt ?? null);
  const [answer, setAnswer] = useState<Answer>({});
  const [pending, run] = useTransition();
  const last = useRef<{ field: Field; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const names = Object.keys(vars);
  const sent: Draft = Object.fromEntries(fields.map(([f]) => [f, draft[f]])) as Draft;
  const unknown = [
    ...new Set([...unknownVars(draft.subject, names.filter((n) => !subjectOff.includes(n))), ...unknownVars(fields.map(([f]) => draft[f]).join("\n"), names)]),
  ];
  const empty = fields.some(([f]) => !draft[f].trim());
  const go = (f: () => Promise<Answer>) =>
    run(async () => {
      const a = await f();
      setAnswer(a);
      if (a.updatedAt !== undefined) setReadAt(a.updatedAt);
      if (a.updatedAt === null && !a.error) setDraft(blank);
    });
  // {name} where the cursor last was (else at the end of the last field), the cursor after it.
  const insert = (name: string) => {
    const at = last.current ?? null;
    const field = at?.field ?? fields[fields.length - 1]![0];
    const v = draft[field];
    const i = at?.el.selectionStart ?? v.length;
    const j = at?.el.selectionEnd ?? v.length;
    const token = `{${name}}`;
    setDraft({ ...draft, [field]: v.slice(0, i) + token + v.slice(j) });
    requestAnimationFrame(() => at?.el.setSelectionRange(i + token.length, i + token.length));
    at?.el.focus();
  };

  return (
    <div className={act.form}>
      <Pairs pairs={fields.map(([f, label]) => [`In code: ${label.toLowerCase()}`, code[f] || "–"])} />
      {fields.map(([f, label, max]) => {
        const props = {
          className: f === "body" ? act.reason : ui.input,
          value: draft[f],
          maxLength: max,
          required: true,
          onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [f]: e.target.value }),
          onSelect: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => void (last.current = { field: f, el: e.currentTarget }),
        };
        return (
          <label key={f} className={act.label}>
            <span>
              {label} <span className={ui.secondary}>(up to {max})</span>
            </span>
            {f === "body" ? <textarea {...props} /> : <input {...props} />}
          </label>
        );
      })}
      {names.length > 0 ? (
        <div className={ui.row}>
          {names.map((n) => (
            <button key={n} type="button" className={ui.btn} onClick={() => insert(n)} title={`Sample: ${vars[n]}`}>
              {`{${n}}`}
            </button>
          ))}
        </div>
      ) : (
        <p className={ui.secondary}>This message has no variables.</p>
      )}
      {unknown.length > 0 && (
        <p role="alert" className={ui.alert}>
          Not a variable for this message: {unknown.map((n) => `{${n}}`).join(", ")}.
        </p>
      )}
      <Pairs pairs={fields.map(([f, label]) => [`Preview: ${label.toLowerCase()}`, fillVars(draft[f], vars) || "–"])} />
      {answer.error && (
        <p role="alert" className={ui.alert}>
          {answer.error}
        </p>
      )}
      <div className={ui.row}>
        <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || empty} onClick={() => go(() => saveWording(kind, channel, sent, readAt))}>
          Save
        </button>
        <button type="button" className={ui.btn} disabled={pending || empty} onClick={() => go(() => testWording(kind, channel, sent))}>
          Send test to me
        </button>
        {saved && (
          <button type="button" className={ui.btnLink} disabled={pending} onClick={() => go(() => resetWording(kind, channel))}>
            Back to wording in code
          </button>
        )}
        {answer.note && <span className={ui.secondary}>{answer.note}</span>}
      </div>
    </div>
  );
}

// A channel whose code wording changes with the situation (a decision, an end date or none): shown, not edited.
export function CodeOnly({ channel, code }: { channel: Channel; code: WordingChannel["code"] }) {
  return (
    <>
      <Pairs pairs={FIELDS[channel].map(([f, label]) => [`In code: ${label.toLowerCase()}`, code[f] || "–"])} />
      <p className={ui.secondary}>This wording changes with the situation, so it’s edited in code.</p>
    </>
  );
}
