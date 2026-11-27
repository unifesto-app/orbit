import { and, asc, count, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  EditFestItem, EditPerson, type EventAct, type EventPerson, type HostCard, MAX_FEST_ITEMS, NewFestItem, NewPerson, OrderFestItems, type PublicFestItem,
  type PublicPerson, SetEventActs, SetEventPeople, type StaffFestItem, type StaffLineup, type StaffPerson,
} from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { auditLog, eventActs, eventPeople, events, festItems, hosts, persons } from "./db/schema.ts";
import { fail, invalid, isUuid, parse, signedIn, type Tx, unlinked } from "./http.ts";
import { onHost, requireFeature, type StaffEnv } from "./roles/access.ts";
import { cards } from "./events/public.ts";

// People on events and what's inside a fest (orbit-pm X14). Staff with Hosts keep them in Galaxy; anyone reads them
// on the event page (`lineupOf`) and the person sheet. Paths say "persons": Galaxy's /galaxy/people are accounts.

type Deps = { db: Db; secret: string; now?: () => number };
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const ownHost = (c: Context) =>
  fail(c, 403, "ownHost", "Staff never act on a host they're on, invited to or left in the last 30 days. Ask another staff member with this access.");
const PAST_SHOWN = 12;

type Person = typeof persons.$inferSelect;
type Item = typeof festItems.$inferSelect;
const toStaffPerson = (p: Person): StaffPerson => ({
  id: p.id, name: p.name, headline: p.headline, bio: p.bio, links: p.links, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
});
const toStaffItem = (i: Item): StaffFestItem => ({
  id: i.id, title: i.title, kind: i.kind, when: i.when, where: i.where, about: i.about, team: i.team, prize: i.prize, actHostId: i.actHostId,
});

type Host = typeof hosts.$inferSelect;
const toHostCard = (h: Host): HostCard => ({ id: h.id, slug: h.slug, name: h.name, kind: h.kind, city: h.city, verified: !!h.verifiedAt, logo: h.logo });
const shownHost = and(eq(hosts.visibility, "public"), eq(hosts.status, "live"));

// The event's acts, in order, as its team and staff see them: hidden ones too, marked.
export async function actsOf(db: Db | Tx, eventId: string): Promise<EventAct[]> {
  const rows = await db
    .select({ hostId: hosts.id, name: hosts.name, slug: hosts.slug, visibility: hosts.visibility, status: hosts.status })
    .from(eventActs)
    .innerJoin(hosts, eq(hosts.id, eventActs.hostId))
    .where(eq(eventActs.eventId, eventId))
    .orderBy(asc(eventActs.position));
  return rows.map(({ visibility, status, ...a }) => ({ ...a, shown: visibility === "public" && status === "live" }));
}

// Acts about to be written: none the event's own host, and each new one on Orbit and public and live (so the page shows
// it); one already on that has since gone hidden doesn't block reordering or removing others, as with fest items' acts.
// Read outside the write's transaction; a host deleted since fails the insert's foreign key.
export async function actsRefused(db: Db, c: Context, hostIds: string[], had: string[], eventHostId: string): Promise<Response | null> {
  if (hostIds.includes(eventHostId)) return fail(c, 400, "ownAct", "An event's own host can't be one of its acts.");
  const added = hostIds.filter((id) => !had.includes(id));
  const found = added.length ? await db.select({ id: hosts.id, visibility: hosts.visibility, status: hosts.status }).from(hosts).where(inArray(hosts.id, added)) : [];
  if (found.length !== added.length) return fail(c, 400, "noHost", "One of those hosts isn't on Orbit.");
  if (found.some((h) => h.visibility !== "public" || h.status !== "live")) return fail(c, 409, "actHidden", "One of those hosts isn't public and live, so the page wouldn't show it. Pick another.");
  return null;
}

export const actIds = async (db: Db, eventId: string) =>
  (await db.select({ id: eventActs.hostId }).from(eventActs).where(eq(eventActs.eventId, eventId))).map((a) => a.id);

// Replaces the event's acts with the list, in its order (the caller holds the event's lock).
export async function writeActs(tx: Tx, eventId: string, hostIds: string[]) {
  await tx.delete(eventActs).where(eq(eventActs.eventId, eventId));
  if (hostIds.length) await tx.insert(eventActs).values(hostIds.map((hostId, position) => ({ eventId, hostId, position })));
}

