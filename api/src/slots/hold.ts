import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { hosts, stationClaims, stations, users, venues } from "../db/schema.ts";
import { fits, hours, HOUR, MIN } from "./rules.ts";
import { toClaim } from "./routes.ts";

// A player's hold on a slot while they pay (Play, "Backend shape"). It counts for 10 minutes and then lapses by itself:
// no job, the counting rule just stops reading it.
// ponytail: no route yet. There's no checkout to pay a hold, so the booking slice wraps this; until then only tests call it.
export const HOLD_MINUTES = 10;
const IST = 330 * MIN;
const DAY = 24 * HOUR;
const SLOT_DAYS = 14; // today's opening, or one of the next 13

export type HoldInput = { hostId: string; stationId: string; userId: string; start: number; hours: number; count: number };
export type Held = typeof stationClaims.$inferSelect;
export type HoldResult =
  | { ok: true; claim: Held }
  | { ok: false; error: "notFound" | "hostClosed" | "badTime" | "badCount" | "tooMany" | "full" };

export async function hold(db: Db, i: HoldInput, now: number): Promise<HoldResult> {
  const at = new Date(now);
  const end = i.start + i.hours * HOUR;
  return db.transaction(async (tx): Promise<HoldResult> => {
    // The person first, as suspending or deleting them locks them before their hosts: so two holds of theirs at once
    // take turns and the second lapses the first (one live hold per venue). Then the counter's order: host, venue, station.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, i.userId)).for("no key update");
    const [host] = await tx.select().from(hosts).where(eq(hosts.id, i.hostId)).for("share");
    if (!host || host.kind !== "venue") return { ok: false, error: "notFound" };
    if (host.status !== "live") return { ok: false, error: "hostClosed" };
    const [venue] = await tx.select().from(venues).where(eq(venues.hostId, i.hostId)).for("share");
    const [s] = await tx.select().from(stations).where(and(eq(stations.id, i.stationId), eq(stations.hostId, i.hostId))).for("update");
    if (!venue || !s || s.archivedAt) return { ok: false, error: "notFound" };
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
    const rows = await tx.select().from(stationClaims).where(and(eq(stationClaims.stationId, s.id), gt(stationClaims.endsAt, new Date(i.start))));
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
