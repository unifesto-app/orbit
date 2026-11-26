"use client";

import { FEST_ITEM_KINDS, type StaffFestItem, type StaffLineup, type StaffPerson } from "@orbit/contract";
import { type ReactNode, useActionState } from "react";
import { ui } from "../../ui";
import { addEventPerson, addFestItem, type Done, deleteFestItem, editFestItem, orderFestItems, setEventPeople } from "../actions";
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

export function People({ eventId, lineup, persons }: { eventId: string; lineup: StaffLineup["people"]; persons: StaffPerson[] }) {
  const list = lineup.map((p) => ({ personId: p.id, role: p.role }));
  const set = (people: typeof list) => ({ id: eventId, people: JSON.stringify(people) });
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary className={ui.btn}>Add a person</summary>
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
