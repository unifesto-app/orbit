import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import {
  ROOM_ASKS_PER_DAY,
  ROOM_OPEN_DAYS,
  RoomAskBody,
  type RoomAsk,
  RoomCard,
  type RoomMember,
  RoomStaffReason,
  type RoomState,
  type RoomView,
  type StaffRoom,
  type StaffRoomRow,
} from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import type { User } from "./auth/sessions.ts";
import { auditLog, bookings, events, hosts, roomAsks, roomMembers, userBlocks, users } from "./db/schema.ts";
import { fail, invalid, isUuid, parse, signedIn, type Tx } from "./http.ts";
import { holdersOf, onHost, requireFeature, type StaffEnv } from "./roles/access.ts";

// inRoom (mock-leftovers plan, Feature 3; contract/src/rooms.ts). A room is a published meetup with inRoom on, on a live
// host. A guest is let in once their confirmed booking has someone checked in; they join by putting up a card. Until
// they're in, they see nobody and nothing about the room, counts included. Who's let in is read on every request, so
// an undone check-in or a cancelled booking ends access at once. Members are known by their room_members id only: no
// user id, phone or email ever leaves here, except the reach two connected members swap.
// Staff with Queues remove cards and bar people from every room, never on a host they're on (onHost).

const DAY = 24 * 3600_000;
const LIST_MAX = 200;
const OPEN_MS = ROOM_OPEN_DAYS * DAY;
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const ownHost = (c: Context) =>
  fail(c, 403, "ownHost", "Staff never act on a host they're on, invited to or left in the last 30 days. Ask another staff member with this access.");

const REFUSED: Record<Exclude<RoomState, "door" | "in">, string> = {
  out: "The room opens once you're checked in.",
  closed: "This room has closed.",
  removed: "Orbit removed your card from this room.",
  barred: "You can't join rooms on Orbit.",
};

type Room = { id: string; slug: string; title: string; startsAt: Date; endsAt: Date; hostId: string };
type Member = typeof roomMembers.$inferSelect;
type Ask = typeof roomAsks.$inferSelect;

// Someone let in to the event: a confirmed booking of theirs with someone checked in.
const letIn = (userId: unknown, eventId: string) =>
  sql`exists (select 1 from bookings b where b.user_id = ${userId} and b.event_id = ${eventId} and b.status = 'confirmed' and b.admitted > 0)`;

const askOf = (a: Ask | undefined, me: string): RoomAsk =>
  !a ? "none" : a.status === "accepted" ? "connected" : a.fromMember === me ? "asked" : a.status === "pending" ? "incoming" : "declined";

