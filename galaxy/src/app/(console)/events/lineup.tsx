"use client";

import { type EventAct, FEST_ITEM_KINDS, MAX_EVENT_ACTS, type StaffFestItem, type StaffLineup, type StaffPerson } from "@orbit/contract";
import { type ReactNode, useActionState } from "react";
import { ui } from "../../ui";
import { addEventPerson, addFestItem, type Done, deleteFestItem, editFestItem, editPerson, orderFestItems, setEventActs, setEventPeople } from "../actions";
import styles from "../act.module.css";

// An event's People and Inside the fest (X14): the lists in order, each row with Up, Down and Remove, and a form to add.
// Every move sends the whole list as the page shows it.

type Action = (prev: Done, form: FormData) => Promise<Done>;

// One form posting to one action, with its own error line.
function Post({ action, hidden, label, children, inline }: { action: Action; hidden: Record<string, string>; label: string; children?: ReactNode; inline?: boolean }) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className={inline ? undefined : styles.form} style={inline ? { display: "inline" } : undefined}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <button className={inline ? ui.btn : `${ui.btn} ${ui.primary}`} disabled={pending}>
        {label}
      </button>
      {state.error && (
        <p role="alert" className={styles.alert}>
          {state.error}
        </p>
      )}
    </form>
  );
}

const Field = ({ label, name, value, required = true, max }: { label: string; name: string; value?: string | null; required?: boolean; max: number }) => (
  <label className={styles.label}>
    {label}
    <input name={name} defaultValue={value ?? ""} required={required} maxLength={max} className={ui.input} />
  </label>
);

// The list with item i moved by d (up -1, down +1).
const moved = <T,>(list: T[], i: number, d: number) => {
  const out = [...list];
  [out[i], out[i + d]] = [out[i + d]!, out[i]!];
  return out;
};

export function People({ eventId, lineup, persons, q }: { eventId: string; lineup: StaffLineup["people"]; persons: StaffPerson[]; q: string }) {
  const list = lineup.map((p) => ({ personId: p.id, role: p.role }));
  // `shown`: the people and roles this page showed, so a change made since is refused rather than overwritten.
  const set = (people: typeof list) => ({ id: eventId, shown: JSON.stringify(list), people: JSON.stringify(people) });
  const others = persons.filter((p) => !list.some((x) => x.personId === p.id));
  return (
    <div className={ui.page}>
      {lineup.length === 0 ? (
        <p className={ui.secondary}>Nobody on this event yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Line</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lineup.map((p, i) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.headline}</td>
                <td>{p.role}</td>
                <td>
                  {i > 0 && <Post inline action={setEventPeople} hidden={set(moved(list, i, -1))} label="Up" />}
                  {i < lineup.length - 1 && <Post inline action={setEventPeople} hidden={set(moved(list, i, 1))} label="Down" />}
                  <Post inline action={setEventPeople} hidden={set(list.filter((_, j) => j !== i))} label="Remove" />
                  <details>
                    <summary className={ui.btn}>Edit person</summary>
                    <Post action={editPerson} hidden={{ personId: p.id }} label="Save">
                      <Field label="Name" name="name" value={p.name} max={80} />
                      <Field label="Line" name="headline" value={p.headline} max={120} />
                      <label className={styles.label}>
                        Bio (optional)
                        <textarea name="bio" defaultValue={p.bio ?? ""} maxLength={2000} className={styles.reason} />
                      </label>
                      <label className={styles.label}>
                        Links, one a line: the label, then the https address (up to 5)
                        <textarea name="links" defaultValue={p.links.map((l) => `${l.label} ${l.url}`).join("\n")} className={styles.reason} />
                      </label>
                      <p className={ui.secondary}>Changes show on every event they&apos;re on.</p>
                    </Post>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details open={!!q || undefined}>
        <summary className={ui.btn}>Add a person</summary>
        {/* Narrows the list below by name (the API answers 50 at most). A name isn't private, so it can ride in the address. */}
        <form method="get" className={styles.form}>
          <label className={styles.label}>
            Find someone by name
            <input name="q" type="search" defaultValue={q} maxLength={80} className={ui.input} />
          </label>
          <button className={ui.btn}>Search</button>
        </form>
        <Post action={addEventPerson} hidden={set(list)} label="Add">
          <label className={styles.label}>
            Person
            <select name="personId" className={ui.input} defaultValue="">
              <option value="">Someone new (fill in below)</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}: {p.headline}
                </option>
              ))}
            </select>
          </label>
          <Field label="New person's name" name="name" required={false} max={80} />
          <Field label="New person's line" name="headline" required={false} max={120} />
          <Field label="Role on this event" name="role" max={30} />
        </Post>
      </details>
    </div>
  );
}

