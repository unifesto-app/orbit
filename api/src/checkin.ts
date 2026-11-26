import { and, asc, count, desc, eq, gt, gte, ilike, inArray, like, lte, ne, or, type SQL, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  type CheckedIn, type CheckInEvent, type CheckInEventPage, type CheckInEvents, CheckInTotal, CODE_LENGTH, type DoorGuest, type DoorGuests, Scan,
  type ScanRefusal, type ScanResult, StaffUndo,
} from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { auditLog, bookings, events, hosts, users } from "./db/schema.ts";
import { fail, invalid, isUuid, listPage, type Notify, parse, signedIn, type Tx } from "./http.ts";
import { changeable, holdersOf, onHost, requireFeature, type StaffEnv, teamOf, tell } from "./roles/access.ts";

// Check-in at the door (X5; Orbit flows: Event day). Any started seat on the event's host (Admin or Crew; Desk is a crew
// seat on a Venue host, the same rule) scans a ticket, admits a group's count and undoes a mis-tap. Every write locks
// the booking row for update, so two phones on one ticket never count anyone twice. Galaxy (holders of Hosts) sees
// the doors and can undo, logged with a reason. Tokens (qr, code) are never logged.

type Deps = { db: Db; notify: Notify; secret: string; now?: () => number };
type Row = typeof bookings.$inferSelect;

const HOUR = 3600_000, DAY = 24 * HOUR;
const GUESTS_CAP = 500; // ponytail: one read, no paging; a page when an event has thousands of bookings
const FOUND_CAP = 50;
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");

const REFUSED: Record<ScanRefusal, string> = {
  unknown: "No ticket matches this. Check the code and try again.",
  wrongEvent: "This ticket is for another event.",
  cancelled: "Cancelled: not valid.",
  early: "Too early: check-in opens 24 hours before the start.",
  ended: "Check-in for this event has closed.",
};

// The door: from 24 hours before the start to 3 hours after the end (as host/src/launch/day.ts checkInOpen).
export const doorShut = (e: { startsAt: Date | null; endsAt: Date | null }, now: number): "early" | "ended" | null => {
  if (!e.startsAt || !e.endsAt || now < e.startsAt.getTime() - DAY) return "early";
  return now > e.endsAt.getTime() + 3 * HOUR ? "ended" : null;
};
// Why a booking can't be let in now, in the scanner's order: cancelled, then the door.
const refusal = (b: Row, e: { startsAt: Date | null; endsAt: Date | null }, now: number): ScanRefusal | null =>
  b.status !== "confirmed" ? "cancelled" : doorShut(e, now);

// What was typed or scanned, as a lookup: the 32-character QR as is, or the 8-character code without spaces or dashes.
export const ticketBy = (text: string): SQL | null => {
  const t = text.trim();
  if (/^[A-Za-z0-9_-]{32}$/.test(t)) return eq(bookings.qr, t);
  const code = t.replace(/[\s-]/g, "").toUpperCase();
  return code.length === CODE_LENGTH ? eq(bookings.code, code) : null;
};

const guestOf = (b: Row, name: string | null): DoorGuest => ({
  id: b.id, name, quantity: b.quantity, admitted: b.admitted, checkedInAt: b.checkedInAt?.toISOString() ?? null,
});
const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

// A booking of this host's events, locked for update, with its event's times.
const locked = async (tx: Tx, where: SQL) =>
  (
    await tx
      .select({ b: bookings, hostId: events.hostId, startsAt: events.startsAt, endsAt: events.endsAt })
      .from(bookings)
      .innerJoin(events, eq(events.id, bookings.eventId))
      .where(where)
      .for("update", { of: bookings })
  )[0];

// Up to `total` (never down, never past the ticket). The first time anyone is in sets when and who.
const raise = async (tx: Tx, b: Row, total: number, by: string, at: Date) => {
  const next = Math.min(Math.max(b.admitted, total), b.quantity);
  if (next === b.admitted) return b;
  const [row] = await tx
    .update(bookings)
    .set({ admitted: next, checkedInAt: b.checkedInAt ?? at, checkedInBy: b.checkedInBy ?? by })
    .where(eq(bookings.id, b.id))
    .returning();
  return row!;
};
// Down to `total` (never up). Nobody in clears when and who.
const lower = async (tx: Tx, b: Row, total: number) => {
  const next = Math.min(b.admitted, total);
  if (next === b.admitted) return b;
  const [row] = await tx
    .update(bookings)
    .set({ admitted: next, ...(next === 0 ? { checkedInAt: null, checkedInBy: null } : {}) })
    .where(eq(bookings.id, b.id))
    .returning();
  return row!;
};

const nameOf = async (db: Db | Tx, id: string | null) =>
  id ? ((await db.select({ name: users.name }).from(users).where(eq(users.id, id)))[0]?.name ?? null) : null;

