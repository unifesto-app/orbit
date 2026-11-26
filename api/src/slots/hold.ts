import { and, count, eq, gt, inArray, ne, or } from "drizzle-orm";
import { code, token } from "../bookings.ts";
import type { Db } from "../db/index.ts";
import type { Tx } from "../http.ts";
import { hosts, stationClaims, stations, users, venues } from "../db/schema.ts";
import { bookable, type Claim, fits, hours, HOUR, MIN } from "./rules.ts";
export { bookable, SLOT_DAYS } from "./rules.ts";

// A player's hold on a slot while they pay (Play, "Backend shape"). It counts for 10 minutes and then lapses by itself:
// no job, the counting rule just stops reading it.
// POST /venues/:hostId/holds (routes.ts) makes one; confirmHold below makes it a booking: the free-slot route now, and
// X2's payment webhook once Razorpay lands.
export const HOLD_MINUTES = 10;
// ponytail: a guess. Without it one account could hold a station to closing and renew it every 10 minutes for good.
export const HOLDS_PER_HOUR = 3;
// The rules' view of a stored claim. Here, not in routes.ts, so routes can import hold without a cycle.
export const toClaim = (r: Held): Claim => ({
  id: r.id, stationId: r.stationId, kind: r.kind, status: r.status, count: r.count, start: r.startsAt.getTime(), end: r.endsAt.getTime(),
  holdEnd: r.holdEndsAt?.getTime() ?? null, admitted: r.admitted, checkedIn: r.checkedInAt?.getTime() ?? null, checkedInBy: r.checkedInBy,
  released: r.releasedAt?.getTime() ?? null,
});

export type HoldInput = { hostId: string; stationId: string; userId: string; start: number; hours: number; count: number };
export type Held = typeof stationClaims.$inferSelect;
export type HoldResult =
  | { ok: true; claim: Held }
  | { ok: false; error: "signedOut" | "notFound" | "hostClosed" | "badTime" | "badCount" | "tooMany" | "tooOften" | "full" };

export async function hold(db: Db, i: HoldInput, now: number): Promise<HoldResult> {
  const at = new Date(now);
  const end = i.start + i.hours * HOUR;
  return db.transaction(async (tx): Promise<HoldResult> => {
    // The person first, as suspending or deleting them locks them before their hosts: so two holds of theirs at once
    // take turns and the second lapses the first (one live hold per venue). Then the counter's order: host, venue, station.
    // A deleted or suspended account holds nothing (as saves' mine() refuses a deleted one).
    const [u] = await tx
      .select({ deletedAt: users.deletedAt, suspendedAt: users.suspendedAt, suspendedUntil: users.suspendedUntil })
      .from(users)
      .where(eq(users.id, i.userId))
      .for("no key update");
    if (!u || u.deletedAt || (u.suspendedAt && (!u.suspendedUntil || u.suspendedUntil > at))) return { ok: false, error: "signedOut" };
    const [host] = await tx.select().from(hosts).where(eq(hosts.id, i.hostId)).for("share");
    if (!host || host.kind !== "venue") return { ok: false, error: "notFound" };
    const [venue] = await tx.select().from(venues).where(eq(venues.hostId, i.hostId)).for("share");
    const [s] = await tx.select().from(stations).where(and(eq(stations.id, i.stationId), eq(stations.hostId, i.hostId))).for("update");
    if (!venue || !s || s.archivedAt) return { ok: false, error: "notFound" };
    if (host.status !== "live") return { ok: false, error: "hostClosed" };
    // Under the person's lock, so two at once can't both slip under the cap. Every hold counts, lapsed or paid.
    const [recent] = await tx
      .select({ n: count() })
      .from(stationClaims)
      .innerJoin(stations, eq(stations.id, stationClaims.stationId))
      .where(and(eq(stations.hostId, i.hostId), eq(stationClaims.userId, i.userId), eq(stationClaims.kind, "booking"), gt(stationClaims.createdAt, new Date(now - HOUR))));
    if (recent!.n >= HOLDS_PER_HOUR) return { ok: false, error: "tooOften" };
    if (!Number.isInteger(i.count) || i.count < 1) return { ok: false, error: "badCount" };
    if (i.count > s.count) return { ok: false, error: "tooMany" };
    if (!bookable(venue.week, s.step, i.start, i.hours, now)) return { ok: false, error: "badTime" };
    // Their other live hold at this venue lapses (one at a time), so it's no obstacle to the new one.
    const mine = await tx
      .select({ id: stationClaims.id })
      .from(stationClaims)
      .innerJoin(stations, eq(stations.id, stationClaims.stationId))
      .where(and(eq(stations.hostId, i.hostId), eq(stationClaims.userId, i.userId), eq(stationClaims.status, "held"), gt(stationClaims.holdEndsAt, at)));
    const lapsing = new Set(mine.map((m) => m.id));
    // Lapsed holds left out in SQL (as /day reads): they'd only be loaded to be dropped.
    const rows = await tx
      .select()
      .from(stationClaims)
      .where(and(eq(stationClaims.stationId, s.id), gt(stationClaims.endsAt, new Date(i.start)), or(ne(stationClaims.status, "held"), gt(stationClaims.holdEndsAt, at))));
    const claims = rows.filter((r) => !lapsing.has(r.id)).map(toClaim);
    if (!fits(claims, { id: s.id, step: s.step as 30 | 60, count: s.count }, i.start, end, i.count, now)) return { ok: false, error: "full" };
    if (lapsing.size) await tx.update(stationClaims).set({ holdEndsAt: at, updatedAt: at }).where(inArray(stationClaims.id, [...lapsing]));
    const [claim] = await tx
      .insert(stationClaims)
      .values({
        stationId: s.id, kind: "booking", status: "held", count: i.count, startsAt: new Date(i.start), endsAt: new Date(end),
        holdEndsAt: new Date(now + HOLD_MINUTES * MIN), userId: i.userId, createdBy: i.userId, createdAt: at, updatedAt: at,
      })
      .returning();
    return { ok: true, claim: claim! };
  });
}

