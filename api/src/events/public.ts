import { and, asc, desc, eq, gt, inArray, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { categories, EventCategory, EventSlug, HostSlug, type EventCard, type HostCard, MAX_QUERY, span, type PublicEvent, type TierCard, WHEN } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { events, eventSlugs, hosts, hostSlugs, ticketTypes } from "../db/schema.ts";
import { seatsTaken } from "../bookings.ts";
import { fail, invalid } from "../http.ts";
import { effectiveVisibility } from "./rules.ts";

// What anyone may read of events (Orbit flows: Discover): one event by link, what's near, search, and a host's events.
// No sign-in. Nothing here selects onlineLink, placeId, the team or who created or cancelled: those are never public.

type Deps = { db: Db; now?: () => number };
type Point = { lat: number; lng: number } | null;

const NEAR_KM = 25; // Discover D6
const NEAR_CAP = 100;
const SEARCH_EVENTS = 50;
const SEARCH_HOSTS = 20;
const PAST_SHOWN = 12;
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
// Postgres refuses a NUL in text, so one in a query is a refusal, never a 500.
const noNul = (s: string) => !s.includes("\u0000");
const iso = (d: Date | null) => d?.toISOString() ?? "";

// A host the public sees: public and live (as in hosts/routes.ts).
const visible = and(eq(hosts.visibility, "public"), eq(hosts.status, "live"));
// An event the lists show: published, public on a visible host, and not ended. One clock: until its end time (Discover D).
const listed = (now: Date) => and(eq(events.status, "published"), eq(events.visibility, "public"), visible, gt(events.endsAt, now));

// Who can open an event (GET /public/events/:slug, and so who can save it): published or cancelled, on a live host.
// A link-only event and a private host's events open too. Saves use the same rule.
export const openable = and(ne(events.status, "draft"), eq(hosts.status, "live"));

const hostColumns = { hid: hosts.id, hslug: hosts.slug, hname: hosts.name, hkind: hosts.kind, hcity: hosts.city, hverified: hosts.verifiedAt, hlogo: hosts.logo, hvis: hosts.visibility };
const base = {
  id: events.id, slug: events.slug, title: events.title, category: events.category, startsAt: events.startsAt, endsAt: events.endsAt, timezone: events.timezone,
  publishedAt: events.publishedAt, status: events.status, visibility: events.visibility, venue: events.venue, address: events.address, area: events.area,
  city: events.city, lat: events.lat, lng: events.lng, online: events.online, poster: events.poster, wide: events.wide, wideEdge: events.wideEdge,
  posterTone: events.posterTone, wideTone: events.wideTone,
};
const long = { about: events.about, agenda: events.agenda, faq: events.faq, terms: events.terms };

// Kilometres from the point to the event, by the haversine formula (no PostGIS); null where the event has no coordinates.
const distance = (p: Point) =>
  p
    ? sql<number | null>`case when ${events.lat} is null then null else 2 * 6371 * asin(least(1, sqrt(power(sin(radians(${events.lat} - ${p.lat}::float8) / 2), 2) + cos(radians(${p.lat}::float8)) * cos(radians(${events.lat})) * power(sin(radians(${events.lng} - ${p.lng}::float8) / 2), 2)))) end`
    : sql<null>`null`;

// The one builder behind all four reads: a card select with its host, then every event's tiers in one more query.
export async function cards(db: Db, q: { where: SQL | undefined; order: SQL[]; limit?: number; at?: Point; full?: boolean }): Promise<EventCard[]> {
  const rows = await db
    .select({ ...base, ...(q.full ? long : {}), ...hostColumns, dist: distance(q.at ?? null) })
    .from(events)
    .innerJoin(hosts, eq(hosts.id, events.hostId))
    .where(q.where)
    .orderBy(...q.order)
    .limit(q.limit ?? 2 ** 31 - 1);
  const tiers = rows.length
    ? await db.select().from(ticketTypes).where(inArray(ticketTypes.eventId, rows.map((r) => r.id))).orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt))
    : [];
  const sold = await seatsTaken(db, tiers.map((t) => t.id));
  return rows.map((r) => {
    const mine: TierCard[] = tiers
      .filter((t) => t.eventId === r.id)
      // Seats left: the quantity less confirmed bookings (P10.1); null with no limit.
      .map((t) => ({ id: t.id, name: t.name, pricePaise: t.pricePaise, quantity: t.quantity, left: t.quantity === null ? null : t.quantity - (sold.get(t.id) ?? 0), salesStartAt: t.salesStartAt?.toISOString() ?? null, salesEndAt: t.salesEndAt?.toISOString() ?? null, note: t.note, perPersonLimit: t.perPersonLimit }));
    const host: HostCard = { id: r.hid, slug: r.hslug, name: r.hname, kind: r.hkind, city: r.hcity, verified: !!r.hverified, logo: r.hlogo };
    return {
      id: r.id, slug: r.slug, title: r.title, category: r.category, startsAt: iso(r.startsAt), endsAt: iso(r.endsAt), timezone: r.timezone,
      publishedAt: r.publishedAt?.toISOString() ?? null, status: r.status as "published" | "cancelled", visibility: effectiveVisibility(r.hvis, r.visibility),
      place: r.venue === null ? null : { venue: r.venue, address: r.address!, area: r.area!, city: r.city!, lat: r.lat, lng: r.lng },
      online: r.online, poster: r.poster, wide: r.wide, wideEdge: r.wideEdge, tone: r.wideTone ?? r.posterTone,
      pricePaise: mine.length ? Math.min(...mine.map((t) => t.pricePaise)) : null, tiers: mine, host,
      distanceKm: r.dist === null || r.dist === undefined ? null : Math.round(Number(r.dist) * 10) / 10,
      ...(q.full ? { about: r.about ?? null, agenda: r.agenda ?? [], faq: r.faq ?? [], terms: r.terms ?? [] } : {}),
    };
  });
}