// Booked seats and how many are in, confirmed bookings only, per event.
const counts = async (db: Db, ids: string[]) => {
  const rows = ids.length
    ? await db
        .select({ id: bookings.eventId, booked: sql<number>`sum(${bookings.quantity})::int`, in: sql<number>`sum(${bookings.admitted})::int` })
        .from(bookings)
        .where(and(inArray(bookings.eventId, ids), eq(bookings.status, "confirmed")))
        .groupBy(bookings.eventId)
    : [];
  return new Map(rows.map((r) => [r.id, { booked: r.booked, in: r.in }]));
};

export function checkInRoutes({ db, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());

  // The person's started seat on the host in the path; writes need a live or paused host.
  // ponytail: the seat is read before the transaction, not again under it; a removal landing mid-scan lets that one scan through.
  const door = async (c: Context<StaffEnv>, write: boolean) => {
    const t = await teamOf(db, c.req.param("hostId") ?? "", c.var.user.id);
    if (!t) return nothing(c);
    if (write && !changeable(t.host)) return fail(c, 409, "hostClosed", "This host can't change anything right now.");
    return t.host;
  };

  // POST /hosts/:hostId/check-in/scan {eventId, text}: always 200 with a result; a refusal names nobody.
  app.post("/hosts/:hostId/check-in/scan", auth, async (c) => {
    const b = await parse(c, Scan);
    if (!b) return invalid(c);
    const host = await door(c, true);
    if (host instanceof Response) return host;
    const [e] = await db.select({ id: events.id }).from(events).where(and(eq(events.id, b.eventId), eq(events.hostId, host.id)));
    if (!e) return nothing(c);
    const by = ticketBy(b.text);
    const no = (r: ScanRefusal): ScanResult => ({ result: r, message: REFUSED[r] });
    const userId = c.var.user.id;
    const out = !by
      ? no("unknown")
      : await db.transaction(async (tx): Promise<ScanResult> => {
          const r = await locked(tx, by);
          if (!r || r.hostId !== host.id) return no("unknown");
          if (r.b.eventId !== e.id) return no("wrongEvent");
          const why = refusal(r.b, r, now());
          if (why) return no(why);
          const name = await nameOf(tx, r.b.userId);
          if (r.b.admitted >= r.b.quantity) return { result: "already", guest: guestOf(r.b, name), by: firstName(await nameOf(tx, r.b.checkedInBy)) };
          if (r.b.quantity > 1) return { result: "ask", guest: guestOf(r.b, name) };
          return { result: "in", guest: guestOf(await raise(tx, r.b, 1, userId, at()), name) };
        });
    return c.json(out);
  });

  // Admit and undo: a booking of this host's, locked, refused as the scan would (cancelled, door shut).
  const change = (path: "admit" | "undo") =>
    app.post(`/hosts/:hostId/check-in/:bookingId/${path}`, auth, async (c) => {
      const b = await parse(c, CheckInTotal);
      if (!b) return invalid(c);
      const id = c.req.param("bookingId");
      if (!isUuid(id)) return nothing(c);
      const host = await door(c, true);
      if (host instanceof Response) return host;
      const done = await db.transaction(async (tx) => {
        const r = await locked(tx, and(eq(bookings.id, id), eq(events.hostId, host.id))!);
        if (!r) return null;
        const why = refusal(r.b, r, now());
        if (why) return why;
        return path === "admit" ? raise(tx, r.b, b.total, c.var.user.id, at()) : lower(tx, r.b, b.total);
      });
      if (!done) return nothing(c);
      if (typeof done === "string") return fail(c, 409, done, REFUSED[done]);
      return c.json(guestOf(done, await nameOf(db, done.userId)));
    });
  change("admit");
  change("undo");

  // GET /hosts/:hostId/events/:eventId/guests?q=: by name, phone, email or code (2 characters at least), or everyone.
  app.get("/hosts/:hostId/events/:eventId/guests", auth, async (c) => {
    const host = await door(c, false);
    if (host instanceof Response) return host;
    const eventId = c.req.param("eventId");
    const [e] = isUuid(eventId) ? await db.select({ id: events.id }).from(events).where(and(eq(events.id, eventId), eq(events.hostId, host.id))) : [];
    if (!e) return nothing(c);
    const q = (c.req.query("q") ?? "").trim();
    if (q.length === 1 || q.length > 100) return invalid(c);
    let match: SQL | undefined;
    if (q) {
      const has = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      const digits = q.replace(/\D/g, "");
      match = or(
        ilike(users.name, has),
        ilike(users.email, has),
        digits.length >= 2 ? like(users.phone, `%${digits}%`) : undefined,
        eq(bookings.code, q.replace(/[\s-]/g, "").toUpperCase()),
      );
    }
    const rows = await db
      .select({ b: bookings, name: users.name })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.userId))
      .where(and(eq(bookings.eventId, e.id), eq(bookings.status, "confirmed"), match))
      .orderBy(asc(users.name), asc(bookings.createdAt))
      .limit(q ? FOUND_CAP : GUESTS_CAP);
    const n = (await counts(db, [e.id])).get(e.id) ?? { booked: 0, in: 0 };
    const out: DoorGuests = { guests: rows.map((r) => guestOf(r.b, r.name)), ...n };
    return c.json(out);
  });

  // ---------- Galaxy: Hosts ----------
  const hostsOnly = requireFeature(db, now, "hosts");
  const eventOut = (e: { id: string; title: string; hostId: string; hostName: string; startsAt: Date | null; endsAt: Date | null }, n?: { booked: number; in: number }): CheckInEvent => ({
    id: e.id, title: e.title, hostId: e.hostId, hostName: e.hostName, startsAt: e.startsAt!.toISOString(), endsAt: e.endsAt!.toISOString(),
    booked: n?.booked ?? 0, in: n?.in ?? 0,
  });
  const eventCols = { id: events.id, title: events.title, hostId: events.hostId, hostName: hosts.name, startsAt: events.startsAt, endsAt: events.endsAt };

  // GET /galaxy/check-in?page=: events whose door is open, or that ended in the last 7 days; latest start first.
  app.get("/galaxy/check-in", auth, hostsOnly, async (c) => {
    const { page, limit, offset } = listPage(c);
    const where = and(ne(events.status, "draft"), lte(events.startsAt, new Date(now() + DAY)), gte(events.endsAt, new Date(now() - 7 * DAY)));
    const rows = await db.select(eventCols).from(events).innerJoin(hosts, eq(hosts.id, events.hostId)).where(where).orderBy(desc(events.startsAt), events.id).limit(limit).offset(offset);
    const [total] = await db.select({ n: count() }).from(events).where(where);
    const n = await counts(db, rows.map((r) => r.id));
    const out: CheckInEvents = { events: rows.map((r) => eventOut(r, n.get(r.id))), total: total!.n, page, pageSize: limit };
    return c.json(out);
  });

  // GET /galaxy/check-in/:eventId: who's in, latest first.
  app.get("/galaxy/check-in/:eventId", auth, hostsOnly, async (c) => {
    const id = c.req.param("eventId");
    const [e] = isUuid(id) ? await db.select(eventCols).from(events).innerJoin(hosts, eq(hosts.id, events.hostId)).where(and(eq(events.id, id), ne(events.status, "draft"))) : [];
    if (!e) return nothing(c);
    const rows = await db
      .select({ b: bookings, name: users.name })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.userId))
      .where(and(eq(bookings.eventId, e.id), gt(bookings.admitted, 0)))
      .orderBy(desc(bookings.checkedInAt))
      .limit(GUESTS_CAP);
    const byIds = [...new Set(rows.map((r) => r.b.checkedInBy).filter((x): x is string => !!x))];
    const who = new Map(byIds.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, byIds))).map((u) => [u.id, u.name]) : []);
    const guests: CheckedIn[] = rows.map((r) => ({ ...guestOf(r.b, r.name), by: r.b.checkedInBy ? (who.get(r.b.checkedInBy) ?? null) : null }));
    const out: CheckInEventPage = { event: eventOut(e, (await counts(db, [e.id])).get(e.id)), guests };
    return c.json(out);
  });

  // POST /galaxy/check-in/:bookingId/undo {total, reason}: any time, logged, and every holder of Hosts is told. Staff
  // never act on a host they're on (Roles flow).
  app.post("/galaxy/check-in/:bookingId/undo", auth, hostsOnly, async (c) => {
    const b = await parse(c, StaffUndo);
    if (!b) return invalid(c);
    const id = c.req.param("bookingId");
    const [found] = isUuid(id) ? await db.select({ hostId: events.hostId }).from(bookings).innerJoin(events, eq(events.id, bookings.eventId)).where(eq(bookings.id, id)) : [];
    if (!found) return nothing(c);
    if (await onHost(db, found.hostId, c.var.user, now()))
      return fail(c, 403, "ownHost", "Staff never act on a host they're on, invited to or left in the last 30 days. Ask another staff member with this access.");
    const actor = c.var.actor.id;
    const done = await db.transaction(async (tx) => {
      const r = (await locked(tx, eq(bookings.id, id)))!;
      const row = await lower(tx, r.b, b.total);
      if (row.admitted !== r.b.admitted)
        await tx.insert(auditLog).values({
          actorId: actor, action: "checkin.undo", targetUser: row.userId, targetHost: r.hostId, reason: b.reason,
          data: { bookingId: row.id, from: r.b.admitted, to: row.admitted }, at: at(),
        });
      return { row, changed: row.admitted !== r.b.admitted };
    });
    if (done.changed) await tell(notify, await holdersOf(db, "hosts", at()), "staffRiskyAction", { action: "checkin.undo", hostId: found.hostId, reason: b.reason, by: actor });
    return c.json(guestOf(done.row, await nameOf(db, done.row.userId)));
  });

  return app;
}
