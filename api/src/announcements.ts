import { and, count, desc, eq, gt, gte, isNotNull, isNull, lte, notExists, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { ANNOUNCEMENTS_A_DAY, type AutoMessages, AutoMessagesBody, type EventAnnouncements, NewAnnouncement, type NoticeKind } from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { announcements, bookings, events, hosts, inboxItems, teamRoles, users } from "./db/schema.ts";
import { fail, invalid, isUuid, type Notify, parse, signedIn, type Tx, type Env } from "./http.ts";
import { changeable, teamOf } from "./roles/access.ts";

// Host announcements and the automatic reminders (notifications build plan PR 10). A ticket holder is anyone with a
// confirmed booking on the event. Admins send and switch; any started seat on the host (Crew too) reads. Event roles
// (Event lead) come with H3.3 and join here. Anyone else gets the usual 404.
// ponytail: bookings have no check-in yet (Crew slice), so "notCheckedIn" reaches every holder until admits are recorded;
// Thanks goes to every holder for the same reason.

type Deps = { db: Db; notify: Notify; secret: string; now?: () => number };

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const IST = 330 * MIN;
const AFTER = 7 * DAY; // announcements close a week after the end
const istDay = (t: number) => Math.floor((t + IST) / DAY) * DAY - IST; // the start of t's India day
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");

// The people holding a live ticket for an event.
const holders = async (q: Db | Tx, eventId: string) =>
  (await q.selectDistinct({ userId: bookings.userId }).from(bookings).where(and(eq(bookings.eventId, eventId), eq(bookings.status, "confirmed")))).map((r) => r.userId);

const sentToday = async (q: Db | Tx, eventId: string, now: number) =>
  (await q.select({ n: count() }).from(announcements).where(and(eq(announcements.eventId, eventId), gte(announcements.createdAt, new Date(istDay(now))))))[0]!.n;

export function announcementsRoutes({ db, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);

  // The event, its host and the person's seat on it; null for anyone off the team.
  const seatOn = async (eventId: string, userId: string) => {
    if (!isUuid(eventId)) return null;
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    const t = event && (await teamOf(db, event.hostId, userId));
    return t ? { event, host: t.host, admin: t.mine.role === "admin" } : null;
  };

  // POST /events/:id/announcements {text, audience}: to every ticket holder (or those not checked in), by push and inbox
  // (email once optional emails are on). An advisory lock on the event, not its row (bookings lock the person and then
  // share the event row), holds the seat, host and event checks, today's count and the row together, so two sends at
  // once can't make a fourth. The fan-out runs after the commit; notify keeps its own errors.
  // ponytail: one notify per holder, awaited in turn; a fan-out row for the worker when events run to thousands.
  app.post("/events/:id/announcements", auth, async (c) => {
    const got = await seatOn(c.req.param("id"), c.var.user.id);
    if (!got?.admin) return nothing(c);
    const b = await parse(c, NewAnnouncement);
    if (!b) return invalid(c);
    const userId = c.var.user.id;
    const out = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`announce:${got.event.id}`}))`);
      const [host] = await tx.select().from(hosts).where(eq(hosts.id, got.event.hostId));
      const [seat] = await tx
        .select({ id: teamRoles.id })
        .from(teamRoles)
        .where(and(eq(teamRoles.hostId, got.event.hostId), eq(teamRoles.userId, userId), eq(teamRoles.role, "admin"), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt)));
      if (!seat) return nothing(c);
      if (!changeable(host!)) return fail(c, 409, "hostClosed", "This host can't change anything right now.");
      const [cur] = await tx.select().from(events).where(eq(events.id, got.event.id));
      if (cur!.status !== "published") return fail(c, 409, "notNow", `You can't announce on an event that is ${cur!.status}.`);
      if (cur!.endsAt && now() > cur!.endsAt.getTime() + AFTER) return fail(c, 409, "ended", "This event ended more than a week ago, so announcements are closed.");
      if ((await sentToday(tx, cur!.id, now())) >= ANNOUNCEMENTS_A_DAY)
        return fail(c, 429, "tooMany", `You've sent ${ANNOUNCEMENTS_A_DAY} announcements for this event today. Try again tomorrow.`);
      const ids = await holders(tx, cur!.id);
      const [row] = await tx
        .insert(announcements)
        .values({ eventId: cur!.id, authorId: userId, text: b.text, audience: b.audience, reached: ids.length, createdAt: new Date(now()) })
        .returning();
      return { row: row!, ids, data: { eventId: cur!.id, hostName: host!.name, title: cur!.title, text: b.text } };
    });
    if (out instanceof Response) return out;
    const { row, ids, data } = out;
    for (const id of ids) await notify({ to: { userId: id }, kind: "hostAnnouncement", data, key: row.id });
    return c.json({ id: row.id, text: row.text, audience: row.audience, author: c.var.user.name ?? null, reached: row.reached, createdAt: row.createdAt.toISOString() }, 201);
  });

  // GET /events/:id/announcements: what was sent, by whom and to how many ticket holders; today's left; the switches.
  app.get("/events/:id/announcements", auth, async (c) => {
    const got = await seatOn(c.req.param("id"), c.var.user.id);
    if (!got) return nothing(c);
    const rows = await db
      .select({ id: announcements.id, text: announcements.text, audience: announcements.audience, author: users.name, reached: announcements.reached, createdAt: announcements.createdAt })
      .from(announcements)
      .innerJoin(users, eq(users.id, announcements.authorId))
      .where(eq(announcements.eventId, got.event.id))
      .orderBy(desc(announcements.createdAt));
    const body: EventAnnouncements = {
      items: rows.map((r) => ({ ...r, author: r.author ?? null, createdAt: r.createdAt.toISOString() })),
      left: Math.max(0, ANNOUNCEMENTS_A_DAY - (await sentToday(db, got.event.id, now()))),
      autoMessages: got.event.autoMessages,
    };
    return c.json(body);
  });

  // PUT /events/:id/auto-messages {tomorrow?, startingSoon?, thanks?}: the switches as they now stand.
  app.put("/events/:id/auto-messages", auth, async (c) => {
    const got = await seatOn(c.req.param("id"), c.var.user.id);
    if (!got?.admin) return nothing(c);
    const b = await parse(c, AutoMessagesBody);
    if (!b) return invalid(c);
    if (!changeable(got.host)) return fail(c, 409, "hostClosed", "This host can't change anything right now.");
    const [row] = await db
      .update(events)
      .set({ autoMessages: sql`${events.autoMessages} || ${JSON.stringify(b)}::jsonb`, updatedAt: new Date(now()) })
      .where(eq(events.id, got.event.id))
      .returning({ autoMessages: events.autoMessages });
    return c.json(row!.autoMessages);
  });

  return app;
}

