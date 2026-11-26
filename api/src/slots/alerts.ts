import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { hosts, slotAlerts, stations, venues } from "../db/schema.ts";
import type { Notify } from "../http.ts";
import { bookable, claimsFrom, type HoldInput, stationRule, toClaim } from "./hold.ts";
import { type Claim, fits, HOUR } from "./rules.ts";

// "Hear if it frees up" (Play 18; owner, 26 Nov 2026): a player asks about a slot that's full for them right now, and
// hears once when it fits again, however it freed (a hold lapsed or let go, a desk release, a block lifted, a cancel).
// No hook on each of those: the sweep below just reads the counting rule again every minute.

// ponytail: a guess, against one account filling the table; per user, waiting ones only.
export const MAX_OPEN_ALERTS = 5;

export type Alert = typeof slotAlerts.$inferSelect;
export type AlertResult = { ok: true; alert: Alert; made: boolean } | { ok: false; error: "notFound" | "hostClosed" | "badTime" | "badCount" | "tooMany" | "tooOften" | "notFull" };

export async function askAlert(db: Db, i: HoldInput, now: number): Promise<AlertResult> {
  const at = new Date(now);
  const [host] = await db.select().from(hosts).where(eq(hosts.id, i.hostId));
  if (!host || host.kind !== "venue") return { ok: false, error: "notFound" };
  const [venue] = await db.select().from(venues).where(eq(venues.hostId, i.hostId));
  const [s] = await db.select().from(stations).where(and(eq(stations.id, i.stationId), eq(stations.hostId, i.hostId)));
  if (!venue || !s || s.archivedAt) return { ok: false, error: "notFound" };
  if (host.status !== "live") return { ok: false, error: "hostClosed" };
  if (!Number.isInteger(i.count) || i.count < 1) return { ok: false, error: "badCount" };
  if (i.count > s.count) return { ok: false, error: "tooMany" };
  if (!bookable(venue.week, s.step, i.start, i.hours, now)) return { ok: false, error: "badTime" };
  const start = new Date(i.start);
  const end = i.start + i.hours * HOUR;
  // Full for them: their own live holds don't count, as a new hold of theirs would lapse them.
  const claims = (await claimsFrom(db, s.id, start, at)).filter((r) => !(r.kind === "booking" && r.status === "held" && r.userId === i.userId));
  if (fits(claims.map(toClaim), stationRule(s), i.start, end, i.count, now)) return { ok: false, error: "notFull" };
  const mine = and(eq(slotAlerts.userId, i.userId), eq(slotAlerts.stationId, s.id), eq(slotAlerts.startsAt, start), isNull(slotAlerts.sentAt));
  const [had] = await db.select().from(slotAlerts).where(mine);
  if (had) return { ok: true, alert: had, made: false };
  // ponytail: two asks at once can both pass the cap by one; harmless at 5.
  const [open] = await db.select({ n: count() }).from(slotAlerts).where(and(eq(slotAlerts.userId, i.userId), isNull(slotAlerts.sentAt), gt(slotAlerts.startsAt, at)));
  if (open!.n >= MAX_OPEN_ALERTS) return { ok: false, error: "tooOften" };
  const [made] = await db
    .insert(slotAlerts)
    .values({ userId: i.userId, stationId: s.id, startsAt: start, endsAt: new Date(end), count: i.count, createdAt: at })
    .onConflictDoNothing()
    .returning();
  return made ? { ok: true, alert: made, made: true } : { ok: true, alert: (await db.select().from(slotAlerts).where(mine))[0]!, made: false };
}

/**
 * Every waiting alert (not sent, start ahead) whose slot fits again is marked sent and pushed, once. Run every minute
 * (server.ts). ponytail: one box; on more than one, each runs it and the conditional update (sent_at still null) makes
 * only one of them send.
 */
export async function sweepSlotAlerts(db: Db, notify: Notify, now: number) {
  const at = new Date(now);
  const open = await db
    .select({ a: slotAlerts, s: stations, hostName: hosts.name, hostStatus: hosts.status })
    .from(slotAlerts)
    .innerJoin(stations, eq(stations.id, slotAlerts.stationId))
    .innerJoin(hosts, eq(hosts.id, stations.hostId))
    .where(and(isNull(slotAlerts.sentAt), gt(slotAlerts.startsAt, at)));
  const byStation = new Map<string, Claim[]>();
  for (const { a, s, hostName, hostStatus } of open) {
    if (s.archivedAt || hostStatus !== "live") continue;
    let claims = byStation.get(s.id);
    if (!claims) byStation.set(s.id, (claims = (await claimsFrom(db, s.id, at, at)).map(toClaim)));
    if (!fits(claims, stationRule(s), a.startsAt.getTime(), a.endsAt.getTime(), a.count, now)) continue;
    await db.transaction(async (tx) => {
      const [sent] = await tx.update(slotAlerts).set({ sentAt: at }).where(and(eq(slotAlerts.id, a.id), isNull(slotAlerts.sentAt))).returning({ id: slotAlerts.id });
      if (!sent) return;
      // venueId: the app's slot screen opens by it (a venue's id is its host's).
      const data = { alertId: a.id, hostId: s.hostId, venueId: s.hostId, hostName, station: s.name, start: a.startsAt.toISOString() };
      await notify({ to: { userId: a.userId }, kind: "slotFreedAgain", data, key: a.id }, tx);
    });
  }
}
