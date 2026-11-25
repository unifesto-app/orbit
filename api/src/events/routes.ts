import { and, asc, count, desc, eq, gt, isNotNull, isNull, lte, max, ne, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  CancelEvent, EditEvent, EditTicketType, type EventRow, type HostEvents, NewEvent, NewTicketType, PHOTO_MAX_BYTES, type PosterSaved, type PublishMissing,
  type TeamEvent, type TicketType, type WideSaved,
} from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { events, eventSlugs, hosts, teamRoles, ticketTypes } from "../db/schema.ts";
import { fail, invalid, isUuid, type Notify, parse, signedIn, taken, type Env } from "../http.ts";
import { contentImage, drop, linkOf, type Media, newKey } from "../media.ts";
import { changeable, teamOf } from "../roles/access.ts";
import { slugFor } from "../slugs.ts";
import { editRule, effectiveVisibility, placeColumns, stageOf, timesRule, visibilityRule } from "./rules.ts";

// Events a host's team makes and edits: drafts, the host's list, and the team's read (Orbit flows: Hosts and Discover).
// Publishing, cancelling (H5.3), ticket types (H5.4) and the poster come with Discover slice 1.

type Deps = { db: Db; notify: Notify; secret: string; now?: () => number; media?: Media };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Event = typeof events.$inferSelect;
type HostVisibility = typeof hosts.$inferSelect["visibility"];

const PAST_SHOWN = 50;
// ponytail: both caps are guesses (the flow docs set no number); change them here.
const MAX_DRAFTS = 50; // drafts a host may hold at once
const MAX_LINKS = 10; // links (slugs) an event may have had
const MAX_TICKETS = 20; // ticket types an event may have
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const closed = (c: Context) => fail(c, 409, "hostClosed", "This host can't change anything right now.");
const iso = (d: Date | null) => d?.toISOString() ?? null;

// The colour of the image the page shows: the 4:3 when there is one.
const toneOf = (e: Pick<Event, "wideTone" | "posterTone">) => e.wideTone ?? e.posterTone;
const toTicket = (t: typeof ticketTypes.$inferSelect): TicketType => ({
  id: t.id, name: t.name, pricePaise: t.pricePaise, quantity: t.quantity, salesStartAt: iso(t.salesStartAt), salesEndAt: iso(t.salesEndAt),
  note: t.note, perPersonLimit: t.perPersonLimit, sortOrder: t.sortOrder,
});
const TOO_BIG = "That image is over 5 MB.";