// The event page's people, fest items and acts. Fest items only on a fest; an act (or a fest item's act) only while its
// host is public and live.
export async function lineupOf(db: Db, eventId: string, category: string | null): Promise<{ people: EventPerson[]; festItems: PublicFestItem[]; acts: HostCard[] }> {
  const people = await db
    .select({ id: persons.id, name: persons.name, headline: persons.headline, role: eventPeople.role })
    .from(eventPeople)
    .innerJoin(persons, eq(persons.id, eventPeople.personId))
    .where(eq(eventPeople.eventId, eventId))
    .orderBy(asc(eventPeople.position));
  const acts = (
    await db.select({ h: hosts }).from(eventActs).innerJoin(hosts, and(eq(hosts.id, eventActs.hostId), shownHost)).where(eq(eventActs.eventId, eventId)).orderBy(asc(eventActs.position))
  ).map((r) => toHostCard(r.h));
  if (category !== "fests") return { people, festItems: [], acts };
  const rows = await db
    .select({ item: festItems, host: hosts })
    .from(festItems)
    .leftJoin(hosts, and(eq(hosts.id, festItems.actHostId), shownHost))
    .where(eq(festItems.eventId, eventId))
    .orderBy(asc(festItems.position), asc(festItems.createdAt));
  return {
    people,
    festItems: rows.map(({ item, host: h }) => {
      const { actHostId: _, ...rest } = toStaffItem(item);
      return { ...rest, act: h ? toHostCard(h) : null };
    }),
    acts,
  };
}

