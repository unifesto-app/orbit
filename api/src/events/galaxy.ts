import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { CancelEvent, EventStatus, StaffReason, type StaffEvent, type StaffEvents } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { auditLog, bookings, events, hosts, ticketTypes } from "../db/schema.ts";
import { seatsTaken } from "../bookings.ts";
import { fail, invalid, isUuid, listPage, type Notify, parse, signedIn } from "../http.ts";
import { holdersOf, onHost, requireFeature, type StaffEnv, tell } from "../roles/access.ts";
import { cancelling, cancelRefused, toTeamEvent, toTicket } from "./routes.ts";

// Galaxy's Events (X1), for holders of Hosts: every host's events, one with its tickets, and staff's two moves on a
// published one: back to draft while nobody has booked, or cancel with the reason ticket holders get (the host's own
// cancel, `cancelling`). Each move is logged and told to every holder of Hosts, as requests.ts does. Staff never act on
// a host they're on (Roles flow).

type Deps = { db: Db; notify: Notify; secret: string; now?: () => number };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Event = typeof events.$inferSelect;

const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const ownHost = (c: Context) =>
  fail(c, 403, "ownHost", "Staff never act on a host they're on, invited to or left in the last 30 days. Ask another staff member with this access.");

export function galaxyEventsRoutes({ db, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const hostsOnly = requireFeature(db, now, "hosts");
  const at = () => new Date(now());

  // GET /galaxy/events?status=&host=&page=: newest first, each with its host and confirmed tickets.
  app.get("/galaxy/events", auth, hostsOnly, async (c) => {
    const status = c.req.query("status"), host = c.req.query("host");
    if (status && !EventStatus.safeParse(status).success) return invalid(c);
    if (host && !isUuid(host)) return invalid(c);
    const where = and(...([status && eq(events.status, status as EventStatus), host && eq(events.hostId, host)].filter(Boolean) as SQL[]));
    const { page, limit, offset } = listPage(c);
    const rows = await db
      .select({
        id: events.id, slug: events.slug, title: events.title, status: events.status, startsAt: events.startsAt, city: events.city, createdAt: events.createdAt,
        hostId: hosts.id, hostName: hosts.name,
        sold: sql<number>`(select coalesce(sum(${bookings.quantity}), 0)::int from ${bookings} where ${bookings.eventId} = ${events.id} and ${bookings.status} = 'confirmed')`,
      })
      .from(events)
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .where(where)
      .orderBy(desc(events.createdAt), desc(events.id))
      .limit(limit)
      .offset(offset);
    const [total] = await db.select({ n: count() }).from(events).where(where);
    const out: StaffEvents = {
      events: rows.map(({ hostId, hostName, startsAt, createdAt, ...e }) => ({
        ...e, startsAt: startsAt?.toISOString() ?? null, createdAt: createdAt.toISOString(), host: { id: hostId, name: hostName },
      })),
      total: total!.n,
      page,
      pageSize: limit,
    };
    return c.json(out);
  });

  // GET /galaxy/events/:id
  app.get("/galaxy/events/:id", auth, hostsOnly, async (c) => {
    const id = c.req.param("id");
    const [row] = isUuid(id) ? await db.select().from(events).innerJoin(hosts, eq(hosts.id, events.hostId)).where(eq(events.id, id)) : [];
    if (!row) return nothing(c);
    const { events: e, hosts: h } = row;
    const tiers = await db.select().from(ticketTypes).where(eq(ticketTypes.eventId, e.id)).orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt));
    const sold = await seatsTaken(db, tiers.map((t) => t.id));
    const [booked] = await db.select({ n: count() }).from(bookings).where(eq(bookings.eventId, e.id));
    const out: StaffEvent = {
      event: toTeamEvent(e, h.visibility),
      host: { id: h.id, name: h.name, slug: h.slug },
      tickets: tiers.map((t) => ({ ...toTicket(t), sold: sold.get(t.id) ?? 0 })),
      bookings: booked!.n,
    };
    return c.json(out);
  });

  // One move on one event, under the event's lock: `step` answers the columns to write or a refusal; the change and its
  // audit row land together, then every holder of Hosts hears of it.
  const act = async (c: Context<StaffEnv>, action: string, reason: string, step: (tx: Tx, cur: Event) => Promise<Response | Partial<typeof events.$inferInsert>>) => {
    const id = c.req.param("id") ?? "";
    const [found] = isUuid(id) ? await db.select({ hostId: events.hostId }).from(events).where(eq(events.id, id)) : [];
    if (!found) return nothing(c);
    if (await onHost(db, found.hostId, c.var.user, now())) return ownHost(c);
    const actor = c.var.actor.id;
    const done = await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(events).where(eq(events.id, id)).for("update");
      const set = await step(tx, cur!);
      if (set instanceof Response) return set;
      const [row] = await tx.update(events).set({ ...set, updatedAt: at() }).where(eq(events.id, id)).returning();
      await tx.insert(auditLog).values({ actorId: actor, action, targetHost: cur!.hostId, reason, data: { eventId: id, from: cur!.status }, at: at() });
      return row!;
    });
    if (done instanceof Response) return done;
    await tell(notify, await holdersOf(db, "hosts", at()), "staffRiskyAction", { action, eventId: id, reason, by: actor });
    const [h] = await db.select({ visibility: hosts.visibility }).from(hosts).where(eq(hosts.id, done.hostId));
    return c.json(toTeamEvent(done, h!.visibility));
  };

  // POST /galaxy/events/:id/unpublish: published back to draft, only while it has never had a booking (a cancelled one
  // included: its holder has a ticket for an event that was live). Its first publish time is kept, as a republish keeps it.
  app.post("/galaxy/events/:id/unpublish", auth, hostsOnly, async (c) => {
    const b = await parse(c, StaffReason);
    if (!b) return invalid(c);
    return act(c, "events.unpublish", b.reason, async (tx, cur) => {
      if (cur.status !== "published") return fail(c, 409, "notNow", `You can't unpublish an event that is ${cur.status}.`);
      const [booked] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.eventId, cur.id)).limit(1);
      if (booked) return fail(c, 409, "hasBookings", "People have booked this event, so it can't go back to draft. Cancel it instead.");
      return { status: "draft" };
    });
  });

  // POST /galaxy/events/:id/cancel: as the host's own cancel, with staff as who cancelled it.
  app.post("/galaxy/events/:id/cancel", auth, hostsOnly, async (c) => {
    const b = await parse(c, CancelEvent);
    if (!b) return invalid(c);
    return act(c, "events.cancel", b.reason, async (tx, cur) => {
      const r = await cancelling(tx, cur, c.var.actor.id, b.reason, at());
      return "error" in r ? cancelRefused(c, r.error, cur.status) : r.set;
    });
  });

  return app;
}
