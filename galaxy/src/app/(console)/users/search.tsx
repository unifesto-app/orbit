"use client";

import { STAFF_FEATURES, type StaffFeature } from "@orbit/contract";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useEffectEvent } from "react";
import { Alert, Badge, Container, day, FEATURE_NAMES, Pages, phone, ui } from "../../ui";
import { Act } from "../act";
import { grantFeatures, liftPerson, type Person, searchPeople, suspendPerson } from "../actions";

export type Listing = { people: Person[]; total: number; page: number; pageSize: number };

// The Users page: every account a page at a time (read by the server, so only the page number is in the address), and
// the search above it. The search is a Server Action held on this page, so nothing typed goes in the address; while it
// has results they stand in for the list. After an action the same search runs again, so the row shows what changed.
export function PeopleSearch({ features, self, list }: { features: StaffFeature[]; self: string | null; list: Listing | null }) {
  const [found, search, pending] = useActionState(searchPeople, { q: "" });
  const run = (q: string) => {
    const f = new FormData();
    f.set("q", q);
    startTransition(() => search(f));
  };
  const table = { features, self };
  // Next keeps a page kept, hidden, when you leave it (cacheComponents), and runs its effects again when you come back:
  // search again then, so a person suspended on their page meanwhile doesn't still show Active here.
  const again = useEffectEvent(() => {
    if (found.q) run(found.q);
  });
  useEffect(() => again(), []);

  return (
    <>
      {/* Keyed on the search shown, so Clear empties the box too. */}
      <form key={found.q} action={search} className={ui.row}>
        <input className={ui.input} name="q" defaultValue={found.q} placeholder="Name, phone or email" aria-label="Name, phone or email" minLength={3} required />
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          Search
        </button>
        {found.q && (
          <button type="button" className={ui.btn} disabled={pending} onClick={() => run("")}>
            Clear
          </button>
        )}
      </form>
      <Alert>{found.error}</Alert>
      {found.people ? (
        <Container title="Search results" count={found.people.length}>
          {found.people.length === 0 ? <p className={ui.secondary}>Nobody matches.</p> : <PeopleTable people={found.people} {...table} onDone={() => run(found.q)} />}
        </Container>
      ) : (
        list && (
          <Container title="All users" count={list.total}>
            <PeopleTable people={list.people} {...table} />
            <Pages path="/users" {...list} />
          </Container>
        )
      )}
    </>
  );
}

export function PeopleTable({ people, features, self, onDone }: { people: Person[]; features: StaffFeature[]; self: string | null; onDone?: () => void }) {
  return (
    <table className={ui.table}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Phone</th>
          <th>Email</th>
          <th>On Orbit since</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {people.map((p) => (
          <tr key={p.id}>
            <td>
              {features.includes("people") ? (
                // No prefetch: opening a person's page is written to the audit log.
                <Link href={`/users/${p.id}`} prefetch={false}>
                  {p.name ?? "No name yet"}
                </Link>
              ) : (
                (p.name ?? "No name yet")
              )}
            </td>
            <td>{p.phone ? phone(p.phone) : "–"}</td>
            <td>{p.email ?? "–"}</td>
            <td>{day(p.since)}</td>
            <td>{p.suspended ? <Badge tone="error">Suspended</Badge> : <Badge tone="success">Active</Badge>}</td>
            <td>{p.id === self ? <span className={ui.secondary}>You</span> : <PersonActions person={p} features={features} onDone={onDone} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Suspend or lift (People), and Give access (Staff). The person's id comes from the row or page, never from a link.
// `stack` lays them one under another, as on a page's Actions; a table row keeps them side by side.
export function PersonActions({ person: p, features, onDone, stack }: { person: Person; features: StaffFeature[]; onDone?: () => void; stack?: boolean }) {
  return (
    <div className={stack ? ui.page : ui.row}>
      {features.includes("people") &&
        (p.suspended ? (
          <Act label="Lift suspension" action={liftPerson} hidden={{ id: p.id }} who="They see this" onDone={onDone} />
        ) : (
          <Act label="Suspend" action={suspendPerson} hidden={{ id: p.id }} who="They see this" onDone={onDone}>
            <label>
              Until <span className={ui.secondary}>(empty closes the account for good)</span>
              <input className={ui.input} type="date" name="until" />
            </label>
          </Act>
        ))}
      {features.includes("staff") && (
        <Act label="Give access" action={grantFeatures} hidden={{ userId: p.id }} who="Everyone with Staff sees this">
          <fieldset className={ui.row}>
            <legend className={ui.secondary}>Features</legend>
            {STAFF_FEATURES.map((f) => (
              <label key={f} className={ui.row}>
                <input type="checkbox" name="feature" value={f} /> {FEATURE_NAMES[f]}
              </label>
            ))}
          </fieldset>
        </Act>
      )}
    </div>
  );
}
