import { and, count, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { type Broadcast, BroadcastSegment, type Broadcasts, CancelBroadcast, NewBroadcast } from "@orbit/contract";
import { z } from "zod";
import type { Deps } from "./auth/routes.ts";
import type { Db } from "./db/index.ts";
import { auditLog, bookings, broadcasts, events, follows, hosts, users } from "./db/schema.ts";
import { fail, invalid, isUuid, type Notify, parse, signedIn } from "./http.ts";
import { holdersOf, requireFeature, type StaffEnv, tell } from "./roles/access.ts";

// Broadcasts (notifications build plan PR 9): Platform writes one to a segment, a second Platform holder confirms it,
// and the minute tick sends it in batches with a saved cursor. With no other Platform holder, the author's own broadcast
// moves on by itself 24 hours after it was written, and can be cancelled until then. Every write is in the audit log.

const DAY = 86_400_000;
const BATCH = 500;
const nothing = (c: Parameters<typeof fail>[0]) => fail(c, 404, "notFound", "There's nothing here.");

// Who a segment reaches: accounts not deleted; for an event, its live ticket holders (as announcements.ts counts them).
// Suspended accounts and those waiting for deletion are counted; notify's own rules decide what they get.
const audience = (db: Db, s: BroadcastSegment) => {
  const live = isNull(users.deletedAt);
  if ("city" in s) return and(live, eq(users.city, s.city));
  if ("hostId" in s) return and(live, inArray(users.id, db.select({ id: follows.userId }).from(follows).where(eq(follows.hostId, s.hostId))));
  if ("eventId" in s)
    return and(live, inArray(users.id, db.select({ id: bookings.userId }).from(bookings).where(and(eq(bookings.eventId, s.eventId), eq(bookings.status, "confirmed")))));
  return live;
};
export const audienceCount = async (db: Db, s: BroadcastSegment) => (await db.select({ n: count() }).from(users).where(audience(db, s)))[0]!.n;

// A host or event the segment names that doesn't exist: the form's mistake, not an empty audience.
const missing = async (db: Db, s: BroadcastSegment) =>
  ("hostId" in s && !(await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, s.hostId))).length) ||
  ("eventId" in s && !(await db.select({ id: events.id }).from(events).where(eq(events.id, s.eventId))).length);

const confirmer = alias(users, "confirmer");
type Row = { b: typeof broadcasts.$inferSelect; author: string | null; confirmer: string | null };
const view = ({ b, author, confirmer: by }: Row, alone: boolean): Broadcast => ({
  id: b.id,
  type: b.type,
  segment: b.segment,
  channels: b.channels,
  title: b.content.title,
  text: b.content.text,
  status: b.status,
  author: { id: b.createdBy, name: author },
  confirmer: b.confirmedBy ? { id: b.confirmedBy, name: by } : null,
  sendAt: b.sendAt?.toISOString() ?? null,
  audienceCount: b.audienceCount,
  sent: b.sent,
  failed: b.failed,
  reason: b.reason,
  createdAt: b.createdAt.toISOString(),
  autoAt: alone && b.status === "waiting" ? new Date(b.createdAt.getTime() + DAY).toISOString() : null,
});
// No Platform holder but the author: the one-holder rule applies.
const aloneIn = (holders: string[], authorId: string) => holders.every((h) => h === authorId);

