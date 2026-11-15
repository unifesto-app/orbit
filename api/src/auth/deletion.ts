import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.ts";
import { hosts, sessions, staffGrants, teamRoles, users } from "../db/schema.ts";
import { type Env, fail, type Notify, signedIn } from "../http.ts";
import { holdIfUnanswered } from "../roles/access.ts";
import { fresh, heldUntil } from "./security.ts";
import type { User } from "./sessions.ts";
import type { Store } from "./store.ts";

// Account deletion (Orbit flows: User, "Account deletion"): asked in the app or on the web, it signs out every device
// at once and runs 30 days later unless the person signs back in and keeps the account.

const DAY = 24 * 3600 * 1000;
export const GRACE_DAYS = 30;

export type Blocker = { kind: "ownsHost"; hostId: string; name: string } | { kind: "onlyStaffHolder" };

// What stops a deletion, checked at the request and again on day 30.
// ponytail: a payout still owed and tickets for events that haven't ended block it too, once bookings and money exist.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function blockersOf(db: Db | Tx, u: User, now: number): Promise<Blocker[]> {
  const owned = await db
    .select({ id: hosts.id, name: hosts.name })
    .from(hosts)
    .where(and(eq(hosts.ownerId, u.id), ne(hosts.status, "archived")));
  const out: Blocker[] = owned.map((h) => ({ kind: "ownsHost", hostId: h.id, name: h.name }));
  if (u.platformOwner) {
    // The platform owner stays while nobody else holds Staff (Roles doc).
    const others = await db
      .select({ id: staffGrants.id })
      .from(staffGrants)
      .where(and(eq(staffGrants.feature, "staff"), ne(staffGrants.userId, u.id), isNull(staffGrants.endedAt), isNotNull(staffGrants.startsAt), lte(staffGrants.startsAt, new Date(now))))
      .limit(1);
    if (!others.length) out.push({ kind: "onlyStaffHolder" });
  }
  return out;
}

// What the one screen lists (User flow): what goes, what is scrubbed, what stays.
const WHAT = {
  deleted: ["Sign-in methods", "Sessions", "Roles on hosts and staff access", "Photo"],
  scrubbed: ["Name", "Phone", "Email", "Date of birth", "Gender"],
  kept: ["Bookings, payments, refunds and payouts, with your details scrubbed, kept 8 years as books of account"],
};

type Deps = { db: Db; store: Store; notify: Notify; secret: string; now?: () => number };

export function deletionRoutes({ db, store, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());

  // GET /me/deletion: the one screen, with anything blocking it.
  app.get("/me/deletion", auth, async (c) =>
    c.json({ ...WHAT, blockers: await blockersOf(db, c.var.user, now()), dueAt: c.var.user.deletionDueAt?.toISOString() ?? null }),
  );

  // POST /me/deletion: a fresh code, then Delete. Every session ends, this one too.
  app.post("/me/deletion", auth, async (c) => {
    const u = c.var.user;
    const [s] = await db.select().from(sessions).where(eq(sessions.id, c.var.sid));
    if (!fresh(s!, now())) return fail(c, 403, "needsFresh", "For your security, confirm it's you with a code first.");
    // The 7-day hold after "Is this you?" covers deleting the account too: it would take the email with it.
    const held = u.email ? heldUntil(u, s!, now()) : null;
    if (held) {
      // The email hears someone tried, at most once an hour, as for a held email change.
      if ((await store.incr(`heldNotice:${u.id}`, 3600 * 1000)) === 1)
        await notify({ to: { contact: u.email! }, kind: "signInMethodChangeHeld", data: { method: "account", change: "delete", until: held.toISOString() } });
      return fail(c, 403, "held", "You signed in with your number on a new phone. To delete your account this week, confirm with a code to your email.", { until: held.toISOString() });
    }
    if (u.deletionDueAt) return fail(c, 409, "pending", "Your account is already set to be deleted.");
    const blockers = await blockersOf(db, u, now());
    if (blockers.length) return fail(c, 409, "blocked", "Some things need sorting out before your account can be deleted.", { blockers });
    const due = new Date(now() + GRACE_DAYS * DAY);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ deletionRequestedAt: at(), deletionDueAt: due, updatedAt: at() }).where(eq(users.id, u.id));
      await tx.update(sessions).set({ endedAt: at() }).where(and(eq(sessions.userId, u.id), isNull(sessions.endedAt)));
    });
    await notify({ to: { userId: u.id }, kind: "deletionScheduled", data: { dueAt: due.toISOString() } });
    return c.json({ dueAt: due.toISOString() });
  });

  // POST /me/deletion/keep: Keep my account, from signing in within the 30 days.
  app.post("/me/deletion/keep", auth, async (c) => {
    const [kept] = await db
      .update(users)
      .set({ deletionRequestedAt: null, deletionDueAt: null, updatedAt: at() })
      .where(and(eq(users.id, c.var.user.id), isNotNull(users.deletionDueAt)))
      .returning();
    if (!kept) return fail(c, 409, "notPending", "Your account isn't set to be deleted.");
    await notify({ to: { userId: kept.id }, kind: "deletionCancelled", data: {} });
    return c.json({ kept: true });
  });

  return app;
}

