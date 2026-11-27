import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { type Broadcast, BroadcastSegment, type Broadcasts, CancelBroadcast, NewBroadcast } from "@orbit/contract";
import { z } from "zod";
import type { Deps } from "./auth/routes.ts";
import type { Db } from "./db/index.ts";
import { auditLog, bookings, broadcasts, deliveries, events, follows, hosts, users } from "./db/schema.ts";
import { fail, invalid, isUuid, type Notify, parse, signedIn } from "./http.ts";
import { holdersOf, requireFeature, type StaffEnv, tell } from "./roles/access.ts";

// Broadcasts (notifications build plan PR 9): Platform writes one to a segment, a second Platform holder confirms it,
// and the minute tick sends it in batches with a saved cursor. With no other Platform holder, the author confirms their
// own. auto_at is history: the 24-hour self-send it drove is gone (owner, 27 Nov 2026). Every write is in the audit
// log. A cancel also drops the deliveries still queued or held; the worker drops any written after.

const DAY = 86_400_000;
const MIN = 60_000;
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
  if ("all" in s) return live;
  throw new Error("unknown segment");
};
export const audienceCount = async (db: Db, s: BroadcastSegment) => (await db.select({ n: count() }).from(users).where(audience(db, s)))[0]!.n;

// A host or event the segment names that doesn't exist: the form's mistake, not an empty audience.
const missing = async (db: Db, s: BroadcastSegment) =>
  ("hostId" in s && !(await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, s.hostId))).length) ||
  ("eventId" in s && !(await db.select({ id: events.id }).from(events).where(eq(events.id, s.eventId))).length);

// The Platform holders who could confirm: everyone but the author who isn't suspended, deleted or closing their account.
// Here only: holdersOf itself still counts them, as every staff email goes to them.
const othersOf = async (db: Db, authorId: string, at: Date) => {
  const ids = (await holdersOf(db, "platform", at)).filter((h) => h !== authorId);
  if (!ids.length) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, ids),
        isNull(users.deletedAt),
        isNull(users.deletionRequestedAt),
        or(isNull(users.suspendedAt), and(isNotNull(users.suspendedUntil), lte(users.suspendedUntil, at))),
      ),
    );
  return rows.map((r) => r.id);
};

const confirmer = alias(users, "confirmer");
type Row = { b: typeof broadcasts.$inferSelect; author: string | null; confirmer: string | null };
// `alone`: the viewer is the only Platform holder, so may confirm their own.
const view = ({ b, author, confirmer: by }: Row, viewer: string, alone: boolean): Broadcast => ({
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
  autoAt: b.autoAt?.toISOString() ?? null,
  // auto_at stays on one that went by itself; a cancel while waiting clears it.
  autoSent: !b.confirmedBy && !!b.autoAt && b.status !== "waiting",
  canConfirm: b.status === "waiting" && (b.createdBy !== viewer || alone),
});
const aloneOf = async (db: Db, viewer: string, now: () => number) => !(await othersOf(db, viewer, new Date(now()))).length;
const withNames = (db: Db) =>
  db
    .select({ b: broadcasts, author: users.name, confirmer: confirmer.name })
    .from(broadcasts)
    .innerJoin(users, eq(users.id, broadcasts.createdBy))
    .leftJoin(confirmer, eq(confirmer.id, broadcasts.confirmedBy));

