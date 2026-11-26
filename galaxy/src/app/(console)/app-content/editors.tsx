"use client";

import {
  AD_COLOURS,
  AD_LINKS,
  AD_PLACES,
  type Ad,
  type AdColour,
  type AdPlace,
  CONTENT_SHAPES,
  type ContentImage,
  type ContentKey,
  type ContentShape,
  type HelpAnswer,
  type Knowledge,
  liveAt,
  PHOTO_MAX_BYTES,
  type Promotion,
  SLIDE_KINDS,
  type Slide,
} from "@orbit/contract";
import { type ReactNode, startTransition, useActionState, useMemo, useRef, useState } from "react";
import { Badge, ui } from "../../ui";
import act from "../act.module.css";
import { fromBox, toBox } from "../../../ist";
import { saveList, setAsk, uploadImage } from "./actions";
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
  empty = "None. The app shows nothing here.",
}: {
  empty?: string;
  k: ContentKey;
  initial: T[];
  at: string | null;
  max: number;
  noun: string; // "ad", for "Add ad" and "Ad 2"
  blank: () => T;
  toValue?: (rows: T[]) => unknown;
  row: (r: T, set: (patch: Partial<T>) => void, i: number) => ReactNode;
}) {
  // Each row keeps an id of its own while the page is open, so an upload that finishes after a row moved or went lands on
  // the row it started on, or nowhere.
  const [rows, setRows] = useState(() => initial.map((v, id) => ({ id, v })));
  const [nextId, setNextId] = useState(initial.length);
  const [read] = useState(at); // what the rows were read at; once saved, the action's answer carries it
  const action = useMemo(() => saveList.bind(null, k), [k]);
  const [state, submit, pending] = useActionState(action, {});
  const value = JSON.stringify(toValue(rows.map((r) => r.v)));
  const saved = !pending && !state.error && state.sent === value; // what's on screen is what was saved

  const move = (i: number, by: -1 | 1) =>
    setRows((rs) => {
      const n = [...rs];
      [n[i], n[i + by]] = [n[i + by]!, n[i]!];
      return n;
    });
  const patch = (id: number) => (p: Partial<T>) => setRows((rs) => rs.map((r) => (r.id === id ? { id, v: { ...r.v, ...p } } : r)));
  const add = () => {
    setRows((rs) => [...rs, { id: nextId, v: blank() }]);
    setNextId((n) => n + 1);
  };
  const Noun = noun[0]!.toUpperCase() + noun.slice(1);

  return (
    // Sent by hand, never as the form's action: React resets a form once its action finishes, which put a box ticked
    // since the page loaded back to unticked while the list (and the save) kept it ticked.
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
      {rows.length === 0 && <p className={ui.secondary}>{empty}</p>}
      {rows.map((r, i) => (
        <fieldset key={r.id} className={styles.item}>
          <legend className={styles.legend}>
            {Noun} {i + 1}
          </legend>
          {row(r.v, patch(r.id), i)}
          <div className={ui.row}>
            <button type="button" className={ui.btnLink} disabled={i === 0} onClick={() => move(i, -1)}>
              Move up
            </button>
            <button type="button" className={ui.btnLink} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
              Move down
            </button>
            <button type="button" className={ui.btnLink} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
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
        <button type="button" className={ui.btn} disabled={rows.length >= max} onClick={add}>
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

const text = (value: string | undefined, set: (v: string) => void, max: number, extra: object = {}) => (
  <input className={`${ui.input} ${styles.wide}`} value={value ?? ""} maxLength={max} required onChange={(e) => set(e.target.value)} {...extra} />
);

// A link as staff paste it ("https://heyorbit.in/event/open-mic-night", or "/event/open-mic-night"), as the app's route.
const route = (v: string | undefined) => v?.trim().replace(/^(https?:\/\/)?(www\.)?heyorbit\.in(?=\/)/, "") || undefined;
// Drops what's empty, so an untouched optional box isn't sent as "".
const tidy = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

type Timed = { starts?: string; ends?: string };
// Whether it's on phones right now (as of opening the page, by the server's clock), and until or from when. The
// server's Node and the browser may spell a time differently ("pm", "PM"), so the words may differ when the page comes
// alive; the browser's win.
function Timing({ item, now }: { item: Timed; now: number }) {
  const [tone, words] = liveAt(item, now)
    ? (["success", item.ends ? `Live until ${when(item.ends)}` : "Live"] as const)
    : item.starts && Date.parse(item.starts) > now
      ? (["info", `Starts ${when(item.starts)}`] as const)
      : (["neutral", `Ended${item.ends ? ` ${when(item.ends)}` : ""}`] as const);
  return (
    <div>
      <Badge tone={tone}>
        <span suppressHydrationWarning>{words}</span>
      </Badge>
    </div>
  );
}

function TimeFields({ item, set }: { item: Timed; set: (patch: Timed) => void }) {
  return (
    <>
      <Field label="Starts" note="India time, empty for now">
        <input type="datetime-local" className={`${ui.input} ${styles.wide}`} value={toBox(item.starts)} onChange={(e) => set({ starts: fromBox(e.target.value) })} />
      </Field>
      <Field label="Ends" note="India time, empty for never">
        <input
          type="datetime-local"
          className={`${ui.input} ${styles.wide}`}
          value={toBox(item.ends)}
          min={toBox(item.starts) || undefined}
          onChange={(e) => set({ ends: fromBox(e.target.value) })}
        />
      </Field>
    </>
  );
}

// Uploads one image the moment it's chosen (owner, 19 Nov 2026: "Ad strips image uplaod also instead of text", "also
// add custom ads in carousel"). It's kept only once the list is saved with it; the API refuses a wrong shape, never
// crops it.
function ImagePick({ shape, has, onImage }: { shape: ContentShape; has: boolean; onImage: (image: ContentImage) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const send = async (picked: File) => {
    // Over 5 MB never leaves the browser: past Galaxy's 6 MB limit it wouldn't reach the action at all.
    if (picked.size > PHOTO_MAX_BYTES) return setError("That image is over 5 MB.");
    setBusy(true);
    setError(undefined);
    try {
      const f = new FormData();
      f.append("image", picked);
      const r = await uploadImage(shape, f);
      if (r.image) onImage(r.image);
      else setError(r.error);
    } catch {
      setError("The upload didn’t get through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.pick}>
      <div className={ui.row}>
        {/* A real button, so a keyboard reaches it; the file box itself is out of sight. */}
        <button type="button" className={ui.btn} disabled={busy} onClick={() => file.current?.click()}>
          {busy ? "Uploading…" : has ? "Replace image" : "Upload image"}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={styles.offscreen}
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = ""; // the same file can be chosen again after a refusal
            if (picked) void send(picked);
          }}
        />
        <span className={ui.secondary}>{CONTENT_SHAPES[shape]}; a JPG, PNG or WebP up to 5 MB</span>
      </div>
      {error && (
        <p role="alert" className={ui.alert}>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Ad strips ───
// The strip as a phone draws it, roughly: its fill, Stone words, one line each, 4.5 times as wide as it's tall; or the
// uploaded image filling it.
function Strip({ ad }: { ad: Ad }) {
  return (
    <div className={styles.strip} style={{ background: `var(--orbit-${ad.colour})` }} aria-hidden>
      {ad.image ? (
        // A plain img: the API's own address, already a small WebP, so Next's image server adds nothing.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.image} alt="" className={styles.fill} />
      ) : (
        <>
          <span className={styles.kicker}>{ad.kicker || "Kicker"}</span>
          <span className={styles.title}>{ad.title || "Title"}</span>
          <span className={styles.line}>{ad.line || "Line"}</span>
        </>
      )}
    </div>
  );
}

const PLACES = Object.entries(AD_PLACES) as [AdPlace, string][];

function LinkList() {
  return (
    <datalist id="ad-links">
      {Object.entries(AD_LINKS).map(([href, label]) => (
        <option key={href} value={href}>
          {label}
        </option>
      ))}
    </datalist>
  );
}

function Opens({ value, set }: { value?: string; set: (href: string) => void }) {
  return (
    <Field label="Opens" note="empty for none">
      <input
        className={`${ui.input} ${styles.wide}`}
        value={value ?? ""}
        list="ad-links"
        maxLength={100}
        placeholder="/search, /event/…, /host/…"
        onChange={(e) => set(e.target.value)}
      />
    </Field>
  );
}

export function AdsEditor({ initial, at, now }: { initial: Ad[]; at: string | null; now: number }) {
  return (
    <>
      <LinkList />
      <ListEditor<Ad>
        k="ads"
        initial={initial}
        at={at}
        max={10}
        noun="ad"
        blank={() => ({ kicker: "", title: "", line: "", colour: "forest", places: ["home"] })}
        // An image strip shows no words: its kicker and line go; an empty "Opens" is no link at all.
        toValue={(rows) =>
          rows.map((a) => tidy({ ...a, href: route(a.href), ...(a.image ? { kicker: undefined, line: undefined } : {}) }))
        }
        row={(ad, set) => (
          <div className={styles.ad}>
            <Timing item={ad} now={now} />
            <Strip ad={ad} />
            <div className={ui.row}>
              <ImagePick shape="strip" has={!!ad.image} onImage={(img) => set({ image: img.url })} />
              {ad.image && (
                <button type="button" className={ui.btnLink} onClick={() => set({ image: undefined })}>
                  Use words instead
                </button>
              )}
            </div>
            <div className={styles.fields}>
              {!ad.image && (
                <Field label="Kicker" note="up to 20">
                  {text(ad.kicker, (kicker) => set({ kicker }), 20)}
                </Field>
              )}
              <Field label="Title" note={ad.image ? "read aloud for the image, up to 24" : "up to 24"}>
                {text(ad.title, (title) => set({ title }), 24)}
              </Field>
              {!ad.image && (
                <Field label="Line" note="up to 32">
                  {text(ad.line, (line) => set({ line }), 32)}
                </Field>
              )}
              <Field label="Colour" note={ad.image ? "under the image while it loads" : undefined}>
                <select className={`${ui.input} ${styles.wide}`} value={ad.colour} onChange={(e) => set({ colour: e.target.value as AdColour })}>
                  {Object.entries(AD_COLOURS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Opens value={ad.href} set={(href) => set({ href })} />
              <TimeFields item={ad} set={set} />
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

// ─── Featured: Home's carousel ───
// A pick draws with its event's 4:3 poster or its host's banner; an image slide with its own upload, the top edge's
// colour filling the space above it while it loads.
export function FeaturedEditor({ initial, at, now }: { initial: Slide[]; at: string | null; now: number }) {
  return (
    <ListEditor<Slide>
      k="featured"
      initial={initial}
      at={at}
      max={6}
      noun="slide"
      empty="None. The carousel picks all its slides itself."
      blank={() => ({ kind: "pick", href: "" })}
      toValue={(rows) =>
        rows.map((s) =>
          s.kind === "pick"
            ? tidy({ kind: s.kind, href: route(s.href), starts: s.starts, ends: s.ends })
            : tidy({ ...s, href: route(s.href) }),
        )
      }
      row={(s, set) => (
        <div className={styles.ad}>
          <Timing item={s} now={now} />
          <div className={styles.fields}>
            <Field label="Kind">
              <select className={`${ui.input} ${styles.wide}`} value={s.kind} onChange={(e) => set({ kind: e.target.value as Slide["kind"] })}>
                {Object.entries(SLIDE_KINDS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {s.kind === "pick" && (
              <Field label="Event or host" note="its link">
                {text(s.href, (href) => set({ href }), 100, { placeholder: "/event/… or /host/…" })}
              </Field>
            )}
          </div>
          {s.kind === "pick" ? (
            <p className={ui.secondary}>Shows with the event’s own 4:3 poster, or the host’s banner, while it has one and the event is still coming up.</p>
          ) : (
            <>
              {s.image && (
                <div className={styles.slide} style={{ background: s.edge }} aria-hidden>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the API's own small WebP */}
                  <img src={s.image} alt="" className={styles.fill} />
                </div>
              )}
              <ImagePick shape="wide" has={!!s.image} onImage={(img) => set({ image: img.url, edge: img.edge })} />
              <div className={styles.fields}>
                <Field label="Says" note="read aloud for the image, up to 80">
                  {text(s.label, (label) => set({ label }), 80)}
                </Field>
                <Field label="Pill" note="its button, up to 16; empty for Open; only with Opens">
                  <input className={`${ui.input} ${styles.wide}`} value={s.action ?? ""} maxLength={16} placeholder="See offer" onChange={(e) => set({ action: e.target.value })} />
                </Field>
                <Opens value={s.href} set={(href) => set({ href })} />
              </div>
            </>
          )}
          <div className={styles.fields}>
            <TimeFields item={s} set={set} />
          </div>
        </div>
      )}
    />
  );
}

// ─── Promoted ───
export function PromotedEditor({ initial, at, now }: { initial: Promotion[]; at: string | null; now: number }) {
  return (
    <ListEditor<Promotion>
      k="promoted"
      initial={initial}
      at={at}
      max={10}
      noun="event"
      blank={() => ({ href: "" })}
      toValue={(rows) => rows.map((p) => tidy({ ...p, href: route(p.href) }))}
      row={(p, set) => (
        <div className={styles.ad}>
          <Timing item={p} now={now} />
          <div className={styles.fields}>
            <Field label="Event" note="its link">
              {text(p.href, (href) => set({ href }), 100, { placeholder: "/event/…" })}
            </Field>
            <TimeFields item={p} set={set} />
          </div>
        </div>
      )}
    />
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

// Ask Orbit's switch: off, the chat says it's resting, at once for everyone.
export function AskSwitch({ on }: { on: boolean }) {
  const [state, flip, pending] = useActionState(setAsk.bind(null, !on), {});
  return (
    <form action={flip}>
      <div className={ui.row}>
        <button className={`${ui.btn} ${on ? "" : ui.primary}`} disabled={pending}>
          {on ? "Turn off" : "Turn on"}
        </button>
        <span className={ui.secondary}>{on ? "On: people can ask." : "Off: the chat says Ask Orbit is resting."}</span>
      </div>
      {state.error && (
        <p role="alert" className={ui.alert}>
          {state.error}
        </p>
      )}
    </form>
  );
}

// ─── Knowledge for Ask Orbit ───
// What the assistant knows beyond Help answers. Not served to phones, but anyone can get it back through the assistant.
export function KnowledgeEditor({ initial, at }: { initial: Knowledge[]; at: string | null }) {
  return (
    <ListEditor<Knowledge>
      k="knowledge"
      initial={initial}
      at={at}
      max={50}
      noun="entry"
      empty="None. Ask Orbit knows only the Help answers and what’s on Orbit."
      blank={() => ({ title: "", body: "" })}
      row={(e, set) => (
        <div className={styles.fields}>
          <Field label="Title" note="up to 80">
            {text(e.title, (title) => set({ title }), 80)}
          </Field>
          <Field label="What it should know" note="up to 2000">
            <textarea className={act.reason} value={e.body} maxLength={2000} required onChange={(ev) => set({ body: ev.target.value })} />
          </Field>
        </div>
      )}
    />
  );
}
