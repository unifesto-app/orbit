"use client";

import { STAFF_FEATURES, type StaffFeature } from "@orbit/contract";
import { startTransition, useActionState } from "react";
import { Alert, Badge, Container, day, FEATURE_NAMES, ui } from "../../ui";
import { Act } from "../act";
import { grantFeatures, liftPerson, searchPeople, suspendPerson } from "../actions";

// The People search and its results, held on this page: the search is a Server Action, so nothing typed goes in the
// address. After an action the same search runs again, so the row shows what changed.
export function PeopleSearch({ features, self }: { features: StaffFeature[]; self: string | null }) {
  const [found, search, pending] = useActionState(searchPeople, { q: "" });
  const again = () => {
    const f = new FormData();
    f.set("q", found.q);
    startTransition(() => search(f));
  };

  return (
    <>
      <form action={search} className={ui.row}>
        <input className={ui.input} name="q" defaultValue={found.q} placeholder="Name, phone or email" aria-label="Name, phone or email" minLength={3} required />
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          Search
        </button>
      </form>
      <Alert>{found.error}</Alert>
      {found.people && (
        <Container title="People" count={found.people.length}>
          {found.people.length === 0 ? (
            <p className={ui.secondary}>Nobody matches.</p>
          ) : (
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
                {found.people.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name ?? "No name yet"}</td>
                    <td>{p.phone ?? "–"}</td>
                    <td>{p.email ?? "–"}</td>
                    <td>{day(p.since)}</td>
                    <td>{p.suspended ? <Badge tone="error">Suspended</Badge> : <Badge tone="success">Active</Badge>}</td>
                    <td>
                      {p.id === self ? (
                        <span className={ui.secondary}>You</span>
                      ) : (
                        <div className={ui.row}>
                          {features.includes("people") &&
                            (p.suspended ? (
                              <Act label="Lift suspension" action={liftPerson} hidden={{ id: p.id }} who="They see this" onDone={again} />
                            ) : (
                              <Act label="Suspend" action={suspendPerson} hidden={{ id: p.id }} who="They see this" onDone={again}>
                                <label>
                                  Until <span className={ui.secondary}>(empty closes the account for good)</span>
                                  <input className={ui.input} type="date" name="until" />
                                </label>
                              </Act>
                            ))}
                          {features.includes("staff") && (
                            // The person's id comes from this row, never from a link.
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
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Container>
      )}
    </>
  );
}