export function roomsRoutes({ db, store, secret, notify, media, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const queues = requireFeature(db, now, "queues");
  const at = () => new Date(now());

  const roomOf = async (id: string): Promise<Room | null> => {
    if (!isUuid(id)) return null;
    const [r] = await db
      .select({ id: events.id, slug: events.slug, title: events.title, startsAt: events.startsAt, endsAt: events.endsAt, hostId: events.hostId })
      .from(events)
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .where(and(eq(events.id, id), eq(events.category, "meetups"), eq(events.inRoom, true), eq(events.status, "published"), eq(hosts.status, "live")));
    return r?.startsAt && r.endsAt ? (r as Room) : null;
  };

  // Where the viewer stands, and their card. Removed outranks barred outranks closed; then whether they're let in now.
  const standing = async (room: Room, u: User): Promise<{ state: RoomState; mine: Member | null }> => {
    const [mine = null] = await db.select().from(roomMembers).where(and(eq(roomMembers.eventId, room.id), eq(roomMembers.userId, u.id)));
    if (mine?.removedAt) return { state: "removed", mine };
    if (u.inRoomBarredAt) return { state: "barred", mine };
    if (now() >= room.endsAt.getTime() + OPEN_MS) return { state: "closed", mine };
    const [b] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.userId, u.id), eq(bookings.eventId, room.id), eq(bookings.status, "confirmed"), gt(bookings.admitted, 0)))
      .limit(1);
    if (!b) return { state: "out", mine };
    return { state: mine && !mine.leftAt ? "in" : "door", mine };
  };

  // The members `me` can see: in the room, let in now, not suspended, deleted or barred, no block either way. Once the
  // room has closed (`closed`): only those `me` connected with, still not deleted or blocked, with no live checks, since
  // the event is long over (owner default 3: contacts stay readable, no purge).
  const visible = (room: Room, me: Member, only?: string, closed = false) =>
    db
      .select({
        m: roomMembers,
        name: users.name,
        photo: users.photo,
        host: sql<boolean>`exists (select 1 from team_roles t where t.host_id = ${room.hostId} and t.user_id = ${roomMembers.userId} and t.started_at is not null and t.ended_at is null)`,
      })
      .from(roomMembers)
      .innerJoin(users, eq(users.id, roomMembers.userId))
      .where(
        and(
          eq(roomMembers.eventId, room.id),
          only ? eq(roomMembers.id, only) : undefined,
          ne(roomMembers.userId, me.userId),
          isNull(users.deletedAt),
          ...(closed
            ? [
                sql`exists (select 1 from room_asks q where q.status = 'accepted'
                              and ((q.from_member = ${me.id} and q.to_member = ${roomMembers.id}) or (q.from_member = ${roomMembers.id} and q.to_member = ${me.id})))`,
              ]
            : [
                isNull(roomMembers.leftAt),
                isNull(roomMembers.removedAt),
                isNull(users.inRoomBarredAt),
                sql`not (${users.suspendedAt} is not null and (${users.suspendedUntil} is null or ${users.suspendedUntil} > ${at().toISOString()}::timestamptz))`,
                letIn(roomMembers.userId, room.id),
              ]),
          sql`not exists (select 1 from user_blocks k where (k.blocker_id = ${me.userId} and k.blocked_id = ${roomMembers.userId})
                                                     or (k.blocker_id = ${roomMembers.userId} and k.blocked_id = ${me.userId}))`,
        ),
      )
      .orderBy(roomMembers.joinedAt, roomMembers.id);
  type Seen = Awaited<ReturnType<typeof visible>>[number];

  // The pair's ask, if any: one per pair, whoever asked.
  const pairAsk = async (a: string, b: string) =>
    (await db.select().from(roomAsks).where(or(and(eq(roomAsks.fromMember, a), eq(roomAsks.toMember, b)), and(eq(roomAsks.fromMember, b), eq(roomAsks.toMember, a)))))[0];

  // The photo goes through /media/rooms/:memberId: the stored link names the account.
  const toMember = (s: Seen, a: Ask | undefined, me: string): RoomMember => {
    const ask = askOf(a, me);
    return {
      id: s.m.id,
      name: s.name ?? "Orbit guest",
      photo: s.photo && media ? `${media.url}/rooms/${s.m.id}` : null,
      line: s.m.line,
      host: s.host,
      ask,
      ...(a ? { askId: a.id } : {}),
      ...(ask === "connected" ? { reach: s.m.reach } : {}),
    };
  };

  const viewOf = async (room: Room, u: User): Promise<RoomView> => {
    const { state, mine } = await standing(room, u);
    let members: RoomMember[] = [];
    // In: everyone visible. Closed: a past member (not removed) keeps the people they connected with, and their reach.
    if ((state === "in" || state === "closed") && mine) {
      const asks = await db.select().from(roomAsks).where(and(eq(roomAsks.eventId, room.id), or(eq(roomAsks.fromMember, mine.id), eq(roomAsks.toMember, mine.id))));
      const byOther = new Map(asks.map((a) => [a.fromMember === mine.id ? a.toMember : a.fromMember, a]));
      members = (await visible(room, mine, undefined, state === "closed")).map((s) => toMember(s, byOther.get(s.m.id), mine.id));
    }
    return {
      event: { id: room.id, slug: room.slug, title: room.title, startsAt: room.startsAt.toISOString(), endsAt: room.endsAt.toISOString() },
      state,
      closesAt: new Date(room.endsAt.getTime() + OPEN_MS).toISOString(),
      me: mine && !mine.removedAt ? { id: mine.id, line: mine.line, reach: mine.reach } : null,
      members,
    };
  };

  // The room and the viewer, in it; or the response that says why not. Hidden rooms and members are all the same 404.
  const inside = async (c: Context<StaffEnv>) => {
    const room = await roomOf(c.req.param("eventId") ?? "");
    if (!room) return nothing(c);
    const { state, mine } = await standing(room, c.var.user);
    if (state !== "in") return fail(c, 403, state, state === "door" ? "Join the room first." : REFUSED[state]);
    return { room, mine: mine! }; // "in" has a card
  };

  // GET /me/rooms/:eventId
  app.get("/me/rooms/:eventId", auth, async (c) => {
    const room = await roomOf(c.req.param("eventId"));
    return room ? c.json(await viewOf(room, c.var.user)) : nothing(c);
  });

  // PUT /me/rooms/:eventId/card {line, reach}: join, come back after leaving, or change the card.
  app.put("/me/rooms/:eventId/card", auth, async (c) => {
    const b = await parse(c, RoomCard);
    if (!b) return invalid(c);
    const room = await roomOf(c.req.param("eventId"));
    if (!room) return nothing(c);
    const { state } = await standing(room, c.var.user);
    if (state !== "door" && state !== "in") return fail(c, 403, state, REFUSED[state]);
    const [made] = await db
      .insert(roomMembers)
      .values({ eventId: room.id, userId: c.var.user.id, line: b.line, reach: b.reach, joinedAt: at() })
      .onConflictDoUpdate({ target: [roomMembers.eventId, roomMembers.userId], set: { line: b.line, reach: b.reach, leftAt: null }, setWhere: isNull(roomMembers.removedAt) })
      .returning({ id: roomMembers.id });
    if (!made) return fail(c, 403, "removed", REFUSED.removed); // removed meanwhile
    return c.json(await viewOf(room, c.var.user));
  });

  // DELETE /me/rooms/:eventId: leave. Asks waiting on either side go; connections stay.
  app.delete("/me/rooms/:eventId", auth, async (c) => {
    const room = await roomOf(c.req.param("eventId"));
    if (!room) return nothing(c);
    await db.transaction(async (tx) => {
      const [left] = await tx
        .update(roomMembers)
        .set({ leftAt: at() })
        .where(and(eq(roomMembers.eventId, room.id), eq(roomMembers.userId, c.var.user.id), isNull(roomMembers.leftAt), isNull(roomMembers.removedAt)))
        .returning({ id: roomMembers.id });
      if (left) await tx.delete(roomAsks).where(and(eq(roomAsks.status, "pending"), or(eq(roomAsks.fromMember, left.id), eq(roomAsks.toMember, left.id))));
    });
    return c.body(null, 204);
  });

  // POST /me/rooms/:eventId/asks {memberId}: ask to connect. Asking again, or asking someone who asked first, answers
  // with the pair's one ask; a declined one stays "asked" and nobody is told again.
  app.post("/me/rooms/:eventId/asks", auth, async (c) => {
    const b = await parse(c, RoomAskBody);
    if (!b) return invalid(c);
    const r = await inside(c);
    if (r instanceof Response) return r;
    const { room, mine } = r;
    const [them] = await visible(room, mine, b.memberId);
    if (!them) return nothing(c);
    const have = await pairAsk(mine.id, them.m.id);
    if (have) return c.json(toMember(them, have, mine.id));
    if ((await store.incr(`roomAsk:${mine.userId}`, DAY)) > ROOM_ASKS_PER_DAY) return fail(c, 429, "tooMany", "You've asked a lot of people today. Try again tomorrow.");
    const [made] = await db
      .insert(roomAsks)
      .values({ eventId: room.id, fromMember: mine.id, toMember: them.m.id, createdAt: at(), updatedAt: at() })
      .onConflictDoNothing()
      .returning();
    if (!made) return c.json(toMember(them, await pairAsk(mine.id, them.m.id), mine.id)); // asked at the same moment
    await notify({ to: { userId: them.m.userId }, kind: "inRoomAsk", data: { eventId: room.id, title: room.title }, key: made.id });
    return c.json(toMember(them, made, mine.id), 201);
  });

  // POST /me/rooms/:eventId/asks/:askId/accept | decline: the one asked, while it waits. Accepting swaps the reach and
  // tells the asker; declining tells nobody.
  for (const action of ["accept", "decline"] as const)
    app.post(`/me/rooms/:eventId/asks/:askId/${action}`, auth, async (c) => {
      const r = await inside(c);
      if (r instanceof Response) return r;
      const { room, mine } = r;
      const askId = c.req.param("askId");
      const [a] = isUuid(askId) ? await db.select().from(roomAsks).where(and(eq(roomAsks.id, askId), eq(roomAsks.eventId, room.id), eq(roomAsks.toMember, mine.id))) : [];
      const [them] = a ? await visible(room, mine, a.fromMember) : [];
      if (!a || !them) return nothing(c);
      const [done] = await db
        .update(roomAsks)
        .set({ status: action === "accept" ? "accepted" : "declined", updatedAt: at() })
        .where(and(eq(roomAsks.id, a.id), eq(roomAsks.status, "pending")))
        .returning();
      if (!done) return fail(c, 409, "answered", "You've already answered that.");
      if (action === "accept") await notify({ to: { userId: them.m.userId }, kind: "inRoomConnected", data: { eventId: room.id, title: room.title }, key: done.id });
      return c.json(toMember(them, done, mine.id));
    });

  // POST /me/rooms/:eventId/members/:memberId/block: hidden from each other in every room, for good (Support can lift
  // it), and every ask between the two goes.
  app.post("/me/rooms/:eventId/members/:memberId/block", auth, async (c) => {
    const r = await inside(c);
    if (r instanceof Response) return r;
    const memberId = c.req.param("memberId");
    const [them] = isUuid(memberId) ? await visible(r.room, r.mine, memberId) : [];
    if (!them) return nothing(c);
    const me = r.mine.userId, other = them.m.userId;
    await db.transaction(async (tx) => {
      await tx.insert(userBlocks).values({ blockerId: me, blockedId: other, createdAt: at() }).onConflictDoNothing();
      await dropAsksBetween(tx, me, other);
    });
    return c.body(null, 204);
  });

  // GET /media/rooms/:memberId: a member's photo, while their card is up. The link holds the member id, not the account.
  // ponytail: anyone with the link sees the photo, as with every /media link; no check of who's asking.
  app.get("/media/rooms/:memberId", async (c) => {
    const id = c.req.param("memberId");
    const [r] =
      media && isUuid(id)
        ? await db
            .select({ photo: users.photo })
            .from(roomMembers)
            .innerJoin(users, eq(users.id, roomMembers.userId))
            .where(and(eq(roomMembers.id, id), isNull(roomMembers.leftAt), isNull(roomMembers.removedAt), isNull(users.deletedAt)))
        : [];
    const key = media && r?.photo?.startsWith(`${media.url}/`) ? r.photo.slice(media.url.length + 1) : null;
    const file = key ? await media!.files.get(key) : null;
    if (!file) return nothing(c);
    return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, { "content-type": file.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
  });

  // ---------- Galaxy: Queues ----------

  const staffRows = () =>
    db
      .select({
        eventId: events.id,
        slug: events.slug,
        title: events.title,
        hostId: events.hostId,
        hostName: hosts.name,
        status: events.status,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        members: sql<number>`(select count(*)::int from room_members m where m.event_id = ${events.id} and m.left_at is null and m.removed_at is null)`,
        removed: sql<number>`(select count(*)::int from room_members m where m.event_id = ${events.id} and m.removed_at is not null)`,
      })
      .from(events)
      .innerJoin(hosts, eq(hosts.id, events.hostId));
  type Row = Awaited<ReturnType<typeof staffRows>>[number];
  const toRow = ({ hostId: _, endsAt, startsAt, ...r }: Row): StaffRoomRow => ({
    ...r,
    startsAt: startsAt?.toISOString() ?? null,
    closesAt: endsAt ? new Date(endsAt.getTime() + OPEN_MS).toISOString() : null,
  });
  const meetup = and(eq(events.category, "meetups"), eq(events.inRoom, true));
  const staffRoom = async (id: string) => (isUuid(id) ? (await staffRows().where(and(eq(events.id, id), meetup)))[0] : undefined);

  // GET /galaxy/rooms: newest first, 200 at most, leaving out hosts the viewer is on.
  app.get("/galaxy/rooms", auth, queues, async (c) => {
    const rows = await staffRows().where(and(meetup, ne(events.status, "draft"))).orderBy(desc(events.startsAt), desc(events.id)).limit(LIST_MAX);
    const mine = new Map<string, boolean>();
    for (const h of new Set(rows.map((r) => r.hostId))) mine.set(h, await onHost(db, h, c.var.user, now()));
    return c.json({ rooms: rows.filter((r) => !mine.get(r.hostId)).map(toRow) });
  });

  // GET /galaxy/rooms/:eventId: every card ever put up, with the account behind it. Logged.
  app.get("/galaxy/rooms/:eventId", auth, queues, async (c) => {
    const room = await staffRoom(c.req.param("eventId"));
    if (!room || (await onHost(db, room.hostId, c.var.user, now()))) return nothing(c);
    const remover = alias(users, "remover");
    const rows = await db
      .select({ m: roomMembers, name: users.name, barred: users.inRoomBarredAt, removedBy: remover.name, letIn: sql<boolean>`${letIn(roomMembers.userId, room.eventId)}` })
      .from(roomMembers)
      .innerJoin(users, eq(users.id, roomMembers.userId))
      .leftJoin(remover, eq(remover.id, roomMembers.removedBy))
      .where(eq(roomMembers.eventId, room.eventId))
      .orderBy(roomMembers.joinedAt, roomMembers.id);
    await db.insert(auditLog).values({ actorId: c.var.actor.id, action: "rooms.view", targetHost: room.hostId, data: { eventId: room.eventId }, at: at() });
    const out: StaffRoom = {
      room: toRow(room),
      members: rows.map((r) => ({
        id: r.m.id,
        userId: r.m.userId,
        name: r.name,
        line: r.m.line,
        reach: r.m.reach,
        joinedAt: r.m.joinedAt.toISOString(),
        leftAt: r.m.leftAt?.toISOString() ?? null,
        removedAt: r.m.removedAt?.toISOString() ?? null,
        removedBy: r.m.removedAt ? (r.removedBy ?? "Staff") : null,
        barred: !!r.barred,
        letIn: r.letIn,
      })),
    };
    return c.json(out);
  });

  // Each staff change is logged with its reason, and every holder of Queues is told, with the change.
  const told = async (tx: Tx, action: string, hostId: string | null, reason: string, actor: string, holders: string[]) => {
    for (const userId of holders) await notify({ to: { userId }, kind: "staffRiskyAction", data: { action, hostId, reason, by: actor } }, tx);
  };

  // The card in the path, with its room, for a staff change.
  const cardFor = async (c: Context<StaffEnv>) => {
    const room = await staffRoom(c.req.param("eventId") ?? "");
    const memberId = c.req.param("memberId") ?? "";
    const [m] = room && isUuid(memberId) ? await db.select().from(roomMembers).where(and(eq(roomMembers.id, memberId), eq(roomMembers.eventId, room.eventId))) : [];
    if (!room || !m) return nothing(c);
    if (await onHost(db, room.hostId, c.var.user, now())) return ownHost(c);
    return { room, m };
  };

  // POST /galaxy/rooms/:eventId/members/:memberId/remove {reason}: the card comes down for good; they're told why.
  app.post("/galaxy/rooms/:eventId/members/:memberId/remove", auth, queues, async (c) => {
    const b = await parse(c, RoomStaffReason);
    if (!b) return invalid(c);
    const r = await cardFor(c);
    if (r instanceof Response) return r;
    const { room, m } = r;
    const actor = c.var.actor.id;
    const holders = await holdersOf(db, "queues", at());
    const done = await db.transaction(async (tx) => {
      const [gone] = await tx.update(roomMembers).set({ removedAt: at(), removedBy: actor }).where(and(eq(roomMembers.id, m.id), isNull(roomMembers.removedAt))).returning();
      if (!gone) return false;
      await tx.insert(auditLog).values({ actorId: actor, action: "rooms.remove", targetUser: m.userId, targetHost: room.hostId, reason: b.reason, data: { eventId: room.eventId, memberId: m.id }, at: at() });
      await told(tx, "rooms.remove", room.hostId, b.reason, actor, holders);
      await notify({ to: { userId: m.userId }, kind: "inRoomCardRemoved", data: { eventId: room.eventId, title: room.title, reason: b.reason } }, tx);
      return true;
    });
    return done ? c.json({ id: m.id }) : fail(c, 409, "removed", "That card has already been removed.");
  });

  // POST /galaxy/rooms/:eventId/members/:memberId/bar {reason}: the card's owner is barred from every room.
  app.post("/galaxy/rooms/:eventId/members/:memberId/bar", auth, queues, async (c) => {
    const b = await parse(c, RoomStaffReason);
    if (!b) return invalid(c);
    const r = await cardFor(c);
    if (r instanceof Response) return r;
    const { room, m } = r;
    const actor = c.var.actor.id;
    const holders = await holdersOf(db, "queues", at());
    const done = await db.transaction(async (tx) => {
      const [barred] = await tx
        .update(users)
        .set({ inRoomBarredAt: at(), inRoomBarredBy: actor })
        .where(and(eq(users.id, m.userId), isNull(users.inRoomBarredAt), isNull(users.deletedAt)))
        .returning({ id: users.id });
      if (!barred) return false;
      await tx.insert(auditLog).values({ actorId: actor, action: "rooms.bar", targetUser: m.userId, targetHost: room.hostId, reason: b.reason, data: { eventId: room.eventId, memberId: m.id }, at: at() });
      await told(tx, "rooms.bar", room.hostId, b.reason, actor, holders);
      await notify({ to: { userId: m.userId }, kind: "inRoomBarred", data: { reason: b.reason } }, tx);
      return true;
    });
    return done ? c.json({ id: m.userId }) : fail(c, 409, "barred", "They're already barred from rooms.");
  });

  // POST /galaxy/rooms/unbar/:userId {reason}: from their People page. A bar isn't tied to one host, so the only refusal
  // is lifting one's own.
  app.post("/galaxy/rooms/unbar/:userId", auth, queues, async (c) => {
    const b = await parse(c, RoomStaffReason);
    if (!b) return invalid(c);
    const id = c.req.param("userId");
    const [u] = isUuid(id) ? await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))) : [];
    if (!u) return nothing(c);
    const actor = c.var.actor.id;
    if (u.id === actor) return fail(c, 403, "self", "Ask another staff member to lift your own bar.");
    const holders = await holdersOf(db, "queues", at());
    const done = await db.transaction(async (tx) => {
      const [lifted] = await tx.update(users).set({ inRoomBarredAt: null, inRoomBarredBy: null }).where(and(eq(users.id, u.id), isNotNull(users.inRoomBarredAt))).returning({ id: users.id });
      if (!lifted) return false;
      await tx.insert(auditLog).values({ actorId: actor, action: "rooms.unbar", targetUser: u.id, reason: b.reason, at: at() });
      await told(tx, "rooms.unbar", null, b.reason, actor, holders);
      return true;
    });
    return done ? c.json({ id: u.id }) : fail(c, 409, "notBarred", "They aren't barred from rooms.");
  });

  return app;
}

// Every ask between two people, in every room.
export const dropAsksBetween = (tx: Tx, a: string, b: string) => {
  const of = (u: string) => tx.select({ id: roomMembers.id }).from(roomMembers).where(eq(roomMembers.userId, u));
  return tx
    .delete(roomAsks)
    .where(or(and(inArray(roomAsks.fromMember, of(a)), inArray(roomAsks.toMember, of(b))), and(inArray(roomAsks.fromMember, of(b)), inArray(roomAsks.toMember, of(a)))));
};
