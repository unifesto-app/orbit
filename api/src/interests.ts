import { and, asc, count, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { type CategorySlug, categories, INTERESTED_FULL, MAX_INTERESTED, type MyInterested, type MyInterests, SetInterests } from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { eventInterests, events, hosts, users } from "./db/schema.ts";
import { openable } from "./events/public.ts";
import { mine } from "./saves.ts";
import { fail, invalid, isUuid, parse, signedIn, type Env } from "./http.ts";

// Interests on the account (orbit-pm X13; owner, 19 Nov 2026: "add interest cards for events", all four): the kinds of
// event you like, which lead Home's near-you list, and I'm interested on an event's page. Private, like saves: only the
// signed-in person reads or changes their own; the public sees an event's count (events/public.ts), never who.
// ponytail: no rate limits here; they join the other writes when the API gets its per-account limits.

type Deps = { db: Db; secret: string; now?: () => number };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const known = new Set<string>(categories.map((k) => k.slug));

export function interestsRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  // Every write holds the person's row (saves.ts's mine), so it can't land after a deletion's scrub, and two taps at
  // 999 can't both pass the cap.
  const held = <R,>(c: Context, run: (tx: Tx) => Promise<R>) => mine(db, c, c.var.user.id, run);

  // GET /me/interests: null until picked or skipped. A category retired since is left out.
  app.get("/me/interests", auth, async (c) => {
    const [u] = await db.select({ interests: users.interests }).from(users).where(eq(users.id, c.var.user.id));
    const body: MyInterests = { interests: u?.interests ? (u.interests.filter((s) => known.has(s)) as CategorySlug[]) : null };
    return c.json(body);
  });

  // PUT /me/interests {interests}: the whole list; [] is Not now, so Home stops asking.
  app.put("/me/interests", auth, async (c) => {
    const b = await parse(c, SetInterests);
    if (!b) return invalid(c);
    return held(c, async (tx) => {
      await tx.update(users).set({ interests: b.interests, updatedAt: new Date(now()) }).where(eq(users.id, c.var.user.id));
      const body: MyInterests = { interests: b.interests };
      return c.json(body);
    });
  });

  // GET /me/interested: the events you're interested in whose pages still open, oldest tap first.
  app.get("/me/interested", auth, async (c) => {
    const rows = await db
      .select({ id: eventInterests.eventId })
      .from(eventInterests)
      .innerJoin(events, eq(events.id, eventInterests.eventId))
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .where(and(eq(eventInterests.userId, c.var.user.id), openable))
      .orderBy(asc(eventInterests.at), asc(eventInterests.eventId));
    const body: MyInterested = { events: rows.map((r) => r.id) };
    return c.json(body);
  });

  // PUT /me/interested/:eventId: idempotent; an event the public can't open is a 404, as saves are.
  app.put("/me/interested/:eventId", auth, async (c) => {
    const id = c.req.param("eventId");
    if (!isUuid(id)) return nothing(c);
    const u = c.var.user.id;
    return held(c, async (tx) => {
      const [e] = await tx.select({ id: events.id }).from(events).innerJoin(hosts, eq(hosts.id, events.hostId)).where(and(eq(events.id, id), openable));
      if (!e) return nothing(c);
      const [have] = await tx.select({ id: eventInterests.eventId }).from(eventInterests).where(and(eq(eventInterests.userId, u), eq(eventInterests.eventId, id)));
      if (!have) {
        const [{ n }] = (await tx
          .select({ n: count() })
          .from(eventInterests)
          .innerJoin(events, eq(events.id, eventInterests.eventId))
          .innerJoin(hosts, eq(hosts.id, events.hostId))
          .where(and(eq(eventInterests.userId, u), openable))) as [{ n: number }];
        if (n >= MAX_INTERESTED) return fail(c, 409, "full", INTERESTED_FULL);
        await tx.insert(eventInterests).values({ userId: u, eventId: id, at: new Date(now()) });
      }
      return c.body(null, 204);
    });
  });

  // DELETE /me/interested/:eventId: idempotent, whatever the event's state.
  app.delete("/me/interested/:eventId", auth, async (c) => {
    const id = c.req.param("eventId");
    return held(c, async (tx) => {
      if (isUuid(id)) await tx.delete(eventInterests).where(and(eq(eventInterests.userId, c.var.user.id), eq(eventInterests.eventId, id)));
      return c.body(null, 204);
    });
  });

  return app;
}