export function peopleRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const hostsOnly = requireFeature(db, now, "hosts");
  const at = () => new Date(now());

  // GET /public/people/:id: the person and the events they're on that the lists would show (published, public, on a
  // public live host): upcoming soonest first, then the latest 12 that have ended. Link-only and private hosts' events stay off.
  app.get("/public/people/:id", async (c) => {
    const id = c.req.param("id");
    const [p] = isUuid(id) ? await db.select().from(persons).where(eq(persons.id, id)) : [];
    if (!p) return nothing(c);
    const on = await db.select({ eventId: eventPeople.eventId, role: eventPeople.role }).from(eventPeople).where(eq(eventPeople.personId, id));
    const role = new Map(on.map((r) => [r.eventId, r.role]));
    const shown = on.length
      ? and(inArray(events.id, [...role.keys()]), eq(events.status, "published"), eq(events.visibility, "public"), eq(hosts.visibility, "public"), eq(hosts.status, "live"))
      : sql`false`;
    const upcoming = await cards(db, { where: and(shown, gt(events.endsAt, at())), order: [asc(events.startsAt), asc(events.id)], limit: 100 });
    const past = await cards(db, { where: and(shown, lte(events.endsAt, at())), order: [desc(events.startsAt), asc(events.id)], limit: PAST_SHOWN });
    const out: PublicPerson = {
      id: p.id, name: p.name, headline: p.headline, bio: p.bio, links: p.links,
      appearances: [...upcoming, ...past].map((event) => ({ role: role.get(event.id)!, event })),
    };
    return c.json(out);
  });

  // GET /galaxy/persons?q=: by name, A to Z, 50 at most (the picker on an event's People).
  app.get("/galaxy/persons", auth, hostsOnly, async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length > 80 || q.includes("\u0000")) return invalid(c);
    const rows = await db
      .select()
      .from(persons)
      .where(q ? sql`${persons.name} ilike ${`%${q.replace(/[\\%_]/g, "\\$&")}%`}` : undefined)
      .orderBy(asc(persons.name), asc(persons.id))
      .limit(50);
    return c.json({ persons: rows.map(toStaffPerson) });
  });

  // Every staff write here is logged (no reason, nobody told: it's page content, as App content's edits).
  const log = (tx: Db | Tx, c: Context<StaffEnv>, action: string, targetHost: string | null, data: object) =>
    tx.insert(auditLog).values({ actorId: c.var.actor.id, action, targetHost, data, at: at() });
  // Staff never act on a host they're on (Roles flow): any of these.
  const onAny = async (c: Context<StaffEnv>, hostIds: string[]) => {
    for (const h of new Set(hostIds)) if (await onHost(db, h, c.var.user, now())) return true;
    return false;
  };

  app.post("/galaxy/persons", auth, hostsOnly, async (c) => {
    const b = await parse(c, NewPerson);
    if (!b) return invalid(c);
    const p = await db.transaction(async (tx) => {
      const [p] = await tx.insert(persons).values({ ...b, createdAt: at(), updatedAt: at() }).returning();
      await log(tx, c, "persons.add", null, { personId: p!.id });
      return p!;
    });
    return c.json(toStaffPerson(p), 201);
  });

  // A person on an event of a host the staff member is on is theirs to leave alone, as that host's pages are.
  const personFor = async (c: Context<StaffEnv>) => {
    const id = c.req.param("id") ?? "";
    const [p] = isUuid(id) ? await db.select({ id: persons.id }).from(persons).where(eq(persons.id, id)) : [];
    if (!p) return nothing(c);
    const on = await db.selectDistinct({ hostId: events.hostId }).from(eventPeople).innerJoin(events, eq(events.id, eventPeople.eventId)).where(eq(eventPeople.personId, id));
    return (await onAny(c, on.map((r) => r.hostId))) ? ownHost(c) : id;
  };

  app.patch("/galaxy/persons/:id", auth, hostsOnly, async (c) => {
    const b = await parse(c, EditPerson);
    if (!b) return invalid(c);
    const id = await personFor(c);
    if (id instanceof Response) return id;
    const p = await db.transaction(async (tx) => {
      const [p] = await tx.update(persons).set({ ...b, updatedAt: at() }).where(eq(persons.id, id)).returning();
      if (p) await log(tx, c, "persons.edit", null, { personId: id, fields: Object.keys(b) });
      return p;
    });
    return p ? c.json(toStaffPerson(p)) : nothing(c);
  });

  // DELETE takes them off every event too (the cascade).
  app.delete("/galaxy/persons/:id", auth, hostsOnly, async (c) => {
    const id = await personFor(c);
    if (id instanceof Response) return id;
    const gone = await db.transaction(async (tx) => {
      const [p] = await tx.delete(persons).where(eq(persons.id, id)).returning({ id: persons.id });
      if (p) await log(tx, c, "persons.delete", null, { personId: id }); // ids only: the name is gone with them
      return !!p;
    });
    return gone ? c.body(null, 204) : nothing(c);
  });

  // The event in the path, for a write: 404 when there's none, 403 when staff are on its host.
  const eventFor = async (c: Context<StaffEnv>, id: string) => {
    const [e] = isUuid(id) ? await db.select({ id: events.id, hostId: events.hostId, category: events.category }).from(events).where(eq(events.id, id)) : [];
    if (!e) return nothing(c);
    if (await onHost(db, e.hostId, c.var.user, now())) return ownHost(c);
    return e;
  };

  // An act's host, at write time: on Orbit, public and live (so the page shows it), and not one the staff member is on.
  const actRefused = async (c: Context<StaffEnv>, actHostId: string | null | undefined) => {
    if (!actHostId) return null;
    const [h] = await db.select({ visibility: hosts.visibility, status: hosts.status }).from(hosts).where(eq(hosts.id, actHostId));
    if (!h) return fail(c, 400, "noHost", "That host isn't on Orbit.");
    if (h.visibility !== "public" || h.status !== "live") return fail(c, 409, "actHidden", "That host isn't public and live, so the fest page wouldn't show it. Pick another.");
    if (await onHost(db, actHostId, c.var.user, now())) return ownHost(c);
    return null;
  };

  const lineup = async (eventId: string): Promise<StaffLineup> => {
    const people = await db
      .select({ p: persons, role: eventPeople.role })
      .from(eventPeople)
      .innerJoin(persons, eq(persons.id, eventPeople.personId))
      .where(eq(eventPeople.eventId, eventId))
      .orderBy(asc(eventPeople.position));
    const items = await db.select().from(festItems).where(eq(festItems.eventId, eventId)).orderBy(asc(festItems.position), asc(festItems.createdAt));
    return { people: people.map((r) => ({ ...toStaffPerson(r.p), role: r.role })), festItems: items.map(toStaffItem), acts: await actsOf(db, eventId) };
  };
  const stale = (c: Context) => fail(c, 409, "stale", "This changed since you opened it. Reload and try again.");

  // GET /galaxy/events/:id/lineup
  app.get("/galaxy/events/:id/lineup", auth, hostsOnly, async (c) => {
    const id = c.req.param("id");
    const [e] = isUuid(id) ? await db.select({ id: events.id }).from(events).where(eq(events.id, id)) : [];
    return e ? c.json(await lineup(e.id)) : nothing(c);
  });

  // PUT /galaxy/events/:id/people: replaces the whole list, in the order given, under the event's lock; refused when
  // the list isn't the one the page showed.
  app.put("/galaxy/events/:id/people", auth, hostsOnly, async (c) => {
    const b = await parse(c, SetEventPeople);
    if (!b) return invalid(c);
    const e = await eventFor(c, c.req.param("id"));
    if (e instanceof Response) return e;
    try {
      const done = await db.transaction(async (tx) => {
        await tx.select({ id: events.id }).from(events).where(eq(events.id, e.id)).for("update");
        const have = await tx.select({ personId: eventPeople.personId, role: eventPeople.role }).from(eventPeople).where(eq(eventPeople.eventId, e.id)).orderBy(asc(eventPeople.position));
        const pairs = (a: { personId: string; role: string }[]) => JSON.stringify(a.map((p) => [p.personId, p.role]));
        if (pairs(have) !== pairs(b.shown)) return false;
        await tx.delete(eventPeople).where(eq(eventPeople.eventId, e.id));
        if (b.people.length) await tx.insert(eventPeople).values(b.people.map((p, position) => ({ eventId: e.id, personId: p.personId, role: p.role, position })));
        await log(tx, c, "events.people", e.hostId, { eventId: e.id, people: b.people });
        return true;
      });
      if (!done) return stale(c);
    } catch (err) {
      if (unlinked(err)) return fail(c, 400, "noPerson", "One of those people isn't in Galaxy any more. Reload and try again.");
      throw err;
    }
    return c.json(await lineup(e.id));
  });

  // PUT /galaxy/events/:id/acts: replaces the whole list, in the order given, under the event's lock. Each act as the
  // host's own PUT checks it, and none (added or taken off) a host the staff member is on.
  app.put("/galaxy/events/:id/acts", auth, hostsOnly, async (c) => {
    const b = await parse(c, SetEventActs);
    if (!b) return invalid(c);
    const e = await eventFor(c, c.req.param("id"));
    if (e instanceof Response) return e;
    const had = await actIds(db, e.id);
    const no = await actsRefused(db, c, b.hostIds, had, e.hostId);
    if (no) return no;
    if (await onAny(c, [...had, ...b.hostIds])) return ownHost(c); // taking one off counts too
    try {
      await db.transaction(async (tx) => {
        await tx.select({ id: events.id }).from(events).where(eq(events.id, e.id)).for("update");
        await writeActs(tx, e.id, b.hostIds);
        await log(tx, c, "events.acts", e.hostId, { eventId: e.id, hostIds: b.hostIds });
      });
    } catch (err) {
      if (unlinked(err)) return fail(c, 400, "noHost", "One of those hosts isn't on Orbit.");
      throw err;
    }
    return c.json(await lineup(e.id));
  });

  // POST /galaxy/events/:id/fest-items: at the end, up to 100. Fest events only.
  app.post("/galaxy/events/:id/fest-items", auth, hostsOnly, async (c) => {
    const b = await parse(c, NewFestItem);
    if (!b) return invalid(c);
    const e = await eventFor(c, c.req.param("id"));
    if (e instanceof Response) return e;
    if (e.category !== "fests") return fail(c, 409, "notFest", "Only a fest has things inside it. Set the event's category to Fests first.");
    const no = await actRefused(c, b.actHostId);
    if (no) return no;
    try {
      const i = await db.transaction(async (tx) => {
        // Under the event's lock, so two adds can't share a position or pass the cap together.
        await tx.select({ id: events.id }).from(events).where(eq(events.id, e.id)).for("update");
        const [got] = await tx.select({ n: count(), last: sql<number | null>`max(${festItems.position})` }).from(festItems).where(eq(festItems.eventId, e.id));
        if (got!.n >= MAX_FEST_ITEMS) return null;
        const [i] = await tx.insert(festItems).values({ ...b, eventId: e.id, position: (got!.last ?? -1) + 1, createdAt: at(), updatedAt: at() }).returning();
        await log(tx, c, "festItems.add", e.hostId, { eventId: e.id, itemId: i!.id, title: i!.title });
        return i!;
      });
      if (!i) return fail(c, 409, "full", `A fest holds ${MAX_FEST_ITEMS} things. Remove one first.`);
      return c.json(toStaffItem(i), 201);
    } catch (err) {
      if (unlinked(err)) return fail(c, 400, "noHost", "That host isn't on Orbit.");
      throw err;
    }
  });

  // The fest item in the path and its event, for a write.
  const itemFor = async (c: Context<StaffEnv>) => {
    const id = c.req.param("id") ?? "";
    const [i] = isUuid(id) ? await db.select({ eventId: festItems.eventId, actHostId: festItems.actHostId }).from(festItems).where(eq(festItems.id, id)) : [];
    if (!i) return nothing(c);
    const e = await eventFor(c, i.eventId);
    if (e instanceof Response) return e;
    // The act it already credits counts too, whatever the body says (as hosts/routes' actable).
    if (i.actHostId && (await onHost(db, i.actHostId, c.var.user, now()))) return ownHost(c);
    return { id, hostId: e.hostId, eventId: e.id, actHostId: i.actHostId };
  };

  app.patch("/galaxy/fest-items/:id", auth, hostsOnly, async (c) => {
    const b = await parse(c, EditFestItem);
    if (!b) return invalid(c);
    const it = await itemFor(c);
    if (it instanceof Response) return it;
    // Only a new act is checked: an unchanged one on a host since paused mustn't block other edits.
    const no = b.actHostId !== undefined && b.actHostId !== it.actHostId ? await actRefused(c, b.actHostId) : null;
    if (no) return no;
    try {
      const i = await db.transaction(async (tx) => {
        const [i] = await tx.update(festItems).set({ ...b, updatedAt: at() }).where(eq(festItems.id, it.id)).returning();
        if (i) await log(tx, c, "festItems.edit", it.hostId, { eventId: it.eventId, itemId: it.id, fields: Object.keys(b) });
        return i;
      });
      return i ? c.json(toStaffItem(i)) : nothing(c);
    } catch (err) {
      if (unlinked(err)) return fail(c, 400, "noHost", "That host isn't on Orbit.");
      throw err;
    }
  });

  app.delete("/galaxy/fest-items/:id", auth, hostsOnly, async (c) => {
    const it = await itemFor(c);
    if (it instanceof Response) return it;
    await db.transaction(async (tx) => {
      const [i] = await tx.delete(festItems).where(eq(festItems.id, it.id)).returning({ title: festItems.title });
      if (i) await log(tx, c, "festItems.delete", it.hostId, { eventId: it.eventId, itemId: it.id, title: i.title });
    });
    return c.body(null, 204);
  });

  // PUT /galaxy/events/:id/fest-items/order: every item of the event, each once.
  app.put("/galaxy/events/:id/fest-items/order", auth, hostsOnly, async (c) => {
    const b = await parse(c, OrderFestItems);
    if (!b) return invalid(c);
    const e = await eventFor(c, c.req.param("id"));
    if (e instanceof Response) return e;
    const acts = await db.selectDistinct({ id: festItems.actHostId }).from(festItems).where(eq(festItems.eventId, e.id));
    if (await onAny(c, acts.flatMap((a) => (a.id ? [a.id] : [])))) return ownHost(c);
    const done = await db.transaction(async (tx) => {
      await tx.select({ id: events.id }).from(events).where(eq(events.id, e.id)).for("update");
      const have = await tx.select({ id: festItems.id }).from(festItems).where(eq(festItems.eventId, e.id));
      const ids = new Set(have.map((i) => i.id));
      if (ids.size !== b.ids.length || !b.ids.every((i) => ids.has(i))) return false;
      for (const [position, id] of b.ids.entries()) await tx.update(festItems).set({ position }).where(eq(festItems.id, id));
      await log(tx, c, "festItems.order", e.hostId, { eventId: e.id, ids: b.ids });
      return true;
    });
    if (!done) return stale(c);
    return c.json(await lineup(e.id));
  });

  return app;
}