// Day 30: every account whose time has come. Safe to run often, and alongside itself: each account is claimed in its
// own step, so one that was kept meanwhile, or taken by another run, is left alone.
// A blocker found now (say, a host started after the request) cancels the request with one notice; the person asks
// again once it's sorted. One account failing never stops the rest.
// ponytail: the server runs this hourly until the job runner arrives to run it nightly at 03:30 IST. Apple tokens and
// Cognito users are removed here once Google and Apple sign-in exist.
export async function runDeletions(db: Db, notify: Notify, now: number) {
  const at = new Date(now);
  const due = await db.select({ id: users.id }).from(users).where(and(lte(users.deletionDueAt, at), isNull(users.deletedAt)));
  let done = 0;
  for (const { id } of due) {
    try {
      const outcome = await db.transaction(async (tx) => {
        // Claim the row: still due, not kept, not deleted by another run.
        const [u] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, id), lte(users.deletionDueAt, at), isNull(users.deletedAt)))
          .for("update");
        if (!u) return null;
        const blockers = await blockersOf(tx, u, now);
        if (blockers.length) {
          await tx.update(users).set({ deletionRequestedAt: null, deletionDueAt: null, updatedAt: at }).where(eq(users.id, u.id));
          return { blocked: blockers };
        }
        await tx.delete(sessions).where(eq(sessions.userId, u.id));
        const seats = await tx
          .update(teamRoles)
          .set({ endedAt: at, endReason: "deleted" })
          .where(and(eq(teamRoles.userId, u.id), isNull(teamRoles.endedAt)))
          .returning({ hostId: teamRoles.hostId });
        for (const { hostId } of seats) await holdIfUnanswered(tx, hostId, at);
        // Their places and invites keep no contact. Invites still open to them end too: an open row can't share
        // "deleted" with another, and nobody is left to accept it.
        const contacts = [u.phone, u.email].filter((x): x is string => !!x);
        await tx
          .update(teamRoles)
          .set({ contact: "deleted", endedAt: sql`coalesce(${teamRoles.endedAt}, ${at.toISOString()}::timestamptz)`, endReason: sql`coalesce(${teamRoles.endReason}, 'deleted')` })
          .where(contacts.length ? or(eq(teamRoles.userId, u.id), inArray(teamRoles.contact, contacts)) : eq(teamRoles.userId, u.id));
        // Their staff access ends, and so do the adds they made that are still waiting.
        await tx.update(staffGrants).set({ endedAt: at }).where(and(eq(staffGrants.userId, u.id), isNull(staffGrants.endedAt)));
        await tx
          .update(staffGrants)
          .set({ endedAt: at })
          .where(and(eq(staffGrants.addedBy, u.id), isNull(staffGrants.endedAt), or(isNull(staffGrants.startsAt), gt(staffGrants.startsAt, at))));
        await tx
          .update(users)
          .set({
            name: null,
            phone: null,
            phoneVerifiedAt: null,
            email: null,
            emailVerifiedAt: null,
            dob: null,
            gender: null,
            photo: null,
            suspensionReason: null,
            newDevicePhoneAt: null,
            platformOwner: false,
            deletionDueAt: null,
            deletedAt: at,
            updatedAt: at,
          })
          .where(eq(users.id, u.id));
        return { deleted: true, lastWord: u.email ?? u.phone }; // the last message goes to the contact read before the scrub
      });
      if (!outcome) continue;
      if ("blocked" in outcome) {
        await notify({ to: { userId: id }, kind: "deletionBlocked", data: { blockers: outcome.blocked } });
        continue;
      }
      if (outcome.lastWord) await notify({ to: { contact: outcome.lastWord }, kind: "accountDeleted", data: {} });
      done++;
    } catch (e) {
      console.error(`[deletions] ${id}`, e);
    }
  }
  return done;
}