// The minute tick: Tomorrow (20 to 24 hours before the start), Starting soon (within the hour before it) and Thanks
// (after the end, 09:00 to 21:00 India time, up to a day on) to each published event's ticket holders, where the host
// is live and left that switch on. Keyed by the event alone, so a second tick (or box), or a start moved inside the
// window, sends nothing again; holders who already have the item are left out by the query. Quiet hours, caps and the
// person's switches are notify's.
// ponytail: Tomorrow goes on the first tick inside 20 to 24 hours, so in practice at exactly 24 hours before; a
// different moment needs only the window moved.
// ponytail: the 09:00 to 21:00 window is India time; per-city time zones when Orbit runs in the UAE.
export async function sendReminders({ db, notify, now }: { db: Db; notify: Notify; now: () => number }) {
  const t = now();
  const h = (t - istDay(t)) / HOUR;
  const runs: { kind: NoticeKind; on: keyof AutoMessages; where: ReturnType<typeof and> }[] = [
    { kind: "eventTomorrow", on: "tomorrow", where: and(gt(events.startsAt, new Date(t + 20 * HOUR)), lte(events.startsAt, new Date(t + 24 * HOUR))) },
    { kind: "eventStartingSoon", on: "startingSoon", where: and(gt(events.startsAt, new Date(t)), lte(events.startsAt, new Date(t + HOUR))) },
  ];
  if (h >= 9 && h < 21) runs.push({ kind: "thanksForComing", on: "thanks", where: and(lte(events.endsAt, new Date(t)), gt(events.endsAt, new Date(t - DAY))) });
  for (const r of runs) {
    const due = await db
      .selectDistinct({ userId: bookings.userId, id: events.id, title: events.title, startsAt: events.startsAt, hostName: hosts.name })
      .from(events)
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .innerJoin(bookings, and(eq(bookings.eventId, events.id), eq(bookings.status, "confirmed")))
      .where(
        and(
          eq(events.status, "published"),
          eq(hosts.status, "live"),
          sql`(${events.autoMessages}->>${r.on})::boolean`,
          r.where,
          notExists(
            db
              .select({ one: sql`1` })
              .from(inboxItems)
              .where(and(eq(inboxItems.userId, bookings.userId), sql`${inboxItems.dedupeKey} = ${r.kind} || ':' || ${bookings.userId} || ':' || ${events.id}`)),
          ),
        ),
      );
    for (const e of due) {
      const data = { eventId: e.id, title: e.title, hostName: e.hostName, startsAt: e.startsAt?.toISOString() };
      await notify({ to: { userId: e.userId }, kind: r.kind, data, key: e.id });
    }
  }
}
