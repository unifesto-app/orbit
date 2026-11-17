import { and, count, desc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { EditEvent, type EventRow, type HostEvents, NewEvent, type TeamEvent } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { events, eventSlugs, hosts, teamRoles } from "../db/schema.ts";
import { fail, invalid, isUuid, type Notify, parse, signedIn, taken, type Env } from "../http.ts";
import { changeable, teamOf } from "../roles/access.ts";
import { slugFor } from "../slugs.ts";
import { editRule, effectiveVisibility, placeColumns, timesRule, visibilityRule } from "./rules.ts";

// Events a host's team makes and edits: drafts, the host's list, and the team's read (Orbit flows: Hosts and Discover).
// Publishing and cancelling come with H5.3, ticket types with H5.4.

type Deps = { db: Db; notify: Notify; secret: string; now?: () => number };
type Event = typeof events.$inferSelect;
type HostVisibility = typeof hosts.$inferSelect["visibility"];

const PAST_SHOWN = 50;
// ponytail: both caps are guesses (the flow docs set no number); change them here.
const MAX_DRAFTS = 50; // drafts a host may hold at once
const MAX_LINKS = 10; // links (slugs) an event may have had
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const closed = (c: Context) => fail(c, 409, "hostClosed", "This host can't change anything right now.");
const iso = (d: Date | null) => d?.toISOString() ?? null;

// What the team reads of an event; the place is one object, or null when it has none. A private host's events read as
// link-only whatever they stored (Hosts flow: "every event link-only"); the event keeps its own choice for if the host
// goes public again. Discover and the public read must check the host too (a later task): they never read this.
export const toTeamEvent = (e: Event, host: HostVisibility): TeamEvent => ({
  id: e.id, hostId: e.hostId, slug: e.slug, status: e.status, visibility: effectiveVisibility(host, e.visibility), title: e.title, category: e.category,
  startsAt: iso(e.startsAt), endsAt: iso(e.endsAt), timezone: e.timezone,
  place: e.venue === null ? null : { venue: e.venue, address: e.address!, area: e.area!, city: e.city!, lat: e.lat, lng: e.lng, placeId: e.placeId },
  online: e.online, onlineLink: e.onlineLink, about: e.about, agenda: e.agenda, faq: e.faq, terms: e.terms,
  publishedAt: iso(e.publishedAt), cancelledAt: iso(e.cancelledAt), cancelReason: e.cancelReason,
  createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString(),
});

const rowColumns = {
  id: events.id, slug: events.slug, status: events.status, visibility: events.visibility, title: events.title, category: events.category,
  startsAt: events.startsAt, endsAt: events.endsAt, timezone: events.timezone, area: events.area, city: events.city, online: events.online,
};

export const toRow = (e: Pick<Event, keyof typeof rowColumns>, host: HostVisibility): EventRow => ({
  id: e.id, slug: e.slug, status: e.status, visibility: effectiveVisibility(host, e.visibility), title: e.title, category: e.category,
  startsAt: iso(e.startsAt), endsAt: iso(e.endsAt), timezone: e.timezone, area: e.area, city: e.city, online: e.online,
});

export function eventsRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());

  // The one place that decides who may touch an event: an Admin of its host. H3.3 adds the event roles (Curator,
  // Co-curator, Crew) here, and nowhere else. Anyone else gets the usual 404.
  const adminOfEvent = async (eventId: string, userId: string) => {
    if (!isUuid(eventId)) return null;
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event) return null;
    const mine = await teamOf(db, event.hostId, userId);
    return mine?.mine.role === "admin" ? { event, host: mine.host } : null;
  };

  // The person's started Admin seat, read inside a transaction after the host is locked.
  const adminSeat = async (tx: Parameters<Parameters<Db["transaction"]>[0]>[0], hostId: string, userId: string) =>
    (
      await tx
        .select({ id: teamRoles.id })
        .from(teamRoles)
        .where(and(eq(teamRoles.hostId, hostId), eq(teamRoles.userId, userId), eq(teamRoles.role, "admin"), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt)))
    )[0] ?? null;

  // POST /hosts/:id/events: a draft starts from its name (Hosts flow). A private host's events are link-only.
  app.post("/hosts/:id/events", auth, async (c) => {
    const b = await parse(c, NewEvent);
    if (!b) return invalid(c);
    const userId = c.var.user.id;
    const t = await teamOf(db, c.req.param("id"), userId);
    if (t?.mine.role !== "admin") return nothing(c);
    if (!changeable(t.host)) return closed(c);
    for (let tries = 0; ; tries++) {
      try {
        // The host and the person's seat are read again under a lock: a suspension or removal since the first read stands.
        // A shared lock: staff's suspension and the owner's status moves take the host FOR UPDATE and wait for it, while
        // two edits on one host don't wait for each other. (A seat removal doesn't lock the host; the re-read covers it.)
        const made = await db.transaction(async (tx) => {
          const [cur] = await tx.select().from(hosts).where(eq(hosts.id, t.host.id)).for("share");
          if (!(await adminSeat(tx, t.host.id, userId))) return "gone" as const;
          if (!changeable(cur!)) return "closed" as const;
          const [drafts] = await tx.select({ n: count() }).from(events).where(and(eq(events.hostId, cur!.id), eq(events.status, "draft")));
          if (drafts!.n >= MAX_DRAFTS) return "tooMany" as const;
          const [e] = await tx
            .insert(events)
            .values({
              hostId: cur!.id, slug: slugFor(b.title, "event"), status: "draft", visibility: cur!.visibility === "private" ? "link" : "public",
              title: b.title, createdBy: userId, createdAt: at(), updatedAt: at(),
            })
            .returning();
          await tx.insert(eventSlugs).values({ slug: e!.slug, eventId: e!.id, createdAt: at() });
          return { e: e!, host: cur!.visibility };
        });
        if (made === "gone") return nothing(c);
        if (made === "closed") return closed(c);
        if (made === "tooMany") return fail(c, 409, "tooManyDrafts", `This host has ${MAX_DRAFTS} drafts. Finish or delete some first.`);
        return c.json(toTeamEvent(made.e, made.host), 201);
      } catch (e) {
        // Six random characters met another event's slug: try again with a fresh one.
        if (taken(e) && tries < 2) continue;
        throw e;
      }
    }
  });

  // GET /hosts/:id/events: Admins read the host's drafts, upcoming and past.
  app.get("/hosts/:id/events", auth, async (c) => {
    const t = await teamOf(db, c.req.param("id"), c.var.user.id);
    if (t?.mine.role !== "admin") return nothing(c);
    const mine = eq(events.hostId, t.host.id);
    const when = at();
    const v = t.host.visibility;
    // The same split as stageOf in rules.ts, in SQL: draft by status, otherwise past when endsAt is set and <= now.
    const drafts = await db.select(rowColumns).from(events).where(and(mine, eq(events.status, "draft"))).orderBy(desc(events.updatedAt));
    const upcoming = await db
      .select(rowColumns)
      .from(events)
      .where(and(mine, ne(events.status, "draft"), or(isNull(events.endsAt), gt(events.endsAt, when))))
      .orderBy(sql`${events.startsAt} asc nulls last`);
    // ponytail: the newest 50 past events; paging comes when a host has more.
    const past = await db
      .select(rowColumns)
      .from(events)
      .where(and(mine, ne(events.status, "draft"), lte(events.endsAt, when)))
      .orderBy(desc(events.endsAt))
      .limit(PAST_SHOWN);
    const out: HostEvents = { drafts: drafts.map((e) => toRow(e, v)), upcoming: upcoming.map((e) => toRow(e, v)), past: past.map((e) => toRow(e, v)) };
    return c.json(out);
  });

  // GET /events/:id: the host's Admins.
  app.get("/events/:id", auth, async (c) => {
    const got = await adminOfEvent(c.req.param("id"), c.var.user.id);
    return got ? c.json(toTeamEvent(got.event, got.host.visibility)) : nothing(c);
  });

  // PATCH /events/:id: Admins edit until it's cancelled; once an ended event has gone, its date and place lock (Hosts flow).
  app.patch("/events/:id", auth, async (c) => {
    const b = await parse(c, EditEvent);
    if (!b) return invalid(c);
    const userId = c.var.user.id;
    const got = await adminOfEvent(c.req.param("id"), userId);
    if (!got) return nothing(c);
    if (!changeable(got.host)) return closed(c);
    try {
      const done = await db.transaction(async (tx) => {
        // The host, the person's seat and the event are read again under locks, the host first as everywhere else:
        // whatever landed since the first read stands. The host's lock is shared, as in POST.
        const [host] = await tx.select().from(hosts).where(eq(hosts.id, got.host.id)).for("share");
        if (!(await adminSeat(tx, host!.id, userId))) return { error: "gone" } as const;
        if (!changeable(host!)) return { error: "closed" } as const;
        const [cur] = await tx.select().from(events).where(eq(events.id, got.event.id)).for("update");
        const edit = editRule(cur!, b, now());
        if (!edit.ok) return edit;
        const times = timesRule(cur!, b);
        if (!times.ok) return times;
        const visible = visibilityRule(host!.visibility, b);
        if (!visible.ok) return visible;
        if (b.slug !== undefined && b.slug !== cur!.slug) {
          // At most MAX_LINKS links an event has had; its own old one coming back adds none.
          const own = (await tx.select({ slug: eventSlugs.slug }).from(eventSlugs).where(eq(eventSlugs.eventId, cur!.id))).map((s) => s.slug);
          if (own.length >= MAX_LINKS && !own.includes(b.slug)) return { error: "tooManyLinks" } as const;
          // Every slug stays held by its event: its own old one is free to come back to, anyone else's is not.
          const [held] = await tx
            .insert(eventSlugs)
            .values({ slug: b.slug, eventId: cur!.id, createdAt: at() })
            .onConflictDoUpdate({ target: eventSlugs.slug, set: { eventId: cur!.id }, setWhere: eq(eventSlugs.eventId, cur!.id) })
            .returning();
          if (!held) return { error: "taken" } as const;
        }
        // Built key by key: the place is seven columns, not one, and dates arrive as text. Only what came in is written.
        const set: Partial<typeof events.$inferInsert> = { updatedAt: at() };
        if (b.title !== undefined) set.title = b.title;
        if (b.slug !== undefined) set.slug = b.slug;
        if (b.category !== undefined) set.category = b.category;
        if (b.startsAt !== undefined) set.startsAt = b.startsAt ? new Date(b.startsAt) : null;
        if (b.endsAt !== undefined) set.endsAt = b.endsAt ? new Date(b.endsAt) : null;
        if (b.timezone !== undefined) set.timezone = b.timezone;
        if (b.place !== undefined) Object.assign(set, placeColumns(b.place));
        if (b.online !== undefined) set.online = b.online;
        if (b.onlineLink !== undefined) set.onlineLink = b.onlineLink;
        if (b.visibility !== undefined) set.visibility = b.visibility;
        if (b.about !== undefined) set.about = b.about;
        // Every stored instant has one form: the agenda's times are written like the dates above.
        if (b.agenda !== undefined) set.agenda = b.agenda.map((a) => ({ at: new Date(a.at).toISOString(), item: a.item }));
        if (b.faq !== undefined) set.faq = b.faq;
        if (b.terms !== undefined) set.terms = b.terms;
        const [row] = await tx.update(events).set(set).where(eq(events.id, cur!.id)).returning();
        return { row: row!, host: host!.visibility };
      });
      if ("row" in done) return c.json(toTeamEvent(done.row!, done.host!));
      if (done.error === "gone") return nothing(c);
      if (done.error === "closed") return closed(c);
      if (done.error === "taken") return fail(c, 409, "linkTaken", "That link is taken. Try another.");
      if (done.error === "tooManyLinks") return fail(c, 409, "tooManyLinks", `This event has had ${MAX_LINKS} links. Use one it had before.`);
      if (done.error === "endInPast") return fail(c, 400, "endInPast", "A live event can't be moved into the past. To finish early, use End now.");
      if (done.error === "cancelled") return fail(c, 409, "cancelled", "A cancelled event can't be edited.");
      if (done.error === "ended") return fail(c, 409, "ended", "This event has ended, so its date and place are locked.");
      if (done.error === "endsBeforeStart") return fail(c, 400, "endsBeforeStart", "The event must end after it starts.");
      return fail(c, 400, "linkOnly", "This host is private, so its events are link-only.");
    } catch (e) {
      if (taken(e)) return fail(c, 409, "linkTaken", "That link is taken. Try another.");
      // A check the rules above should have caught: a refusal, not a 500.
      if (((e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code) === "23514") return invalid(c);
      throw e;
    }
  });

  return app;
}
