"use client";

import { AD_COLOURS, AD_LINKS, AD_PLACES, type Ad, type AdColour, type AdPlace, adLive, type ContentKey, type HelpAnswer } from "@orbit/contract";
import { type ReactNode, useActionState, useMemo, useState } from "react";
import { Badge, ui } from "../../ui";
import act from "../act.module.css";
import { saveList } from "./actions";
import styles from "./content.module.css";

// One list, edited in place and saved whole: rows move up and down, come out, or are added at the end, then one Save.
// `at` is when the server's copy was read; the list goes back with it, so a save over someone else's since is refused.
function ListEditor<T>({
  k,
  initial,
  at,
  max,
  noun,
  blank,
  toValue = (rows) => rows,
  row,
}: {
  k: ContentKey;
  initial: T[];
  at: string | null;
  max: number;
  noun: string; // "ad", for "Add ad" and "Ad 2"
  blank: () => T;
  toValue?: (rows: T[]) => unknown;
  row: (r: T, set: (patch: Partial<T>) => void, i: number) => ReactNode;
}) {
  const [rows, setRows] = useState(initial);
  const [read] = useState(at); // what the rows were read at; once saved, the action's answer carries it
  const action = useMemo(() => saveList.bind(null, k), [k]);
  const [state, submit, pending] = useActionState(action, {});
  const value = JSON.stringify(toValue(rows));
  const saved = !pending && !state.error && state.sent === value; // what's on screen is what was saved

  const change = setRows;
  const move = (i: number, by: -1 | 1) =>
    change((rs) => {
      const n = [...rs];
      [n[i], n[i + by]] = [n[i + by]!, n[i]!];
      return n;
    });
  const Noun = noun[0]!.toUpperCase() + noun.slice(1);

  return (
    <form action={submit} className={styles.list}>
      <input type="hidden" name="value" value={value} />
      <input type="hidden" name="at" value={state.at ?? read ?? ""} />
      {rows.length === 0 && <p className={ui.secondary}>None. The app shows nothing here.</p>}
      {rows.map((r, i) => (
        <fieldset key={i} className={styles.item}>
          <legend className={styles.legend}>
            {Noun} {i + 1}
          </legend>
          {row(r, (patch) => change((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}
          <div className={ui.row}>
            <button type="button" className={ui.btnLink} disabled={i === 0} onClick={() => move(i, -1)}>
              Move up
            </button>
            <button type="button" className={ui.btnLink} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              Move down
            </button>
            <button type="button" className={ui.btnLink} onClick={() => change((rs) => rs.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </fieldset>
      ))}
      {state.error && (
        <p role="alert" className={ui.alert}>
          {state.error}
        </p>
      )}
      <div className={ui.row}>
        <button type="button" className={ui.btn} disabled={rows.length >= max} onClick={() => change((rs) => [...rs, blank()])}>
          Add {noun}
        </button>
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && <span className={ui.secondary}>Saved. Phones show it within a couple of minutes of opening the app.</span>}
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

const text = (value: string, set: (v: string) => void, max: number, extra: object = {}) => (
  <input className={`${ui.input} ${styles.wide}`} value={value} maxLength={max} required onChange={(e) => set(e.target.value)} {...extra} />
);

// ─── Ad strips ───
// The strip as a phone draws it, roughly: its fill, Stone words, one line each, 4.5 times as wide as it's tall.
function Strip({ ad }: { ad: Ad }) {
  return (
    <div className={styles.strip} style={{ background: `var(--orbit-${ad.colour})` }} aria-hidden>
      <span className={styles.kicker}>{ad.kicker || "Kicker"}</span>
      <span className={styles.title}>{ad.title || "Title"}</span>
      <span className={styles.line}>{ad.line || "Line"}</span>
    </div>
  );
}

const PLACES = Object.entries(AD_PLACES) as [AdPlace, string][];

// Staff are in India, so a date-and-time box shows and takes India's time (a fixed UTC+5:30), and the ad keeps the
// moment with its offset: "2026-11-30T21:00" in the box is "2026-11-30T21:00:00+05:30".
const IST = 330 * 60_000;
const toBox = (iso?: string) => (iso ? new Date(Date.parse(iso) + IST).toISOString().slice(0, 16) : "");
const fromBox = (v: string) => (v ? `${v}:00+05:30` : undefined);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Whether the ad is on phones right now (as of opening the page), and until or from when.
function Timing({ ad, now }: { ad: Ad; now: number }) {
  if (adLive(ad, now)) return <Badge tone="success">{ad.ends ? `Live until ${when(ad.ends)}` : "Live"}</Badge>;
  if (ad.starts && Date.parse(ad.starts) > now) return <Badge tone="info">Starts {when(ad.starts)}</Badge>;
  return <Badge tone="neutral">Ended {ad.ends && when(ad.ends)}</Badge>;
}

export function AdsEditor({ initial, at }: { initial: Ad[]; at: string | null }) {
  const [now] = useState(Date.now);
  return (
    <>
      <datalist id="ad-links">
        {Object.entries(AD_LINKS).map(([href, label]) => (
          <option key={href} value={href}>
            {label}
          </option>
        ))}
      </datalist>
      <ListEditor<Ad>
        k="ads"
        initial={initial}
        at={at}
        max={10}
        noun="ad"
        blank={() => ({ kicker: "", title: "", line: "", colour: "forest", places: ["home"] })}
        // An empty "Opens" is no link at all.
        toValue={(rows) => rows.map(({ href, ...a }) => (href?.trim() ? { ...a, href: href.trim() } : a))}
        row={(ad, set) => (
          <div className={styles.ad}>
            <div>
              <Timing ad={ad} now={now} />
            </div>
            <Strip ad={ad} />
            <div className={styles.fields}>
              <Field label="Kicker" note="up to 20">
                {text(ad.kicker, (kicker) => set({ kicker }), 20)}
              </Field>
              <Field label="Title" note="up to 24">
                {text(ad.title, (title) => set({ title }), 24)}
              </Field>
              <Field label="Line" note="up to 32">
                {text(ad.line, (line) => set({ line }), 32)}
              </Field>
              <Field label="Colour">
                <select className={`${ui.input} ${styles.wide}`} value={ad.colour} onChange={(e) => set({ colour: e.target.value as AdColour })}>
                  {Object.entries(AD_COLOURS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Opens" note="empty for none">
                <input
                  className={`${ui.input} ${styles.wide}`}
                  value={ad.href ?? ""}
                  list="ad-links"
                  maxLength={100}
                  placeholder="/search, /event/…, /host/…"
                  onChange={(e) => set({ href: e.target.value })}
                />
              </Field>
              <Field label="Starts" note="India time, empty for now">
                <input
                  type="datetime-local"
                  className={`${ui.input} ${styles.wide}`}
                  value={toBox(ad.starts)}
                  onChange={(e) => set({ starts: fromBox(e.target.value) })}
                />
              </Field>
              <Field label="Ends" note="India time, empty for never">
                <input
                  type="datetime-local"
                  className={`${ui.input} ${styles.wide}`}
                  value={toBox(ad.ends)}
                  min={toBox(ad.starts) || undefined}
                  onChange={(e) => set({ ends: fromBox(e.target.value) })}
                />
              </Field>
            </div>
            <fieldset className={styles.places}>
              <legend className={act.label}>Shows on</legend>
              {PLACES.map(([p, label]) => (
                <label key={p} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={ad.places.includes(p)}
                    onChange={(e) => set({ places: e.target.checked ? PLACES.map(([q]) => q).filter((q) => q === p || ad.places.includes(q)) : ad.places.filter((q) => q !== p) })}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
        )}
      />
    </>
  );
}

// ─── Help answers ───
export function HelpEditor({ initial, at }: { initial: HelpAnswer[]; at: string | null }) {
  return (
    <ListEditor<HelpAnswer>
      k="help"
      initial={initial}
      at={at}
      max={20}
      noun="question"
      blank={() => ({ q: "", a: "" })}
      row={(h, set) => (
        <div className={styles.fields}>
          <Field label="Question" note="up to 80">
            {text(h.q, (q) => set({ q }), 80)}
          </Field>
          <Field label="Answer" note="up to 400">
            <textarea className={act.reason} value={h.a} maxLength={400} required onChange={(e) => set({ a: e.target.value })} />
          </Field>
        </div>
      )}
    />
  );
}

// ─── Ask Orbit ───
// Strings have no fields to patch, so each chip is held as { text } while editing and goes back as plain text.
type Chip = { text: string };
export function AsksEditor({ initial, at }: { initial: string[]; at: string | null }) {
  return (
    <ListEditor<Chip>
      k="asks"
      initial={initial.map((t) => ({ text: t }))}
      at={at}
      max={6}
      noun="chip"
      blank={() => ({ text: "" })}
      toValue={(rows) => rows.map((r) => r.text)}
      row={(c, set) => (
        <Field label="Ask" note="up to 40">
          {text(c.text, (t) => set({ text: t }), 40)}
        </Field>
      )}
    />
  );
}