// What the team reads of an event; the place is one object, or null when it has none. A private host's events read as
// link-only whatever they stored (Hosts flow: "every event link-only"); the event keeps its own choice for if the host
// goes public again. Discover and the public read must check the host too (a later task): they never read this.
export const toTeamEvent = (e: Event, host: HostVisibility): TeamEvent => ({
  id: e.id, hostId: e.hostId, slug: e.slug, status: e.status, visibility: effectiveVisibility(host, e.visibility), title: e.title, category: e.category,
  startsAt: iso(e.startsAt), endsAt: iso(e.endsAt), timezone: e.timezone,
  place: e.venue === null ? null : { venue: e.venue, address: e.address!, area: e.area!, city: e.city!, lat: e.lat, lng: e.lng, placeId: e.placeId },
  online: e.online, onlineLink: e.onlineLink, about: e.about, agenda: e.agenda, faq: e.faq, terms: e.terms,
  poster: e.poster, wide: e.wide, wideEdge: e.wideEdge, tone: toneOf(e),
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

export function eventsRoutes({ db, secret, media, now = Date.now }: Deps) {
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
  const adminSeat = async (tx: Tx, hostId: string, userId: string) =>
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
      if (done.error === "needed") return fail(c, 400, "needed", "A published event keeps its dates, category, and a place or an online link. You can change them, not clear them.");
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

  // ---------- Publish and cancel (H5.3) ----------

  // The locks every change to a published or ticketed event takes, the same as PATCH: the host (shared), the person's
  // seat, then the event. `step` runs on what was read under them; a seat or host that changed since the first read
  // answers like the first read would have.
  const locked = async <T>(c: Context<Env>, got: { event: Event }, step: (tx: Tx, host: typeof hosts.$inferSelect, cur: Event) => Promise<T>): Promise<Response | T> => {
    const hostId = got.event.hostId;
    const out = await db.transaction(async (tx) => {
      const [host] = await tx.select().from(hosts).where(eq(hosts.id, hostId)).for("share");
      if (!(await adminSeat(tx, hostId, c.var.user.id))) return "gone" as const;
      if (!changeable(host!)) return "closed" as const;
      const [cur] = await tx.select().from(events).where(eq(events.id, got.event.id)).for("update");
      return step(tx, host!, cur!);
    });
    return out === "gone" ? nothing(c) : out === "closed" ? closed(c) : (out as Response | T);
  };

  // Moves an event from one status to the next. `step` reads the locked event and answers the columns to write, or a refusal.
  const move = async (c: Context<Env>, step: (cur: Event, tx: Tx) => Promise<Response | Partial<typeof events.$inferInsert>>) => {
    const got = await adminOfEvent(c.req.param("id") ?? "", c.var.user.id);
    if (!got) return nothing(c);
    if (!changeable(got.host)) return closed(c);
    const done = await locked(c, got, async (tx, host, cur) => {
      const set = await step(cur, tx);
      if (set instanceof Response) return set;
      const [row] = await tx.update(events).set({ ...set, updatedAt: at() }).where(eq(events.id, cur.id)).returning();
      return { row: row!, host: host.visibility };
    });
    return done instanceof Response ? done : c.json(toTeamEvent(done.row, done.host));
  };

  // POST /events/:id/publish: a draft only. Needs a poster, a time that hasn't ended, a place or an online link, a category
  // and a ticket type; a 409 lists what's missing so Console can show a fix button for each. Outside registration links
  // (H5.7) aren't here yet.
  // ponytail: follower pushes at publish, and the host link dropping its random ending at first publish, come with the
  // notifications slice.
  app.post("/events/:id/publish", auth, (c) =>
    move(c, async (cur, tx) => {
      if (cur.status !== "draft") return fail(c, 409, "notNow", `You can't publish an event that is ${cur.status}.`);
      const [tiers] = await tx.select({ n: count() }).from(ticketTypes).where(eq(ticketTypes.eventId, cur.id));
      const missing: PublishMissing[] = [];
      if (!cur.poster) missing.push("poster");
      if (!cur.title || !cur.startsAt || !cur.endsAt || cur.endsAt.getTime() <= now()) missing.push("when");
      if (cur.venue === null && !(cur.online && cur.onlineLink)) missing.push("where");
      if (!cur.category) missing.push("category");
      if (!tiers!.n) missing.push("tickets");
      if (missing.length) return fail(c, 409, "notReady", "This event isn't ready to publish yet.", { missing });
      return { status: "published", publishedAt: cur.publishedAt ?? at() };
    }),
  );

  // POST /events/:id/cancel: a published event that hasn't ended, with the reason its ticket holders get. An ended one
  // stays as it happened: cancelling would hide it from the host's page.
  // ponytail: refunds, notices and the cancel-with-bookings rules come with the bookings slice (H13.5).
  app.post("/events/:id/cancel", auth, async (c) => {
    const b = await parse(c, CancelEvent);
    if (!b) return invalid(c);
    return move(c, async (cur) =>
      cur.status !== "published"
        ? fail(c, 409, "notNow", `You can't cancel an event that is ${cur.status}.`)
        : stageOf(cur, now()) === "past"
          ? fail(c, 409, "ended", "This event has ended, so it can't be cancelled.")
          : { status: "cancelled", cancelledAt: at(), cancelledBy: c.var.user.id, cancelReason: b.reason },
    );
  });

  // ---------- Poster and 4:3 (Discover slice 1) ----------

  // An event's image from the form's `image`, kept as a WebP in the shape it's for. Only an Admin of a host that can change,
  // on an event that isn't cancelled. As setPhoto does for people: the new file goes in, then one transaction under the
  // locks swaps the link and hands back the old one, which is deleted after the commit; a refusal or a throw removes the
  // new file again.
  const picture = async (
    c: Context<Env>,
    shape: "poster" | "wide",
    write: (link: string, image: { edge: string; tone: string }) => Partial<typeof events.$inferInsert>,
    was: (e: Event) => string | null,
    body: (row: Event, link: string, image: { edge: string; tone: string }) => object,
  ) => {
    const got = await adminOfEvent(c.req.param("id") ?? "", c.var.user.id);
    if (!got) return nothing(c);
    if (!media) return fail(c, 503, "notSetUp", "Uploads aren't working right now. Try again later.");
    if (!changeable(got.host)) return closed(c);
    if (got.event.status === "cancelled") return fail(c, 409, "cancelled", "A cancelled event can't be edited.");
    const file = (await c.req.parseBody().catch(() => null))?.image;
    if (!(file instanceof File)) return invalid(c);
    if (file.size > PHOTO_MAX_BYTES) return fail(c, 413, "tooBig", TOO_BIG);
    const image = await contentImage(new Uint8Array(await file.arrayBuffer()), shape);
    if ("error" in image) {
      const [ratio, size] = shape === "poster" ? ["3:4", "900 × 1200"] : ["4:3", "1200 × 900"];
      if (image.error === "wrongShape") return fail(c, 400, "wrongShape", `That image isn't ${ratio}. Make it ${size}.`);
      if (image.error === "tooSmall") return fail(c, 400, "tooSmall", `That image is too small to look sharp on a phone. Make it ${size}.`);
      return fail(c, 400, "notImage", "That file isn't an image we can use. Choose a JPG, PNG or WebP.");
    }
    const key = newKey("events", got.event.id);
    await media.files.put(key, image.bytes, "image/webp");
    const link = linkOf(media, key);
    const unused = () => media.files.remove(key).catch((e) => console.error(`[media] couldn't delete ${key}`, e));
    const done = await locked(c, got, async (tx, _host, cur) => {
      if (cur.status === "cancelled") return fail(c, 409, "cancelled", "A cancelled event can't be edited.");
      const [row] = await tx.update(events).set({ ...write(link, image), updatedAt: at() }).where(eq(events.id, cur.id)).returning();
      return { row: row!, was: was(cur) };
    }).catch(async (e) => {
      await unused();
      throw e;
    });
    if (done instanceof Response) {
      await unused();
      return done;
    }
    await drop(media, done.was, "events", got.event.id); // committed: only the old file goes
    return c.json(body(done.row, link, image));
  };
  const tooBig = bodyLimit({ maxSize: PHOTO_MAX_BYTES + 16 * 1024, onError: (c) => fail(c, 413, "tooBig", TOO_BIG) });

  // PUT /events/:id/poster: the 3:4 poster, refused if it isn't 3:4, never cropped. Answers its link and the tone to show.
  app.put("/events/:id/poster", tooBig, auth, (c) =>
    picture(c, "poster", (link, i) => ({ poster: link, posterTone: i.tone }), (e) => e.poster, (row, link): PosterSaved => ({ poster: link, tone: toneOf(row)! })),
  );

  // PUT /events/:id/wide: the optional 4:3 the page shows instead; its top row is saved as `wideEdge`.
  app.put("/events/:id/wide", tooBig, auth, (c) =>
    picture(c, "wide", (link, i) => ({ wide: link, wideEdge: i.edge, wideTone: i.tone }), (e) => e.wide, (_row, link, i): WideSaved => ({ wide: link, wideEdge: i.edge, tone: i.tone })),
  );

  // DELETE /events/:id/wide: the 4:3 is optional; the poster's tone is the one shown again.
  app.delete("/events/:id/wide", auth, async (c) => {
    const got = await adminOfEvent(c.req.param("id"), c.var.user.id);
    if (!got) return nothing(c);
    if (!changeable(got.host)) return closed(c);
    const done = await locked(c, got, async (tx, _host, cur) => {
      if (cur.status === "cancelled") return fail(c, 409, "cancelled", "A cancelled event can't be edited.");
      await tx.update(events).set({ wide: null, wideEdge: null, wideTone: null, updatedAt: at() }).where(eq(events.id, cur.id));
      return { was: cur.wide, tone: cur.posterTone };
    });
    if (done instanceof Response) return done;
    if (media) await drop(media, done.was, "events", got.event.id);
    return c.json({ tone: done.tone });
  });

  // ---------- Ticket types (H5.4) ----------

  // GET /events/:id/tickets: the Admins' list, in the order shown.
  app.get("/events/:id/tickets", auth, async (c) => {
    const got = await adminOfEvent(c.req.param("id"), c.var.user.id);
    if (!got) return nothing(c);
    const list = await db.select().from(ticketTypes).where(eq(ticketTypes.eventId, got.event.id)).orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt));
    return c.json(list.map(toTicket));
  });

  // The refusals every ticket change shares, on the event as read under its lock: a cancelled event, an ended one (its
  // tickets lock with the date and place, Hosts flow). The host and seat are checked by `locked`.
  const ticketsOpen = (c: Context<Env>, e: Event) =>
    e.status === "cancelled" ? fail(c, 409, "cancelled", "A cancelled event can't be edited.")
    : stageOf(e, now()) === "past" ? fail(c, 409, "ended", "This event has ended, so its tickets are locked.")
    : null;
  // ponytail: once bookings exist (P10.1, H13.5), price and quantity lock on a ticket type that has bookings, and a
  // type with bookings can't be deleted; the check goes in ticketsOpen's callers below.

  // POST /events/:id/tickets: goes last in the order; at most 20 on an event.
  // ponytail: 20 is a guess; the flow doc sets none.
  app.post("/events/:id/tickets", auth, async (c) => {
    const b = await parse(c, NewTicketType);
    if (!b) return invalid(c);
    const got = await adminOfEvent(c.req.param("id"), c.var.user.id);
    if (!got) return nothing(c);
    if (!changeable(got.host)) return closed(c);
    const done = await locked(c, got, async (tx, _host, cur) => {
      const no = ticketsOpen(c, cur); // the event's lock means two adds can't both pass the cap
      if (no) return no;
      const [s] = await tx.select({ n: count(), last: max(ticketTypes.sortOrder) }).from(ticketTypes).where(eq(ticketTypes.eventId, cur.id));
      if (s!.n >= MAX_TICKETS) return fail(c, 409, "tooManyTickets", `An event can have ${MAX_TICKETS} ticket types.`);
      const [row] = await tx
        .insert(ticketTypes)
        .values({
          eventId: cur.id, name: b.name, pricePaise: b.pricePaise, quantity: b.quantity,
          salesStartAt: b.salesStartAt ? new Date(b.salesStartAt) : null, salesEndAt: b.salesEndAt ? new Date(b.salesEndAt) : null,
          note: b.note, perPersonLimit: b.perPersonLimit, sortOrder: (s!.last ?? -1) + 1, createdAt: at(), updatedAt: at(),
        })
        .returning();
      return row!;
    });
    return done instanceof Response ? done : c.json(toTicket(done), 201);
  });

  // PATCH /events/:id/tickets/:ticketId: only what's sent changes.
  app.patch("/events/:id/tickets/:ticketId", auth, async (c) => {
    const b = await parse(c, EditTicketType);
    if (!b) return invalid(c);
    const got = await adminOfEvent(c.req.param("id"), c.var.user.id);
    const tid = c.req.param("ticketId");
    if (!got || !isUuid(tid)) return nothing(c);
    if (!changeable(got.host)) return closed(c);
    const done = await locked(c, got, async (tx, _host, cur) => {
      const no = ticketsOpen(c, cur);
      if (no) return no;
      const [old] = await tx.select().from(ticketTypes).where(and(eq(ticketTypes.id, tid), eq(ticketTypes.eventId, cur.id)));
      if (!old) return nothing(c);
      // The contract checks the sales window only when both ends come together; this checks it as it'd be stored.
      const from = "salesStartAt" in b ? b.salesStartAt : iso(old.salesStartAt);
      const to = "salesEndAt" in b ? b.salesEndAt : iso(old.salesEndAt);
      if (from && to && Date.parse(to) <= Date.parse(from)) return invalid(c);
      const { salesStartAt, salesEndAt, ...rest } = b;
      const set: Partial<typeof ticketTypes.$inferInsert> = { ...rest, updatedAt: at() };
      if (salesStartAt !== undefined) set.salesStartAt = salesStartAt ? new Date(salesStartAt) : null;
      if (salesEndAt !== undefined) set.salesEndAt = salesEndAt ? new Date(salesEndAt) : null;
      const [row] = await tx.update(ticketTypes).set(set).where(eq(ticketTypes.id, tid)).returning();
      return row!;
    });
    return done instanceof Response ? done : c.json(toTicket(done));
  });

  // DELETE /events/:id/tickets/:ticketId: a published event keeps at least one ticket type, as publishing needed one.
  app.delete("/events/:id/tickets/:ticketId", auth, async (c) => {
    const got = await adminOfEvent(c.req.param("id"), c.var.user.id);
    const tid = c.req.param("ticketId");
    if (!got || !isUuid(tid)) return nothing(c);
    if (!changeable(got.host)) return closed(c);
    const done = await locked(c, got, async (tx, _host, cur) => {
      const no = ticketsOpen(c, cur);
      if (no) return no;
      // An unknown ticket is 404 before the last-one rule, which is only about one that exists.
      const mine = await tx.select({ id: ticketTypes.id }).from(ticketTypes).where(eq(ticketTypes.eventId, cur.id));
      if (!mine.some((t) => t.id === tid)) return nothing(c);
      if (cur.status === "published" && mine.length <= 1) return fail(c, 409, "lastTicket", "A published event needs at least one ticket type. Add another before removing this one.");
      await tx.delete(ticketTypes).where(eq(ticketTypes.id, tid));
      return null;
    });
    return done ?? c.body(null, 204);
  });

  return app;
}
