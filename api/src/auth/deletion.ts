import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.ts";
import { activity, askLog, bookings, deliveries, eventInterests, eventRequests, events, follows, hosts, identities, inboxItems, listEvents, lists, notificationPrefs, passkeys, payments, reports, roomMembers, saves, supportThreads, pmActivity, sessions, slotAlerts, stationClaims, staffGrants, teamRoles, userBlocks, users } from "../db/schema.ts";
import { refundPaid } from "../payments/routes.ts";
import { type Env, fail, type Notify, signedIn } from "../http.ts";
import { drop, type Media } from "../media.ts";
import { holdIfUnanswered, ownerOnlySql } from "../roles/access.ts";
import { fresh, heldUntil, otherAddress, waysIn } from "./security.ts";
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
    // An archived host has ended, also while staff suspend it, and doesn't hold its owner back.
    .where(and(eq(hosts.ownerId, u.id), sql`not ${ownerOnlySql}`));
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
  deleted: ["Sign-in methods and passkeys", "Sessions", "Roles on hosts and staff access", "Hosts you follow", "Photo", "Requests to host that weren't approved", "Messages to Orbit support and our replies", "Room cards, connections and blocks"],
  scrubbed: ["Name", "Phone", "Email", "Date of birth", "Gender", "City"],
  kept: ["Bookings, payments, refunds and payouts, with your details scrubbed, kept 8 years as books of account", "Reports you sent, without your notes"],
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
    if (!fresh(s!, now())) return fail(c, 403, "needsFresh", "For your security, confirm it's you first.");
    // The 7-day hold after "Is this you?" covers deleting the account too: it would take every other way in with it.
    const held = (await waysIn(db, u)) > (u.phone ? 1 : 0) ? heldUntil(u, s!, now()) : null;
    if (held) {
      // The other way in hears someone tried, at most once an hour, as for a held email change.
      const to = await otherAddress(db, u);
      if (to && (await store.incr(`heldNotice:${u.id}`, 3600 * 1000)) === 1)
        await notify({ to: { contact: to }, kind: "signInMethodChangeHeld", data: { method: "account", change: "delete", until: held.toISOString() } });
      return fail(c, 403, "held", "You signed in with your number on a new phone. To delete your account this week, confirm it's you with a way in you had before then.", {
        until: held.toISOString(),
      });
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
// Apple's tokens are revoked once the account is gone (Apple's rule for apps that offer deletion); a failed revoke is
// logged and never undoes the deletion. Their photo's file goes too (`media`, where the server has a bucket).
// ponytail: the server runs this hourly until the job runner arrives to run it nightly at 03:30 IST.
export async function runDeletions(db: Db, notify: Notify, now: number, revokeApple?: (token: string) => Promise<void>, media?: Media) {
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
        // Every way in goes; the row stays, so the cascade never fires.
        await tx.delete(passkeys).where(eq(passkeys.userId, u.id));
        const links = await tx.delete(identities).where(eq(identities.userId, u.id)).returning({ appleRefresh: identities.appleRefresh });
        await tx.delete(follows).where(eq(follows.userId, u.id)); // the row stays, so the cascade never fires
        await tx.delete(notificationPrefs).where(eq(notificationPrefs.userId, u.id));
        // Their saves and lists go too: private, nobody else could ever read them (Saved events and lists doc).
        await tx.delete(listEvents).where(eq(listEvents.userId, u.id));
        await tx.delete(lists).where(eq(lists.userId, u.id));
        await tx.delete(saves).where(eq(saves.userId, u.id));
        await tx.delete(eventInterests).where(eq(eventInterests.userId, u.id)); // I'm interested, as private as saves
        // Requests to host that never became one go, free text and all; approved ones stay, pointing at a real host.
        await tx.delete(eventRequests).where(and(eq(eventRequests.userId, u.id), ne(eventRequests.status, "approved")));
        await tx.update(eventRequests).set({ note: null }).where(eq(eventRequests.userId, u.id));
        // Reports they sent stay for staff, without their free text.
        await tx.update(reports).set({ note: null }).where(eq(reports.userId, u.id));
        await tx.delete(supportThreads).where(eq(supportThreads.userId, u.id)); // their support threads, messages and all
        await tx.delete(activity).where(eq(activity.userId, u.id)); // analytics rows go with the account (owner, 19 Nov 2026)
        await tx.delete(askLog).where(eq(askLog.userId, u.id)); // what they asked Ask Orbit
        // Their room cards go, and with them (cascade) every ask to or from them; their blocks go both ways.
        await tx.delete(roomMembers).where(eq(roomMembers.userId, u.id));
        await tx.delete(userBlocks).where(or(eq(userBlocks.blockerId, u.id), eq(userBlocks.blockedId, u.id)));
        // Their inbox goes; deliveries rows stay until the 180-day cleanup, as the log of what was sent (D6), but tied to
        // nobody and holding no data, and nothing still waiting sends. The accountDeleted email is queued after this.
        await tx.delete(inboxItems).where(eq(inboxItems.userId, u.id));
        await tx.update(deliveries).set({ status: "skipped", reason: "accountDeleted" }).where(and(eq(deliveries.userId, u.id), eq(deliveries.status, "queued")));
        await tx.update(deliveries).set({ userId: null, contact: null, payload: {}, target: sql`'deleted:' || ${deliveries.id}` }).where(eq(deliveries.userId, u.id));
        // Their tickets for events that haven't ended are cancelled, freeing the seats; past bookings stay as records. Paid
        // ones for events that haven't started go back in full, as a holder's own cancel would (one under way doesn't);
        // the poller sends those refunds (their first try is 15 minutes on).
        const gone = await tx
          .update(bookings)
          .set({ status: "cancelled", cancelledAt: at, link: null })
          .where(and(eq(bookings.userId, u.id), eq(bookings.status, "confirmed"), inArray(bookings.eventId, tx.select({ id: events.id }).from(events).where(gt(events.endsAt, at)))))
          .returning({ id: bookings.id, eventId: bookings.eventId });
        const ahead = gone.length
          ? new Set((await tx.select({ id: events.id }).from(events).where(and(inArray(events.id, gone.map((b) => b.eventId)), gt(events.startsAt, at)))).map((e) => e.id))
          : new Set<string>();
        const back = gone.filter((b) => ahead.has(b.eventId)).map((b) => b.id);
        if (back.length) await refundPaid(tx, inArray(payments.bookingId, back), "The account was deleted", at);
        // Slots the same way: their freed-slot alerts go, a hold still running lapses now, and upcoming slot bookings are
        // released (as a desk release, by nobody), freeing the stations.
        await tx.delete(slotAlerts).where(eq(slotAlerts.userId, u.id));
        await tx
          .update(stationClaims)
          .set({ holdEndsAt: at, updatedAt: at })
          .where(and(eq(stationClaims.userId, u.id), eq(stationClaims.status, "held"), gt(stationClaims.holdEndsAt, at)));
        const freed = await tx
          .update(stationClaims)
          .set({ status: "released", releasedAt: at, updatedAt: at })
          .where(and(eq(stationClaims.userId, u.id), eq(stationClaims.kind, "booking"), eq(stationClaims.status, "paid"), gt(stationClaims.startsAt, at)))
          .returning({ id: stationClaims.id });
        // A paid slot given up this way goes back whole, as an upcoming ticket does.
        if (freed.length) await refundPaid(tx, inArray(payments.claimId, freed.map((c) => c.id)), "The account was deleted", at);
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
        // Their name leaves the PM board's activity too; the rows stay, tied to the account by id. Rows a Claude Code
        // token wrote carry the token's name, not theirs.
        await tx
          .update(pmActivity)
          .set({ actor: "Galaxy: Deleted account" })
          .where(and(eq(pmActivity.userId, u.id), isNull(pmActivity.tokenId)));
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
            city: null,
            interests: null,
            suspensionReason: null,
            newDevicePhoneAt: null,
            platformOwner: false,
            deletionDueAt: null,
            deletedAt: at,
            updatedAt: at,
          })
          .where(eq(users.id, u.id));
        const apple = links.flatMap((l) => (l.appleRefresh ? [l.appleRefresh] : []));
        return { deleted: true, lastWord: u.email ?? u.phone, apple, photo: u.photo }; // the last message goes to the contact read before the scrub
      });
      if (!outcome) continue;
      if ("blocked" in outcome) {
        await notify({ to: { userId: id }, kind: "deletionBlocked", data: { blockers: outcome.blocked } });
        continue;
      }
      for (const token of outcome.apple) await revokeApple?.(token).catch((e) => console.error(`[deletions] ${id} apple revoke`, e));
      if (media) await drop(media, outcome.photo, "users", id);
      if (outcome.lastWord) await notify({ to: { contact: outcome.lastWord }, kind: "accountDeleted", data: {} });
      done++;
    } catch (e) {
      console.error(`[deletions] ${id}`, e);
    }
  }
  return done;
}
