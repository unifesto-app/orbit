import type { StaffFeature } from "@orbit/contract";

// Who may give, confirm and take staff features, act on people, and run a host's team (Orbit flows: Roles). Pure, so
// each rule is tested as a table in rules.test.ts; the routes load the rows and apply the answer.

const DAY = 24 * 3600 * 1000;
export const INVITE_DAYS = 14;

export type Actor = { id: string; owner: boolean; features: readonly StaffFeature[] };
export const holds = (a: Actor, f: StaffFeature) => a.owner || a.features.includes(f);

type No<E extends string> = { ok: false; error: E };

// Giving a feature: a holder of Staff adds it, never to themselves. The platform owner's adds start at once (every holder
// of Staff is emailed); anyone else's wait for a second holder to confirm.
export function addRule(actor: Actor, target: { id: string; owner: boolean }, now: number): { ok: true; startsAt: Date | null } | No<"forbidden" | "self" | "owner"> {
  if (!holds(actor, "staff")) return { ok: false, error: "forbidden" };
  if (target.id === actor.id) return { ok: false, error: "self" };
  if (target.owner) return { ok: false, error: "owner" }; // holds everything already
  return { ok: true, startsAt: actor.owner ? new Date(now) : null };
}

export type Grant = { userId: string; addedBy: string; startsAt: Date | null; endedAt: Date | null };

// Confirming: a holder of Staff who is neither the adder nor the person.
export function confirmRule(actor: Actor, g: Grant): { ok: true } | No<"forbidden" | "notWaiting" | "self"> {
  if (!holds(actor, "staff")) return { ok: false, error: "forbidden" };
  if (g.endedAt || g.startsAt) return { ok: false, error: "notWaiting" };
  if (actor.id === g.addedBy || actor.id === g.userId) return { ok: false, error: "self" };
  return { ok: true };
}

// Taking a feature away, or cancelling one still waiting: at once, by any holder of Staff but the person.
export function endRule(actor: Actor, g: Grant): { ok: true } | No<"forbidden" | "notOpen" | "self"> {
  if (!holds(actor, "staff")) return { ok: false, error: "forbidden" };
  if (g.endedAt) return { ok: false, error: "notOpen" };
  if (actor.id === g.userId) return { ok: false, error: "self" };
  return { ok: true };
}

// Suspending or closing an account, or lifting it: People; never yourself or the platform owner; a staff account
// needs Staff as well.
export function suspendRule(actor: Actor, target: { id: string; owner: boolean; staff: boolean }): { ok: true } | No<"forbidden" | "self" | "owner" | "needsStaff"> {
  if (!holds(actor, "people")) return { ok: false, error: "forbidden" };
  if (target.id === actor.id) return { ok: false, error: "self" };
  if (target.owner) return { ok: false, error: "owner" };
  if (target.staff && !holds(actor, "staff")) return { ok: false, error: "needsStaff" };
  return { ok: true };
}

// A place on a team, as far as the rules need it.
export type Seat = { userId: string | null; addedBy: string; addedAt: Date; acceptedAt: Date | null; startedAt: Date | null; endedAt: Date | null };
export const expired = (s: Seat, now: number) => !s.startedAt && !s.endedAt && s.addedAt.getTime() + INVITE_DAYS * DAY <= now;
export const waiting = (s: Seat, now: number) => !s.startedAt && !s.endedAt && !expired(s, now);

// Accepting: only the person the invite went to, while it waits.
export function acceptRule(s: Seat, mine: boolean, now: number): { ok: true } | No<"notFound" | "notWaiting"> {
  if (!mine) return { ok: false, error: "notFound" }; // never says an invite exists for someone else
  if (!waiting(s, now) || s.acceptedAt) return { ok: false, error: "notWaiting" };
  return { ok: true };
}

// Confirming an Admin: the adder, once they've accepted.
export function confirmSeatRule(actorId: string, actorIsAdmin: boolean, s: Seat, now: number): { ok: true } | No<"forbidden" | "notAccepted" | "lapsed" | "notWaiting"> {
  if (!actorIsAdmin || actorId !== s.addedBy) return { ok: false, error: "forbidden" };
  if (expired(s, now)) return { ok: false, error: "lapsed" };
  if (!waiting(s, now)) return { ok: false, error: "notWaiting" };
  if (!s.acceptedAt) return { ok: false, error: "notAccepted" };
  return { ok: true };
}

// Withdrawing an invite or removing someone: any Admin, never the owner, and never yourself (that's leaving).
export function endSeatRule(actorId: string, actorIsAdmin: boolean, s: Seat & { owner: boolean }, now: number): { ok: true; reason: "withdrawn" | "removed" } | No<"forbidden" | "owner" | "self" | "notOpen"> {
  if (!actorIsAdmin) return { ok: false, error: "forbidden" };
  if (s.endedAt || expired(s, now)) return { ok: false, error: "notOpen" };
  if (s.owner) return { ok: false, error: "owner" };
  if (s.userId === actorId) return { ok: false, error: "self" };
  return { ok: true, reason: s.startedAt ? "removed" : "withdrawn" };
}
