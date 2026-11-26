import { and, count, eq, gt, inArray, ne, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { hosts, stationClaims, stations, users, venues } from "../db/schema.ts";
import { type Claim, fits, hours, HOUR, MIN } from "./rules.ts";

// A player's hold on a slot while they pay (Play, "Backend shape"). It counts for 10 minutes and then lapses by itself:
// no job, the counting rule just stops reading it.
// POST /venues/:hostId/holds (routes.ts) makes one. ponytail: nothing pays a hold yet; that waits on the booking/checkout
// slice, so for now every hold simply lapses.
export const HOLD_MINUTES = 10;
// ponytail: a guess. Without it one account could hold a station to closing and renew it every 10 minutes for good.
export const HOLDS_PER_HOUR = 3;
const IST = 330 * MIN;
const DAY = 24 * HOUR;
const SLOT_DAYS = 14; // today's opening, or one of the next 13

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
    // On the station's grid, ahead of now, inside one opening of the next 14 days.
    const open = hours(venue.week, i.start);
    const first = hours(venue.week, now).day;
    const good =
      Number.isInteger(i.hours) && i.hours >= 1 &&
      (i.start + IST) % (s.step * MIN) === 0 && i.start >= now && open.day >= first && open.day <= first + (SLOT_DAYS - 1) * DAY && i.start >= open.opens && end <= open.closes;
    if (!good) return { ok: false, error: "badTime" };
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
