// The Hosts flow's rules as pure functions: routes load the rows and apply the answer.

export type Status = "live" | "paused" | "suspended" | "archived";
export type Action = "pause" | "resume" | "archive" | "restore";
// What an owner's pause or archive must wait for.
export type Blockers = { eventsWithBookings: number; openMoney: number };

// Archived, or archived and then suspended by staff (a lift puts it back archived): the host has ended, and only its
// owner may open it. `ownerOnlySql` in roles/access.ts is the same test for queries.
export const ownerOnly = (h: { status: string; liftTo: string | null }) => h.status === "archived" || (h.status === "suspended" && h.liftTo === "archived");

const MOVES: Record<Action, { from: Status[]; to: Status }> = {
  pause: { from: ["live"], to: "paused" },
  resume: { from: ["paused"], to: "live" },
  archive: { from: ["live", "paused"], to: "archived" },
  restore: { from: ["archived"], to: "live" },
};

// The owner's status moves. A suspended host is staff's to lift, so every owner action is refused on it.
export function statusRule(from: Status, action: Action, blockers: Blockers): { ok: true; to: Status } | { ok: false; error: "notNow" | "busy" } {
  const move = MOVES[action];
  if (!move.from.includes(from)) return { ok: false, error: "notNow" };
  if ((action === "pause" || action === "archive") && (blockers.eventsWithBookings > 0 || blockers.openMoney > 0)) return { ok: false, error: "busy" };
  return { ok: true, to: move.to };
}

type Parent = { id: string; status: Status; liftTo: string | null; parentId: string | null };

// Putting a host under another: one level deep (Hosts decision 3). `hasClubs` is whether the host has clubs of its own.
export function parentRule(host: { id: string; hasClubs: boolean }, parent: Parent | null): { ok: true } | { ok: false; error: "self" | "notFound" | "tooDeep" } {
  if (parent?.id === host.id) return { ok: false, error: "self" };
  if (!parent || ownerOnly(parent)) return { ok: false, error: "notFound" };
  if (parent.parentId || host.hasClubs) return { ok: false, error: "tooDeep" };
  return { ok: true };
}
