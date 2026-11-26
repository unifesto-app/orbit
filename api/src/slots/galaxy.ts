import { and, asc, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { StaffReason, type StaffSlotHolds } from "@orbit/contract";
import type { Deps } from "../auth/routes.ts";
import { auditLog, hosts, slotAlerts, stationClaims, stations, users } from "../db/schema.ts";
import { fail, invalid, isUuid, parse, signedIn } from "../http.ts";
import { holdersOf, requireFeature, type StaffEnv, tell } from "../roles/access.ts";
import { lockHold } from "./hold.ts";

// Galaxy's Slot holds, for holders of Hosts (venues are hosts): the holds running now, with a release for a stuck one,
// and the freed-slot alerts of the last 7 days. A release is written to the audit log and emailed to Hosts holders, as
// every staff action on a host is.

const WEEK = 7 * 24 * 3600_000;
// ponytail: no paging; a week of alerts and the live holds fit one page until venues are many.
const MAX_ROWS = 300;

export function galaxySlotsRoutes({ db, secret, notify, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const staff = requireFeature(db, now, "hosts");

  app.get("/galaxy/slot-holds", auth, staff, async (c) => {
    const at = new Date(now());
    const holds = await db
      .select({ c: stationClaims, station: stations.name, hostId: hosts.id, venue: hosts.name, person: users.name })
      .from(stationClaims)
      .innerJoin(stations, eq(stations.id, stationClaims.stationId))
      .innerJoin(hosts, eq(hosts.id, stations.hostId))
      .leftJoin(users, eq(users.id, stationClaims.userId))
      .where(and(eq(stationClaims.kind, "booking"), eq(stationClaims.status, "held"), gt(stationClaims.holdEndsAt, at)))
      .orderBy(asc(stationClaims.holdEndsAt))
      .limit(MAX_ROWS);
    const alerts = await db
      .select({ a: slotAlerts, station: stations.name, venue: hosts.name, person: users.name })
      .from(slotAlerts)
      .innerJoin(stations, eq(stations.id, slotAlerts.stationId))
      .innerJoin(hosts, eq(hosts.id, stations.hostId))
      .innerJoin(users, eq(users.id, slotAlerts.userId))
      .where(gt(slotAlerts.createdAt, new Date(now() - WEEK)))
      .orderBy(desc(slotAlerts.createdAt), desc(slotAlerts.id))
      .limit(MAX_ROWS);
    const body: StaffSlotHolds = {
      holds: holds.map((h) => ({
        id: h.c.id, hostId: h.hostId, venue: h.venue, station: h.station, person: h.person, start: h.c.startsAt.toISOString(), count: h.c.count,
        holdEndsAt: h.c.holdEndsAt!.toISOString(), minutesLeft: Math.ceil((h.c.holdEndsAt!.getTime() - at.getTime()) / 60_000),
      })),
      alerts: alerts.map((r) => ({
        id: r.a.id, venue: r.venue, station: r.station, person: r.person, start: r.a.startsAt.toISOString(), count: r.a.count,
        createdAt: r.a.createdAt.toISOString(), sentAt: r.a.sentAt?.toISOString() ?? null,
        state: r.a.sentAt ? "sent" : r.a.startsAt > at ? "waiting" : "expired",
      })),
    };
    return c.json(body);
  });

  // POST /galaxy/slot-holds/:claimId/release: a live hold ends now, as if the player let go (released_at, so the free
  // confirm refuses it).
  app.post("/galaxy/slot-holds/:claimId/release", auth, staff, async (c) => {
    const claimId = c.req.param("claimId");
    if (!isUuid(claimId)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, StaffReason);
    if (!b) return invalid(c);
    const at = new Date(now());
    const actorId = c.var.actor.id;
    const done = await db.transaction(async (tx) => {
      const k = await lockHold(tx, claimId);
      if (!k || k.claim.kind !== "booking" || k.claim.status !== "held" || k.claim.holdEndsAt! <= at) return null;
      await tx.update(stationClaims).set({ holdEndsAt: at, releasedAt: at, releasedBy: actorId, updatedAt: at }).where(eq(stationClaims.id, claimId));
      await tx.insert(auditLog).values({ actorId, action: "slots.releaseHold", targetUser: k.claim.userId, targetHost: k.host.id, reason: b.reason, data: { claimId }, at });
      return k.host;
    });
    if (!done) return fail(c, 404, "notFound", "That hold has already ended.");
    await tell(notify, await holdersOf(db, "hosts", at), "staffRiskyAction", { action: "slots.releaseHold", hostId: done.id, reason: b.reason, by: actorId });
    return c.body(null, 204);
  });

  return app;
}