function ItemFields({ item }: { item?: StaffFestItem }) {
  return (
    <>
      <Field label="Title" name="title" value={item?.title} max={120} />
      <label className={styles.label}>
        Kind
        <select name="kind" className={ui.input} defaultValue={item?.kind ?? FEST_ITEM_KINDS[0]}>
          {FEST_ITEM_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <Field label="When (as the page shows it)" name="when" value={item?.when} max={30} />
      <Field label="Where" name="where" value={item?.where} max={120} />
      <label className={styles.label}>
        About
        <textarea name="about" defaultValue={item?.about ?? ""} required maxLength={2000} className={styles.reason} />
      </label>
      <Field label="Team size (optional)" name="team" value={item?.team} required={false} max={60} />
      <Field label="Prize (optional)" name="prize" value={item?.prize} required={false} max={120} />
      <Field label="Act's host id (optional)" name="actHostId" value={item?.actHostId} required={false} max={36} />
    </>
  );
}

export function FestItems({ eventId, items }: { eventId: string; items: StaffFestItem[] }) {
  const ids = items.map((i) => i.id);
  const order = (next: string[]) => ({ id: eventId, ids: JSON.stringify(next) });
  return (
    <div className={ui.page}>
      {items.length === 0 ? (
        <p className={ui.secondary}>Nothing inside this fest yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Kind</th>
              <th>When</th>
              <th>Where</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id}>
                <td>{it.title}</td>
                <td>{it.kind}</td>
                <td>{it.when}</td>
                <td>{it.where}</td>
                <td>
                  {i > 0 && <Post inline action={orderFestItems} hidden={order(moved(ids, i, -1))} label="Up" />}
                  {i < items.length - 1 && <Post inline action={orderFestItems} hidden={order(moved(ids, i, 1))} label="Down" />}
                  <Post inline action={deleteFestItem} hidden={{ itemId: it.id }} label="Remove" />
                  <details>
                    <summary className={ui.btn}>Edit</summary>
                    <Post action={editFestItem} hidden={{ itemId: it.id }} label="Save">
                      <ItemFields item={it} />
                    </Post>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary className={ui.btn}>Add to the fest</summary>
        <Post action={addFestItem} hidden={{ id: eventId }} label="Add">
          <ItemFields />
        </Post>
      </details>
    </div>
  );
}

// An event's acts (A1): other hosts, in order. "Hidden" when the host isn't public and live, so the page drops it.
export function Acts({ eventId, acts }: { eventId: string; acts: EventAct[] }) {
  const ids = acts.map((a) => a.hostId);
  const set = (next: string[]) => ({ id: eventId, shown: JSON.stringify(ids), hostIds: JSON.stringify(next) });
  return (
    <div className={ui.page}>
      {acts.length === 0 ? (
        <p className={ui.secondary}>No acts on this event yet.</p>
      ) : (
        <table className={ui.table}>
          <thead>
            <tr>
              <th>Host</th>
              <th>Link</th>
              <th>On the page</th>
              <th>Added by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {acts.map((a, i) => (
              <tr key={a.hostId}>
                <td>{a.name}</td>
                <td>{a.slug}</td>
                <td>{a.shown ? "Shown" : "Hidden"}</td>
                <td>{a.addedBy ? (a.addedBy.name ?? "No name") : "Gone"}</td>
                <td>
                  {i > 0 && <Post inline action={setEventActs} hidden={set(moved(ids, i, -1))} label="Up" />}
                  {i < acts.length - 1 && <Post inline action={setEventActs} hidden={set(moved(ids, i, 1))} label="Down" />}
                  <Post inline action={setEventActs} hidden={set(ids.filter((_, j) => j !== i))} label="Remove" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {acts.length < MAX_EVENT_ACTS && (
        <details>
          <summary className={ui.btn}>Add an act</summary>
          <Post action={setEventActs} hidden={set(ids)} label="Add">
            <Field label="The act's host id (public and live, not this event's host)" name="add" max={36} />
          </Post>
        </details>
      )}
    </div>
  );
}
