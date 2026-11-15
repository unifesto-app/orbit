import { and, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { type Roles, STAFF_FEATURES, type StaffFeature } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { auditLog, hosts, staffGrants, teamRoles, users } from "../db/schema.ts";
import type { User } from "../auth/sessions.ts";
import { type Env, fail } from "../http.ts";
import { type Actor, holds } from "./rules.ts";

// A person's roles, read from the tables on every request, never from a token, so taking one away is immediate.

export const activeFeatures = async (db: Db, userId: string, now: number) =>
  (
    await db
      .select({ feature: staffGrants.feature })
      .from(staffGrants)
      .where(and(eq(staffGrants.userId, userId), isNull(staffGrants.endedAt), isNotNull(staffGrants.startsAt), lte(staffGrants.startsAt, new Date(now))))
  ).map((r) => r.feature);

export async function actorOf(db: Db, u: User, now: number): Promise<Actor> {
  return { id: u.id, owner: u.platformOwner, features: u.platformOwner ? STAFF_FEATURES : await activeFeatures(db, u.id, now) };
}

// What the app's mode switcher draws from: roles that have started only.
export async function rolesOf(db: Db, u: User, now: number): Promise<Roles> {
  const a = await actorOf(db, u, now);
  const seats = await db
    .select({ hostId: hosts.id, ownerId: hosts.ownerId, role: teamRoles.role })
    .from(teamRoles)
    .innerJoin(hosts, eq(hosts.id, teamRoles.hostId))
    // An archived host is closed to all but its owner.
    .where(and(eq(teamRoles.userId, u.id), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt), or(ne(hosts.status, "archived"), eq(hosts.ownerId, u.id))));
  return {
    teams: seats.map((s) => ({ hostId: s.hostId, owner: s.ownerId === u.id, admin: s.role === "admin", events: {} })),
    staff: a.owner || a.features.length ? { owner: a.owner, features: [...a.features], confirmed: true } : null,
  };
}

export type StaffEnv = { Variables: Env["Variables"] & { actor: Actor } };

// Staff routes, each behind the feature it needs (any one of `fs`). To anyone without it, Galaxy doesn't exist.
// The phone's passcode on entering Galaxy (Roles decision 11) is the app's to ask; the API sees only the session.
export const requireFeature = (db: Db, now: () => number, ...fs: StaffFeature[]) =>
  createMiddleware<StaffEnv>(async (c, next) => {
    const actor = await actorOf(db, c.var.user, now());
    if (!fs.some((f) => holds(actor, f))) return fail(c, 404, "notFound", "There's nothing here.");
    c.set("actor", actor);
    await next();
  });

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// The person is back: every host suspended for want of an Admin goes live again where they're a started Admin, whoever's
// suspension took it down (Staff's own suspensions of a host aren't tied to an account and stay).
export const liftHostsOf = (tx: Db | Tx, userId: string, at: Date) =>
  tx
    .update(hosts)
    .set({ status: "live", suspendedWith: null, updatedAt: at })
    .where(
      and(
        eq(hosts.status, "suspended"),
        isNotNull(hosts.suspendedWith),
        sql`exists (select 1 from team_roles t where t.host_id = ${hosts.id} and t.user_id = ${userId} and t.role = 'admin'
                    and t.started_at is not null and t.ended_at is null)`,
      ),
    );

// A live host whose started Admins are all suspended goes on hold, tied to one of them, so nothing keeps selling with
// nobody to answer. Run after anything that takes an Admin away.
export const holdIfUnanswered = (tx: Db | Tx, hostId: string, at: Date) =>
  tx.execute(sql`
    update hosts h set status = 'suspended', updated_at = ${at.toISOString()}::timestamptz,
      suspended_with = (select t.user_id from team_roles t where t.host_id = h.id and t.role = 'admin'
                        and t.started_at is not null and t.ended_at is null limit 1)
    where h.id = ${hostId} and h.status = 'live'
      and exists (select 1 from team_roles t where t.host_id = h.id and t.role = 'admin' and t.started_at is not null and t.ended_at is null)
      and not exists (select 1 from team_roles t join users u on u.id = t.user_id
                      where t.host_id = h.id and t.role = 'admin' and t.started_at is not null and t.ended_at is null
                        and not (u.suspended_at is not null and (u.suspended_until is null or u.suspended_until > ${at.toISOString()}::timestamptz)))`);

// A suspension with an end date that has passed: cleared, with its hosts, the next time the person signs in.
export async function clearLapsedSuspension(db: Db, u: User, now: number): Promise<User> {
  if (!u.suspendedAt || !u.suspendedUntil || u.suspendedUntil.getTime() > now) return u;
  const at = new Date(now);
  return db.transaction(async (tx) => {
    const [cleared] = await tx
      .update(users)
      .set({ suspendedAt: null, suspendedUntil: null, suspensionReason: null, updatedAt: at })
      // Only the suspension that lapsed: one placed meanwhile stands.
      .where(and(eq(users.id, u.id), lte(users.suspendedUntil, at)))
      .returning();
    if (!cleared) return u;
    await liftHostsOf(tx, u.id, at);
    await tx.insert(auditLog).values({ actorId: u.id, action: "people.lapse", targetUser: u.id, at });
    return cleared;
  });
}
