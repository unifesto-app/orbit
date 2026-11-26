"use client";

import { type CategorySlug, categories } from "@orbit/contract";
import { startTransition, useActionState, useMemo, useState } from "react";
import { ui } from "../../ui";
import { saveList } from "./actions";
import styles from "./content.module.css";

// The kinds of event offered on Account › Interests and Home's one ask (orbit-pm X13): every category, shown ones first
// in the app's order, each moved up or down or hidden. Staff never add one: each one's drawing ships in the app. Saved
// whole through the same PUT as the other lists, with `at`, so a save over someone else's since is refused.
export function InterestsEditor({ initial, at }: { initial: CategorySlug[]; at: string | null }) {
  const [rows, setRows] = useState(() => [
    ...initial.map((slug) => ({ slug, shown: true })),
    ...categories.filter((c) => !initial.includes(c.slug)).map((c) => ({ slug: c.slug, shown: false })),
  ]);
  const [read] = useState(at);
  const action = useMemo(() => saveList.bind(null, "interests"), []);
  const [state, submit, pending] = useActionState(action, {});
  const value = JSON.stringify(rows.filter((r) => r.shown).map((r) => r.slug));
  const saved = !pending && !state.error && state.sent === value;
  const label = (slug: CategorySlug) => categories.find((c) => c.slug === slug)!.label;
  const move = (i: number, by: -1 | 1) =>
    setRows((rs) => {
      const n = [...rs];
      [n[i], n[i + by]] = [n[i + by]!, n[i]!];
      return n;
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(() => submit(f));
      }}
      className={styles.list}
    >
      <input type="hidden" name="value" value={value} />
      <input type="hidden" name="at" value={state.at ?? read ?? ""} />
      {rows.map((r, i) => (
        <div key={r.slug} className={ui.row}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={r.shown}
              onChange={(e) => setRows((rs) => rs.map((x) => (x.slug === r.slug ? { ...x, shown: e.target.checked } : x)))}
            />
            {label(r.slug)}
          </label>
          <span className={ui.secondary}>{r.shown ? "Shown" : "Hidden"}</span>
          <button type="button" className={ui.btnLink} disabled={i === 0} onClick={() => move(i, -1)}>
            Move up
          </button>
          <button type="button" className={ui.btnLink} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
            Move down
          </button>
        </div>
      ))}
      {state.error && (
        <p role="alert" className={ui.alert}>
          {state.error}
        </p>
      )}
      <div className={ui.row}>
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending || value === "[]"}>
          {pending ? "Saving…" : "Save"}
        </button>
        {value === "[]" && <span className={ui.secondary}>Show at least one.</span>}
        {saved && <span className={ui.secondary}>Saved. Phones show it within a couple of minutes of opening the app.</span>}
      </div>
    </form>
  );
}