// Query text: every word must appear (Discover D7), so a % or _ is matched as itself.
const like = (w: string) => `%${w.replace(/[\\%_]/g, "\\$&")}%`;
const num = (min: number, max: number) => z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number).pipe(z.number().min(min).max(max));
// lat and lng come together, inside India like the contract's Place.
const Where = z
  .object({ lat: num(6, 37.5).optional(), lng: num(68, 97.5).optional(), city: z.string().trim().min(1).max(80).refine(noNul).optional() })
  .refine((b) => (b.lat === undefined) === (b.lng === undefined));
const Search = z.object({
  q: z.string().max(MAX_QUERY).refine(noNul).optional(),
  when: z.enum(WHEN.map((w) => w.id) as [string, ...string[]]).optional(),
  free: z.enum(["1", "true", "0", "false"]).optional(),
  category: EventCategory.optional(),
}).and(Where);

export function publicEventsRoutes({ db, now = Date.now }: Deps) {
  const app = new Hono();
  const at = () => new Date(now());
  const pointOf = (w: z.infer<typeof Where>): Point => (w.lat === undefined ? null : { lat: w.lat, lng: w.lng! });

  // GET /public/events/:slug: any slug the event has had; the body carries the current one, so the client redirects.
  // Drafts are 404. Published and cancelled events open for a live host, a private one's included (link-only events open
  // by their link); a paused, suspended or archived host's are 404.
  app.get("/public/events/:slug", async (c) => {
    if (!EventSlug.safeParse(c.req.param("slug")).success) return nothing(c);
    const [found] = await db
      .select({ id: eventSlugs.eventId })
      .from(eventSlugs)
      .innerJoin(events, eq(events.id, eventSlugs.eventId))
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .where(and(eq(eventSlugs.slug, c.req.param("slug")), openable));
    if (!found) return nothing(c);
    const [event] = await cards(db, { where: eq(events.id, found.id), order: [], limit: 1, full: true });
    return c.json(event as PublicEvent);
  });

  // GET /public/events/:slug/calendar.ics: Add to calendar in the app. Published events whose page opens only; any slug
  // the event has had.
  app.get("/public/events/:slug/calendar.ics", async (c) => {
    const slug = c.req.param("slug");
    if (!EventSlug.safeParse(slug).success) return nothing(c);
    const [e] = await db
      .select({ id: events.id, slug: events.slug, title: events.title, startsAt: events.startsAt, endsAt: events.endsAt, venue: events.venue, address: events.address, area: events.area, city: events.city, online: events.online, host: hosts.name })
      .from(eventSlugs)
      .innerJoin(events, eq(events.id, eventSlugs.eventId))
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .where(and(eq(eventSlugs.slug, slug), openable, eq(events.status, "published")));
    if (!e?.startsAt) return nothing(c);
    c.header("content-type", "text/calendar; charset=utf-8");
    c.header("content-disposition", `inline; filename="${e.slug}.ics"`);
    c.header("cache-control", "public, max-age=300");
    return c.body(icsOf({ ...e, startsAt: e.startsAt }, now()));
  });

  // GET /public/discover?lat&lng&city: what's listed and upcoming, soonest first, split into near (Discover D6) and the rest.
  // Near is within 25 km, plus events with no coordinates in the city, plus online-only events anywhere.
  app.get("/public/discover", async (c) => {
    const w = Where.safeParse(c.req.query());
    if (!w.success) return invalid(c);
    const p = pointOf(w.data);
    const city = w.data.city;
    const terms: SQL[] = [];
    if (p || city) {
      if (p) terms.push(sql`(${events.lat} is not null and ${distance(p)} <= ${NEAR_KM})`);
      // With no point there's no distance to take, so the city matches whatever the event has.
      if (city) terms.push(p ? and(sql`${events.lat} is null`, sql`lower(${events.city}) = ${city.toLowerCase()}`)! : sql`lower(${events.city}) = ${city.toLowerCase()}`);
      terms.push(and(eq(events.online, true), sql`${events.venue} is null`)!);
    }
    const near = terms.length ? sql`coalesce(${or(...terms)}, false)` : sql`false`;
    // ponytail: capped at 100 each; page when the lists grow.
    const get = (where: SQL | undefined) => cards(db, { where: and(listed(at()), where), order: [asc(events.startsAt), asc(events.id)], limit: NEAR_CAP, at: p });
    return c.json({ near: terms.length ? await get(near) : [], elsewhere: await get(sql`not ${near}`) });
  });

  // GET /public/search?q&when&free&category&lat&lng&city: events soonest first, and hosts, by the app's word rule
  // (app/src/search.ts): every word somewhere in title, host name, area or category label (Discover D7, D8).
  app.get("/public/search", async (c) => {
    const r = Search.safeParse(c.req.query());
    if (!r.success) return invalid(c);
    const { q = "", when, free, category } = r.data;
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const needs = words.map((w) => {
      const labelled = categories.filter((k) => k.label.toLowerCase().includes(w)).map((k) => k.slug);
      return or(sql`concat_ws(' ', ${events.title}, ${hosts.name}, ${events.area}) ilike ${like(w)}`, labelled.length ? inArray(events.category, labelled) : undefined)!;
    });
    const t = ticketTypes;
    const window = when && span(when as (typeof WHEN)[number]["id"], now());
    const where = and(
      listed(at()),
      ...needs,
      // [startsAt, endsAt) overlaps the window.
      window ? and(lt(events.startsAt, new Date(window[1])), gt(events.endsAt, new Date(window[0]))) : undefined,
      // Free: it has tiers and every one is price 0.
      free === "1" || free === "true"
        ? and(sql`exists (select 1 from ${t} where ${t.eventId} = ${events.id})`, sql`not exists (select 1 from ${t} where ${t.eventId} = ${events.id} and ${t.pricePaise} > 0)`)
        : undefined,
      category ? eq(events.category, category) : undefined,
    );
    const found = await cards(db, { where, order: [asc(events.startsAt), asc(events.id)], limit: SEARCH_EVENTS, at: pointOf(r.data) });
    const foundHosts = words.length
      ? await db
          .select({ id: hosts.id, slug: hosts.slug, name: hosts.name, kind: hosts.kind, city: hosts.city, verifiedAt: hosts.verifiedAt, logo: hosts.logo })
          .from(hosts)
          .where(and(visible, ...words.map((w) => sql`concat_ws(' ', ${hosts.name}, ${hosts.city}, ${hosts.about}) ilike ${like(w)}`)))
          .orderBy(asc(hosts.name))
          .limit(SEARCH_HOSTS)
      : [];
    return c.json({ events: found, hosts: foundHosts.map((h): HostCard => ({ id: h.id, slug: h.slug, name: h.name, kind: h.kind, city: h.city, verified: !!h.verifiedAt, logo: h.logo })) });
  });

  // GET /public/hosts/:slug/events: every upcoming listed event soonest first, then the latest 12 that have ended (not
  // cancelled, public), newest first. Any slug the host has had; a host that isn't public and live is 404.
  app.get("/public/hosts/:slug/events", async (c) => {
    if (!HostSlug.safeParse(c.req.param("slug")).success) return nothing(c);
    const [h] = await db
      .select({ id: hosts.id })
      .from(hostSlugs)
      .innerJoin(hosts, eq(hosts.id, hostSlugs.hostId))
      .where(and(eq(hostSlugs.slug, c.req.param("slug")), visible));
    if (!h) return nothing(c);
    const mine = eq(events.hostId, h.id);
    const upcoming = await cards(db, { where: and(listed(at()), mine), order: [asc(events.startsAt), asc(events.id)], limit: 1000 }); // ponytail: no cap asked; 1000 only keeps a runaway host from loading everything
    const past = await cards(db, {
      where: and(mine, eq(events.status, "published"), eq(events.visibility, "public"), lte(events.endsAt, at())),
      order: [desc(events.startsAt), asc(events.id)],
      limit: PAST_SHOWN,
    });
    return c.json({ upcoming, past });
  });

  return app;
}

// One event as an iCalendar file (RFC 5545): UTC times, text escaped, CRLF line ends. A missing end is start + 2 hours.
// ponytail: long lines aren't folded at 75 octets; Apple, Google and Outlook all read them unfolded.
export function icsOf(
  e: { id: string; slug: string; title: string; startsAt: Date; endsAt: Date | null; venue: string | null; address: string | null; area: string | null; city: string | null; online: boolean; host: string },
  now: number,
) {
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const url = `https://heyorbit.in/event/${e.slug}`;
  const place = e.venue ? [e.venue, e.address, e.area, e.city].filter(Boolean).join(", ") : e.online ? "Online" : null;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbit//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@heyorbit.in`,
    `DTSTAMP:${utc(new Date(now))}`,
    `DTSTART:${utc(e.startsAt)}`,
    `DTEND:${utc(e.endsAt ?? new Date(e.startsAt.getTime() + 2 * 3600_000))}`,
    `SUMMARY:${esc(e.title)}`,
    ...(place ? [`LOCATION:${esc(place)}`] : []),
    `URL:${url}`,
    `DESCRIPTION:${esc(`By ${e.host} on Orbit. ${url}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