export function broadcastsRoutes({ db, secret, notify, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const platform = requireFeature(db, now, "platform");
  const base = "/galaxy/notifications/broadcasts";

  // GET …/broadcasts: the latest 100, newest first, with who wrote and who confirmed each.
  app.get(base, auth, platform, async (c) => {
    const rows = await withNames(db).orderBy(desc(broadcasts.createdAt)).limit(100);
    const viewer = c.var.actor.id;
    const alone = await aloneOf(db, viewer, now);
    const body: Broadcasts = { items: rows.map((r) => view(r, viewer, alone)) };
    return c.json(body);
  });

  // GET …/broadcasts/:id: one, however old.
  app.get(`${base}/:id`, auth, platform, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const [row] = await withNames(db).where(eq(broadcasts.id, id));
    return row ? c.json(view(row, c.var.actor.id, await aloneOf(db, c.var.actor.id, now))) : nothing(c);
  });

  // POST …/broadcasts/count {segment}: the audience the form shows before Save.
  app.post(`${base}/count`, auth, platform, async (c) => {
    const b = await parse(c, z.object({ segment: BroadcastSegment }));
    if (!b) return invalid(c);
    if (await missing(db, b.segment)) return fail(c, 400, "noSuchTarget", "There's no host or event with that id.");
    return c.json({ audienceCount: await audienceCount(db, b.segment) });
  });

  // POST …/broadcasts: written as waiting, with its audience counted now; the other Platform holders are emailed. With
  // none, the author confirms it themselves. A send time may be up to 5 minutes past (a slow form) and 90 days ahead.
  app.post(base, auth, platform, async (c) => {
    const b = await parse(c, NewBroadcast);
    if (!b) return invalid(c);
    const at = new Date(now());
    const sendAt = b.sendAt ? new Date(b.sendAt) : null;
    if (sendAt && (sendAt.getTime() < at.getTime() - 5 * MIN || sendAt.getTime() > at.getTime() + 90 * DAY))
      return fail(c, 400, "badSendAt", "Pick a send time from now to 90 days ahead.");
    if (await missing(db, b.segment)) return fail(c, 400, "noSuchTarget", "There's no host or event with that id.");
    const actor = c.var.actor.id;
    const n = await audienceCount(db, b.segment);
    const others = await othersOf(db, actor, at);
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
          sendAt,
          audienceCount: n,
          createdAt: at,
        })
        .returning();
      await tx.insert(auditLog).values({ actorId: actor, action: "notifications.broadcast", data: { id: made!.id, type: b.type, segment: b.segment, audience: n }, at });
      return made!;
    });
    await tell(notify, others, "broadcastWaiting", { title: b.title, audienceCount: n }, row.id);
    return c.json(view({ b: row, author: c.var.user.name ?? null, confirmer: null }, actor, !others.length), 201);
  });

  // POST …/broadcasts/:id/confirm: the second person; the author only while no other Platform holder could. Moves to
  // scheduled when its send time is still ahead, else to sending.
  app.post(`${base}/:id/confirm`, auth, platform, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const actor = c.var.actor.id;
    const [b] = await db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!b) return nothing(c);
    const at = new Date(now());
    if (b.createdBy === actor && (await othersOf(db, actor, at)).length)
      return fail(c, 403, "ownBroadcast", "Someone else with Platform has to confirm your broadcast.");
    const status = b.sendAt && b.sendAt > at ? "scheduled" : "sending";
    const done = await db.transaction(async (tx) => {
      const [moved] = await tx
        .update(broadcasts)
        .set({ status, confirmedBy: actor, autoAt: null })
        .where(and(eq(broadcasts.id, id), eq(broadcasts.status, "waiting")))
        .returning();
      const own = b.createdBy === actor ? { own: true } : {};
      if (moved) await tx.insert(auditLog).values({ actorId: actor, action: "notifications.broadcastConfirm", data: { id, status, ...own }, at });
      return moved;
    });
    if (!done) return fail(c, 409, "notWaiting", `This broadcast is ${b.status}, so there's nothing to confirm.`);
    return c.json({ id, status });
  });

  // POST …/broadcasts/:id/cancel {reason}: stops one waiting, scheduled or part sent, and drops its deliveries still
  // queued or held. The tick checks before each batch; the worker drops any row written after this.
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
        .set({ status: "cancelled", reason: body.reason, autoAt: sql`case when ${broadcasts.status} = 'waiting' then null else ${broadcasts.autoAt} end` })
        .where(and(eq(broadcasts.id, id), inArray(broadcasts.status, ["waiting", "scheduled", "sending"])))
        .returning({ id: broadcasts.id });
      if (!moved) return false;
      await tx
        .update(deliveries)
        .set({ status: "dropped", reason: "cancelled", lockedUntil: null })
        .where(and(eq(deliveries.broadcastId, id), inArray(deliveries.status, ["queued", "held"])));
      await tx.insert(auditLog).values({ actorId: actor, action: "notifications.broadcastCancel", reason: body.reason, data: { id }, at });
      return true;
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

// Someone who may now confirm (a Platform grant started, or a holder's suspension lifted) hears of every broadcast still
// waiting that someone else wrote, or one written while its author was alone would wait unseen. Nothing if they don't
// hold Platform; the notice key is the broadcast, so a second call tells no one twice.
export async function tellWaiting(db: Db, notify: Notify, userId: string, at: Date) {
  if (!(await holdersOf(db, "platform", at)).includes(userId)) return;
  const rows = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.status, "waiting"), ne(broadcasts.createdBy, userId)));
  for (const b of rows) await tell(notify, [userId], "broadcastWaiting", { title: b.content.title, audienceCount: b.audienceCount }, b.id);
}

// The minute tick's broadcast step.
// 1. Scheduled ones that are due start sending. Waiting ones wait for a confirm.
// 2. Each sending one goes in batches of people by id after its cursor. Status is read again before each batch, so a
//    cancel stops the rest; each person's notice is keyed by the broadcast, so a batch redone after a restart sends
//    nothing twice. Cursor and counts are saved after each batch. It is sent once the cursor is done and none of its
//    deliveries is still queued, held or sending, so a cancel can stop those too.
// ponytail: one box, one tick at a time (server.ts); two boxes would both send a batch (dedupe keeps it once each, the
// counts would double). An advisory lock per broadcast when the API runs on more than one box.
export async function runBroadcasts({ db, notify, now, batch = BATCH }: { db: Db; notify: Notify; now: () => number; batch?: number }) {
  const at = new Date(now());
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
        const [left] = await db
          .select({ id: deliveries.id })
          .from(deliveries)
          .where(and(eq(deliveries.broadcastId, id), inArray(deliveries.status, ["queued", "held", "sending"])))
          .limit(1);
        if (!left) await db.update(broadcasts).set({ status: "sent" }).where(and(eq(broadcasts.id, id), eq(broadcasts.status, "sending")));
        break;
      }
      const kind = b.type === "news" ? "orbitNews" : "orbitNotice";
      const data = { ...b.content, broadcastId: id };
      let sent = 0;
      let failed = 0;
      let code = "";
      // ponytail: a person whose write failed isn't tried again (the cursor moves past them); `failed` counts them.
      for (const p of people) {
        try {
          await db.transaction((tx) => notify({ to: { userId: p.id }, kind, data, key: `broadcast:${id}`, broadcastId: id, channels: b.channels }, tx));
          sent++;
        } catch (e) {
          const err = e as { code?: string; cause?: { code?: string } };
          code = err.cause?.code ?? err.code ?? "error";
          failed++;
        }
      }
      if (failed) console.error(`[broadcasts] ${id}: ${failed} of ${people.length} in this batch not written (last: ${code})`);
      await db
        .update(broadcasts)
        .set({ cursor: people.at(-1)!.id, sent: sql`${broadcasts.sent} + ${sent}`, failed: sql`${broadcasts.failed} + ${failed}` })
        .where(eq(broadcasts.id, id));
    }
  }
}