// A station's claims that can still matter from `from` on, lapsed holds left out in SQL (as /day reads).
export const claimsFrom = (q: Db | Tx, stationId: string, from: Date, at: Date) =>
  q
    .select()
    .from(stationClaims)
    .where(and(eq(stationClaims.stationId, stationId), gt(stationClaims.endsAt, from), or(ne(stationClaims.status, "held"), gt(stationClaims.holdEndsAt, at))));
export const stationRule = (s: typeof stations.$inferSelect) => ({ id: s.id, step: s.step as 30 | 60, count: s.count });

// A claim's world, locked in hold()'s order: its person (no key update), the host and venue (share), the station (for
// update), then the claim (for update). The claim's person and station never change, so reading them first is safe.
// Locking twice in one transaction is a no-op, so a caller may lock, check, then call confirmHold.
// `only`: a player's route; someone else's claim, or one at another host, is null before any lock is taken.
// Null too when the claim is gone by the time it's locked.
export async function lockHold(tx: Tx, claimId: string, only?: { userId: string; hostId: string }) {
  const [peek] = await tx
    .select({ userId: stationClaims.userId, hostId: stations.hostId, stationId: stationClaims.stationId })
    .from(stationClaims)
    .innerJoin(stations, eq(stations.id, stationClaims.stationId))
    .where(eq(stationClaims.id, claimId));
  if (!peek || (only && (peek.userId !== only.userId || peek.hostId !== only.hostId))) return null;
  if (peek.userId) await tx.select({ id: users.id }).from(users).where(eq(users.id, peek.userId)).for("no key update");
  const [host] = await tx.select().from(hosts).where(eq(hosts.id, peek.hostId)).for("share");
  const [venue] = await tx.select().from(venues).where(eq(venues.hostId, peek.hostId)).for("share");
  const [station] = await tx.select().from(stations).where(eq(stations.id, peek.stationId)).for("update");
  const [claim] = await tx.select().from(stationClaims).where(eq(stationClaims.id, claimId)).for("update");
  if (!host || !venue || !station || !claim) return null;
  return { host, venue, station, claim };
}

export type ConfirmResult = { ok: true; claim: Held } | { ok: false; error: "notFound" | "notHeld" | "full" };

/**
 * A held booking becomes paid, with its ticket (qr and code, as an event booking's). Takes its own locks (lockHold), so
 * it runs inside the caller's transaction:
 * - POST /venues/:hostId/holds/:claimId/confirm calls it for a free slot (no money);
 * - X2 (Razorpay) calls this same function from its payment webhook, after verifying the order.
 * The rule, checked under the station's lock whatever `now` the caller read before locking:
 * - the venue is live and the station not archived;
 * - the slot still fits its window and count, with the claim itself left out of the counted claims (so a stale `now`
 *   that still calls the hold live can't double book);
 * - a lapsed hold (still "held", hold_ends_at <= now: money landed late, or a free confirm after the 10 minutes) also
 *   only before its start and inside the venue's hours as they are now.
 * Otherwise { ok: false, error: "full" } and nothing changes: X2 then refunds. A hold let go (released_at) still
 * confirms here, as money landed for it; released_at is cleared so the ticket reads as booked.
 * - any other status is "notHeld" (already paid: the caller answers a retry as it likes).
 * ponytail: a QR or code that meets another's fails the unique check and the caller's transaction (30^8 codes; bookings
 * retry, this doesn't yet).
 */
export async function confirmHold(tx: Tx, claimId: string, now: number): Promise<ConfirmResult> {
  const k = await lockHold(tx, claimId);
  if (!k) return { ok: false, error: "notFound" };
  const { claim: c, station: s, host, venue } = k;
  if (c.kind !== "booking" || c.status !== "held") return { ok: false, error: "notHeld" };
  const at = new Date(now);
  if (s.archivedAt || host.status !== "live") return { ok: false, error: "full" };
  const start = c.startsAt.getTime();
  const end = c.endsAt.getTime();
  if (c.holdEndsAt! <= at) {
    const open = hours(venue.week, start);
    if (start < now || start < open.opens || end > open.closes) return { ok: false, error: "full" };
  }
  const rows = (await claimsFrom(tx, s.id, c.startsAt, at)).filter((r) => r.id !== c.id);
  if (!fits(rows.map(toClaim), stationRule(s), start, end, c.count, now)) return { ok: false, error: "full" };
  const [row] = await tx
    .update(stationClaims)
    .set({ status: "paid", holdEndsAt: null, releasedAt: null, releasedBy: null, qr: token(), code: code(), updatedAt: at })
    .where(eq(stationClaims.id, c.id))
    .returning();
  return { ok: true, claim: row! };
}