export function broadcastsRoutes({ db, secret, notify, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const platform = requireFeature(db, now, "platform");
  const base = "/galaxy/notifications/broadcasts";

  // GET …/broadcasts: the latest 100, newest first, with who wrote and who confirmed each.
  app.get(base, auth, platform, async (c) => {
    const rows = await db
      .select({ b: broadcasts, author: users.name, confirmer: confirmer.name })
      .from(broadcasts)
      .innerJoin(users, eq(users.id, broadcasts.createdBy))
      .leftJoin(confirmer, eq(confirmer.id, broadcasts.confirmedBy))
      .orderBy(desc(broadcasts.createdAt))
      .limit(100);
    const holders = await holdersOf(db, "platform", new Date(now()));
    const body: Broadcasts = { items: rows.map((r) => view(r, aloneIn(holders, r.b.createdBy))) };
    return c.json(body);
  });

  // POST …/broadcasts/count {segment}: the audience the form shows before Save.
  app.post(`${base}/count`, auth, platform, async (c) => {
    const b = await parse(c, z.object({ segment: BroadcastSegment }));
    if (!b) return invalid(c);
    if (await missing(db, b.segment)) return fail(c, 400, "noSuchTarget", "There's no host or event with that id.");
    return c.json({ audienceCount: await audienceCount(db, b.segment) });
  });

  // POST …/broadcasts: written as waiting, with its audience counted now; the other Platform holders are emailed.
  app.post(base, auth, platform, async (c) => {
    const b = await parse(c, NewBroadcast);
    if (!b) return invalid(c);
    if (await missing(db, b.segment)) return fail(c, 400, "noSuchTarget", "There's no host or event with that id.");
    const actor = c.var.actor.id;
    const at = new Date(now());
    const n = await audienceCount(db, b.segment);
    const row = await db.transaction(async (tx) => {
      const [made] = await tx
        .insert(broadcasts)
        .values({
          type: b.type,
          segment: b.segment,
          channels: b.channels,
          content: { title: b.title, text: b.text },
          status: "waiting",
          createdBy: actor,
          sendAt: b.sendAt ? new Date(b.sendAt) : null,
          audienceCount: n,
          createdAt: at,
        })
        .returning();
      await tx.insert(auditLog).values({ actorId: actor, action: "notifications.broadcast", data: { id: made!.id, type: b.type, segment: b.segment, audience: n }, at });
      return made!;
    });
    const others = (await holdersOf(db, "platform", at)).filter((h) => h !== actor);
    await tell(notify, others, "broadcastWaiting", { title: b.title, audienceCount: n }, row.id);
    return c.json(view({ b: row, author: c.var.user.name ?? null, confirmer: null }, !others.length), 201);
  });

  // POST …/broadcasts/:id/confirm: the second person. Never the author (the one-holder rule needs no confirm). Moves to
  // scheduled when its send time is still ahead, else to sending.
  app.post(`${base}/:id/confirm`, auth, platform, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const actor = c.var.actor.id;
    const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!b) return nothing(c);
    if (b.createdBy === actor) return fail(c, 403, "ownBroadcast", "Someone else with Platform has to confirm your broadcast.");
    const at = new Date(now());
    const status = b.sendAt && b.sendAt > at ? "scheduled" : "sending";
    const done = await db.transaction(async (tx) => {
      const [moved] = await tx
        .update(broadcasts)
        .set({ status, confirmedBy: actor })
        .where(and(eq(broadcasts.id, id), eq(broadcasts.status, "waiting")))
        .returning();
      if (moved) await tx.insert(auditLog).values({ actorId: actor, action: "notifications.broadcastConfirm", data: { id, status }, at });
      return moved;
    });
    if (!done) return fail(c, 409, "notWaiting", `This broadcast is ${b.status}, so there's nothing to confirm.`);
    return c.json({ id, status });
  });

  // POST …/broadcasts/:id/cancel {reason}: stops one waiting, scheduled or part sent; the tick checks before each batch.
  app.post(`${base}/:id/cancel`, auth, platform, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const body = await parse(c, CancelBroadcast);
    if (!body) return invalid(c);
    const actor = c.var.actor.id;
    const at = new Date(now());
    const done = await db.transaction(async (tx) => {
      const [moved] = await tx
        .update(broadcasts)
        .set({ status: "cancelled", reason: body.reason })
        .where(and(eq(broadcasts.id, id), inArray(broadcasts.status, ["waiting", "scheduled", "sending"])))
        .returning({ id: broadcasts.id });
      if (moved) await tx.insert(auditLog).values({ actorId: actor, action: "notifications.broadcastCancel", reason: body.reason, data: { id }, at });
      return moved;
    });
    if (!done) {
      const [b] = await db.select({ status: broadcasts.status }).from(broadcasts).where(eq(broadcasts.id, id));
      return b ? fail(c, 409, "notCancellable", `This broadcast is ${b.status}, so it can't be cancelled.`) : nothing(c);
    }
    await tell(notify, await holdersOf(db, "platform", at), "staffRiskyAction", { action: "broadcast cancelled", reason: body.reason, by: actor });
    return c.json({ id, status: "cancelled" });
  });

  return app;
}

// The minute tick's broadcast step: the one-holder rule's 24 hours, scheduled ones that are due, then each sending
// broadcast in batches of people by id after its cursor. Status is read again before each batch, so a cancel stops the
// rest; each person's notice is keyed by the broadcast, so a batch redone after a restart sends nothing twice. Cursor
// and counts are saved after each batch. `sent` counts people notify took, `failed` those whose write threw.
// ponytail: one box, one tick at a time (server.ts); two boxes would both send a batch (dedupe keeps it once each, the
// counts would double). An advisory lock per broadcast when the API runs on more than one box.
export async function runBroadcasts({ db, notify, now, batch = BATCH }: { db: Db; notify: Notify; now: () => number; batch?: number }) {
  const at = new Date(now());
  const due = await db.select().from(broadcasts).where(and(eq(broadcasts.status, "waiting"), lte(broadcasts.createdAt, new Date(at.getTime() - DAY))));
  const holders = due.length ? await holdersOf(db, "platform", at) : [];
  for (const b of due.filter((b) => aloneIn(holders, b.createdBy)))
    await db
      .update(broadcasts)
      .set({ status: b.sendAt && b.sendAt > at ? "scheduled" : "sending" })
      .where(and(eq(broadcasts.id, b.id), eq(broadcasts.status, "waiting")));
  await db.update(broadcasts).set({ status: "sending" }).where(and(eq(broadcasts.status, "scheduled"), lte(broadcasts.sendAt, at)));

  for (const { id } of await db.select({ id: broadcasts.id }).from(broadcasts).where(eq(broadcasts.status, "sending"))) {
    for (;;) {
      const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
      if (b?.status !== "sending") break;
      const people = await db
        .select({ id: users.id })
        .from(users)
        .where(and(audience(db, b.segment), b.cursor ? gt(users.id, b.cursor) : undefined))
        .orderBy(users.id)
        .limit(batch);
      if (!people.length) {
        await db.update(broadcasts).set({ status: "sent" }).where(and(eq(broadcasts.id, id), eq(broadcasts.status, "sending")));
        break;
      }
      const kind = b.type === "news" ? "orbitNews" : "orbitNotice";
      const data = { ...b.content, broadcastId: id };
      let sent = 0;
      let failed = 0;
      for (const p of people) {
        try {
          await db.transaction((tx) => notify({ to: { userId: p.id }, kind, data, key: `broadcast:${id}`, broadcastId: id, channels: b.channels }, tx));
          sent++;
        } catch (e) {
          const err = e as { code?: string; cause?: { code?: string } };
          console.error(`[broadcasts] ${id} not written for one person (${err.cause?.code ?? err.code ?? "error"})`);
          failed++;
        }
      }
      await db
        .update(broadcasts)
        .set({ cursor: people.at(-1)!.id, sent: sql`${broadcasts.sent} + ${sent}`, failed: sql`${broadcasts.failed} + ${failed}` })
        .where(eq(broadcasts.id, id));
    }
  }
}
