import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  EditFestItem, EditPerson, type EventPerson, NewFestItem, NewPerson, OrderFestItems, type PublicFestItem, type PublicPerson, SetEventPeople,
  type StaffFestItem, type StaffLineup, type StaffPerson,
} from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { eventPeople, events, festItems, hosts, persons } from "./db/schema.ts";
import { fail, invalid, isUuid, parse, signedIn, unlinked } from "./http.ts";
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

// The event page's people and fest items. Fest items only on a fest; an act's host only while it's public and live.
export async function lineupOf(db: Db, eventId: string, category: string | null): Promise<{ people: EventPerson[]; festItems: PublicFestItem[] }> {
  const people = await db
    .select({ id: persons.id, name: persons.name, headline: persons.headline, role: eventPeople.role })
    .from(eventPeople)
    .innerJoin(persons, eq(persons.id, eventPeople.personId))
    .where(eq(eventPeople.eventId, eventId))
    .orderBy(asc(eventPeople.position));
  if (category !== "fests") return { people, festItems: [] };
  const rows = await db
    .select({ item: festItems, host: hosts })
    .from(festItems)
    .leftJoin(hosts, and(eq(hosts.id, festItems.actHostId), eq(hosts.visibility, "public"), eq(hosts.status, "live")))
    .where(eq(festItems.eventId, eventId))
    .orderBy(asc(festItems.position), asc(festItems.createdAt));
  return {
    people,
    festItems: rows.map(({ item, host: h }) => {
      const { actHostId: _, ...rest } = toStaffItem(item);
      return { ...rest, act: h ? { id: h.id, slug: h.slug, name: h.name, kind: h.kind, city: h.city, verified: !!h.verifiedAt, logo: h.logo } : null };
    }),
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

  app.post("/galaxy/persons", auth, hostsOnly, async (c) => {
    const b = await parse(c, NewPerson);
    if (!b) return invalid(c);
    const [p] = await db.insert(persons).values({ ...b, createdAt: at(), updatedAt: at() }).returning();
    return c.json(toStaffPerson(p!), 201);
  });

  app.patch("/galaxy/persons/:id", auth, hostsOnly, async (c) => {
    const id = c.req.param("id");
    const b = await parse(c, EditPerson);
    if (!b) return invalid(c);
    const [p] = isUuid(id) ? await db.update(persons).set({ ...b, updatedAt: at() }).where(eq(persons.id, id)).returning() : [];
    return p ? c.json(toStaffPerson(p)) : nothing(c);
  });

  // DELETE takes them off every event too (the cascade).
  app.delete("/galaxy/persons/:id", auth, hostsOnly, async (c) => {
    const id = c.req.param("id");
    const [p] = isUuid(id) ? await db.delete(persons).where(eq(persons.id, id)).returning({ id: persons.id }) : [];
    return p ? c.body(null, 204) : nothing(c);
  });

  // The event in the path, for a write: 404 when there's none, 403 when staff are on its host.
  const eventFor = async (c: Context<StaffEnv>, id: string) => {
    const [e] = isUuid(id) ? await db.select({ id: events.id, hostId: events.hostId, category: events.category }).from(events).where(eq(events.id, id)) : [];
    if (!e) return nothing(c);
    if (await onHost(db, e.hostId, c.var.user, now())) return ownHost(c);
    return e;
  };

  const lineup = async (eventId: string): Promise<StaffLineup> => {
    const people = await db
      .select({ p: persons, role: eventPeople.role })
      .from(eventPeople)
      .innerJoin(persons, eq(persons.id, eventPeople.personId))
      .where(eq(eventPeople.eventId, eventId))
      .orderBy(asc(eventPeople.position));
    const items = await db.select().from(festItems).where(eq(festItems.eventId, eventId)).orderBy(asc(festItems.position), asc(festItems.createdAt));
    return { people: people.map((r) => ({ ...toStaffPerson(r.p), role: r.role })), festItems: items.map(toStaffItem) };
  };

  // GET /galaxy/events/:id/lineup
  app.get("/galaxy/events/:id/lineup", auth, hostsOnly, async (c) => {
    const id = c.req.param("id");
    const [e] = isUuid(id) ? await db.select({ id: events.id }).from(events).where(eq(events.id, id)) : [];
    return e ? c.json(await lineup(e.id)) : nothing(c);
  });

  // PUT /galaxy/events/:id/people: replaces the whole list, in the order given.
  app.put("/galaxy/events/:id/people", auth, hostsOnly, async (c) => {
    const b = await parse(c, SetEventPeople);
    if (!b) return invalid(c);
    const e = await eventFor(c, c.req.param("id"));
    if (e instanceof Response) return e;
    try {
      await db.transaction(async (tx) => {
        await tx.delete(eventPeople).where(eq(eventPeople.eventId, e.id));
        if (b.people.length) await tx.insert(eventPeople).values(b.people.map((p, position) => ({ eventId: e.id, personId: p.personId, role: p.role, position })));
      });
    } catch (err) {
      if (unlinked(err)) return fail(c, 400, "noPerson", "One of those people isn't in Galaxy any more. Reload and try again.");
      throw err;
    }
    return c.json(await lineup(e.id));
  });

  // POST /galaxy/events/:id/fest-items: at the end. Fest events only.
  app.post("/galaxy/events/:id/fest-items", auth, hostsOnly, async (c) => {
    const b = await parse(c, NewFestItem);
    if (!b) return invalid(c);
    const e = await eventFor(c, c.req.param("id"));
    if (e instanceof Response) return e;
    if (e.category !== "fests") return fail(c, 409, "notFest", "Only a fest has things inside it. Set the event's category to Fests first.");
    try {
      // ponytail: two adds at once can share a position; the order PUT straightens it, and ties fall back to createdAt.
      const [i] = await db
        .insert(festItems)
        .values({ ...b, eventId: e.id, position: sql`(select coalesce(max(${festItems.position}) + 1, 0) from ${festItems} where ${festItems.eventId} = ${e.id})`, createdAt: at(), updatedAt: at() })
        .returning();
      return c.json(toStaffItem(i!), 201);
    } catch (err) {
      if (unlinked(err)) return fail(c, 400, "noHost", "That host isn't on Orbit.");
      throw err;
    }
  });

  // The fest item in the path and its event, for a write.
  const itemFor = async (c: Context<StaffEnv>) => {
    const id = c.req.param("id") ?? "";
    const [i] = isUuid(id) ? await db.select({ eventId: festItems.eventId }).from(festItems).where(eq(festItems.id, id)) : [];
    if (!i) return nothing(c);
    const e = await eventFor(c, i.eventId);
    return e instanceof Response ? e : id;
  };

  app.patch("/galaxy/fest-items/:id", auth, hostsOnly, async (c) => {
    const b = await parse(c, EditFestItem);
    if (!b) return invalid(c);
    const id = await itemFor(c);
    if (id instanceof Response) return id;
    try {
      const [i] = await db.update(festItems).set({ ...b, updatedAt: at() }).where(eq(festItems.id, id)).returning();
      return i ? c.json(toStaffItem(i)) : nothing(c);
    } catch (err) {
      if (unlinked(err)) return fail(c, 400, "noHost", "That host isn't on Orbit.");
      throw err;
    }
  });

  app.delete("/galaxy/fest-items/:id", auth, hostsOnly, async (c) => {
    const id = await itemFor(c);
    if (id instanceof Response) return id;
    await db.delete(festItems).where(eq(festItems.id, id));
    return c.body(null, 204);
  });

  // PUT /galaxy/events/:id/fest-items/order: every item of the event, each once.
  app.put("/galaxy/events/:id/fest-items/order", auth, hostsOnly, async (c) => {
    const b = await parse(c, OrderFestItems);
    if (!b) return invalid(c);
    const e = await eventFor(c, c.req.param("id"));
    if (e instanceof Response) return e;
    const done = await db.transaction(async (tx) => {
      const have = await tx.select({ id: festItems.id }).from(festItems).where(eq(festItems.eventId, e.id)).for("update");
      const ids = new Set(have.map((i) => i.id));
      if (ids.size !== b.ids.length || !b.ids.every((i) => ids.has(i))) return false;
      for (const [position, id] of b.ids.entries()) await tx.update(festItems).set({ position }).where(eq(festItems.id, id));
      return true;
    });
    if (!done) return fail(c, 409, "stale", "The fest's items changed. Reload and try again.");
    return c.json(await lineup(e.id));
  });

  return app;
}
