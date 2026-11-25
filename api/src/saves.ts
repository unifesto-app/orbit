import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { LIST_GONE, ListBody, ListId, listName, LISTS_FULL, MAX_LISTS, MAX_SAVED, type MySaves, RemoveSaves, RestoreSaves, SAVED_FULL, type SavedList } from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { events, hosts, listEvents, lists, saves, users } from "./db/schema.ts";
import { cards, openable } from "./events/public.ts";
import { fail, invalid, isUuid, parse, signedIn, type Env } from "./http.ts";

// Saved events and lists on the account (Saved events and lists doc). Private: only the signed-in person reads or
// changes their own, and a list or event that isn't theirs to touch is a 404, so a guess reveals nothing.
// An event that can't be opened any more (draft, host off the air) is hidden from every read and every count, never
// deleted, and comes back when it can be opened again.
// ponytail: no rate limits here; they join the other writes when the API gets its per-account limits.

type Deps = { db: Db; secret: string; now?: () => number };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const gone = (c: Context) => fail(c, 404, "listGone", LIST_GONE);

// The saved events whose pages open: the rule of the public read, counted by one query.
const countOf = async (tx: Tx | Db, userId: string) =>
  (
    await tx
      .select({ n: count() })
      .from(saves)
      .innerJoin(events, eq(events.id, saves.eventId))
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .where(and(eq(saves.userId, userId), openable))
  )[0]!.n;

// Of these, the ones that can be opened.
const openIn = async (tx: Tx | Db, ids: string[]) =>
  ids.length
    ? new Set((await tx.select({ id: events.id }).from(events).innerJoin(hosts, eq(hosts.id, events.hostId)).where(and(inArray(events.id, ids), openable))).map((r) => r.id))
    : new Set<string>();

// The person's row held for the rest of the transaction, so two saves at 999 (or two lists at 49) can't both pass the
// cap check: the second waits here and then counts the first. Every write goes through it, so a remove can't leave a
// listed-but-unsaved event and a delete during a tick can't fail. A deleted account has no row to hold and is told
// it's signed out, as anywhere else.
const SINCE = Date.parse("2026-01-01T00:00:00Z"); // no save is older than Orbit
async function mine<R>(db: Db, c: Context, userId: string, run: (tx: Tx) => Promise<R>): Promise<R | Response> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).for("update");
    return u ? run(tx) : fail(c, 401, "signedOut", "You're signed out. Sign in again.");
  });
}

// One save: "gone" if the event can't be opened, "full" at the cap, else saved (a second save keeps the first time).
async function saveOne(tx: Tx, userId: string, eventId: string, at: Date): Promise<"ok" | "gone" | "full"> {
  if (!(await openIn(tx, [eventId])).size) return "gone";
  const [have] = await tx.select().from(saves).where(and(eq(saves.userId, userId), eq(saves.eventId, eventId)));
  if (have) return "ok";
  if ((await countOf(tx, userId)) >= MAX_SAVED) return "full";
  await tx.insert(saves).values({ userId, eventId, savedAt: at });
  return "ok";
}

const readLists = async (tx: Tx | Db, userId: string): Promise<SavedList[]> => {
  const rows = await tx.select().from(lists).where(eq(lists.userId, userId)).orderBy(desc(lists.touchedAt), asc(lists.id));
  const inside = await tx
    .select({ listId: listEvents.listId, eventId: listEvents.eventId })
    .from(listEvents)
    .innerJoin(events, eq(events.id, listEvents.eventId))
    .innerJoin(hosts, eq(hosts.id, events.hostId))
    .where(and(eq(listEvents.userId, userId), openable));
  return rows.map((l) => ({ id: l.id, name: l.name, events: inside.filter((e) => e.listId === l.id).map((e) => e.eventId), touched: l.touchedAt.toISOString() }));
};

export function savesRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());
  const full = (c: Context) => fail(c, 409, "full", SAVED_FULL);
  const tx = <R,>(c: Context, run: (tx: Tx) => Promise<R>) => mine(db, c, c.var.user.id, run);
  const listOf = (c: Context) => (ListId.safeParse(c.req.param("id")).success ? c.req.param("id")! : null);

  // GET /me/saves: everything the Saved screens draw, in one answer. `saved` and the lists hold only events that can be
  // opened; `events` are their cards (cancelled and link-only ones too, not only the listed).
  app.get("/me/saves", auth, async (c) => {
    const u = c.var.user.id;
    const rows = await db
      .select({ eventId: saves.eventId, at: saves.savedAt })
      .from(saves)
      .innerJoin(events, eq(events.id, saves.eventId))
      .innerJoin(hosts, eq(hosts.id, events.hostId))
      .where(and(eq(saves.userId, u), openable))
      .orderBy(asc(saves.savedAt), asc(saves.eventId));
    const mine = rows.map((r) => r.eventId); // at most the 1,000 cap, so one answer holds every card
    const body: MySaves = {
      saved: rows.map((r) => ({ eventId: r.eventId, at: r.at.toISOString() })),
      lists: await readLists(db, u),
      events: mine.length ? await cards(db, { where: and(inArray(events.id, mine), openable), order: [asc(events.startsAt), asc(events.id)] }) : [],
    };
    return c.json(body);
  });

  // PUT /me/saves/:eventId: idempotent. An event that can't be opened is 404 like any guess.
  app.put("/me/saves/:eventId", auth, async (c) => {
    const id = c.req.param("eventId");
    if (!isUuid(id)) return nothing(c);
    const done = await tx(c, (t) => saveOne(t, c.var.user.id, id, at()));
    if (done instanceof Response) return done;
    return done === "gone" ? nothing(c) : done === "full" ? full(c) : c.body(null, 204);
  });

  // POST /me/saves/remove: gone from All saved and every list at once.
  app.post("/me/saves/remove", auth, async (c) => {
    const b = await parse(c, RemoveSaves);
    if (!b) return invalid(c);
    const u = c.var.user.id;
    const done = await tx(c, async (t) => {
      await t.delete(listEvents).where(and(eq(listEvents.userId, u), inArray(listEvents.eventId, b.eventIds)));
      await t.delete(saves).where(and(eq(saves.userId, u), inArray(saves.eventId, b.eventIds)));
    });
    return done instanceof Response ? done : c.body(null, 204);
  });

  // POST /me/saves/restore: Undo. Back go the saves with their times and their lists; an event that can't be opened any
  // more, a list that's gone and anything past the cap are skipped, and nothing saved since is touched.
  app.post("/me/saves/restore", auth, async (c) => {
    const b = await parse(c, RestoreSaves);
    if (!b) return invalid(c);
    const u = c.var.user.id;
    const done = await tx(c, async (t) => {
      const ok = await openIn(t, [...new Set([...b.saves.map((s) => s.eventId), ...Object.values(b.lists).flat()])]);
      let room = MAX_SAVED - (await countOf(t, u));
      for (const s of b.saves) {
        if (!ok.has(s.eventId) || room <= 0) continue;
        // A time before Orbit or in the future is clamped, so a made-up one can't break the insert or the order.
        const when = new Date(Math.min(Math.max(Date.parse(s.at), SINCE), now()));
        const [added] = await t.insert(saves).values({ userId: u, eventId: s.eventId, savedAt: when }).onConflictDoNothing().returning();
        if (added) room--;
      }
      const have = new Set((await t.select({ id: lists.id }).from(lists).where(eq(lists.userId, u))).map((l) => l.id));
      const saved = new Set((await t.select({ id: saves.eventId }).from(saves).where(eq(saves.userId, u))).map((s) => s.id));
      const rows = Object.entries(b.lists).flatMap(([listId, ids]) => (have.has(listId) ? ids.filter((e) => saved.has(e) && ok.has(e)).map((eventId) => ({ userId: u, listId, eventId })) : []));
      // In chunks, so a big Undo stays under Postgres's limit on bound values per statement.
      for (let i = 0; i < rows.length; i += 5000) await t.insert(listEvents).values(rows.slice(i, i + 5000)).onConflictDoNothing();
    });
    return done instanceof Response ? done : c.body(null, 204);
  });

  // PUT /me/lists/:id {name, create?, eventId?}: renames a list, or with `create` (sent only when a list is made) makes
  // it, with its first event saved first if needed, all or nothing. A rename of a list that's gone (deleted on another
  // phone) is listGone, never a new list. The name is trimmed, 1 to 40 characters as people count them, and no two lists
  // share one, ignoring case.
  app.put("/me/lists/:id", auth, async (c) => {
    const id = listOf(c);
    if (!id) return invalid(c);
    const b = await parse(c, ListBody);
    if (!b) return invalid(c);
    const n = listName(b.name);
    if ("problem" in n) return fail(c, 400, "invalid", n.problem);
    const u = c.var.user.id;
    const out = await tx(c, async (t) => {
      const have = await t.select().from(lists).where(eq(lists.userId, u));
      const exists = have.some((l) => l.id === id);
      if (!exists && !b.create) return { gone: true };
      const other = have.find((l) => l.id !== id && l.name.toLowerCase() === n.name.toLowerCase());
      if (other) return { taken: other.name };
      if (!exists) {
        if (have.length >= MAX_LISTS) return { many: true };
        if (b.eventId) {
          const saved = await saveOne(t, u, b.eventId, at());
          if (saved !== "ok") return { saved };
        }
        await t.insert(lists).values({ userId: u, id, name: n.name, touchedAt: at(), createdAt: at() });
        if (b.eventId) await t.insert(listEvents).values({ userId: u, listId: id, eventId: b.eventId });
      } else await t.update(lists).set({ name: n.name }).where(and(eq(lists.userId, u), eq(lists.id, id)));
      return { list: (await readLists(t, u)).find((l) => l.id === id)! };
    });
    if (out instanceof Response) return out;
    if ("gone" in out) return gone(c);
    if ("taken" in out) return fail(c, 409, "nameTaken", `You already have a list called ${out.taken}`);
    if ("many" in out) return fail(c, 409, "tooMany", LISTS_FULL);
    if ("saved" in out) return out.saved === "gone" ? nothing(c) : full(c);
    return c.json(out.list);
  });

  // DELETE /me/lists/:id: the list only; what's in it stays saved.
  app.delete("/me/lists/:id", auth, async (c) => {
    const id = listOf(c);
    if (!id) return gone(c);
    const del = await tx(c, (t) => t.delete(lists).where(and(eq(lists.userId, c.var.user.id), eq(lists.id, id))).returning({ id: lists.id }));
    if (del instanceof Response) return del;
    return del.length ? c.body(null, 204) : gone(c);
  });

  // PUT /me/lists/:id/events/:eventId: a tick. Saves the event first if it isn't, then adds it and touches the list.
  app.put("/me/lists/:id/events/:eventId", auth, async (c) => {
    const id = listOf(c);
    const eventId = c.req.param("eventId");
    if (!id) return gone(c);
    if (!isUuid(eventId)) return nothing(c);
    const u = c.var.user.id;
    const done = await tx(c, async (t) => {
      const [l] = await t.select().from(lists).where(and(eq(lists.userId, u), eq(lists.id, id)));
      if (!l) return "list";
      const saved = await saveOne(t, u, eventId, at());
      if (saved !== "ok") return saved;
      const [added] = await t.insert(listEvents).values({ userId: u, listId: id, eventId }).onConflictDoNothing().returning();
      if (added) await t.update(lists).set({ touchedAt: at() }).where(and(eq(lists.userId, u), eq(lists.id, id)));
      return "ok";
    });
    if (done instanceof Response) return done;
    return done === "list" ? gone(c) : done === "gone" ? nothing(c) : done === "full" ? full(c) : c.body(null, 204);
  });

  // DELETE /me/lists/:id/events/:eventId: out of the list, still saved.
  app.delete("/me/lists/:id/events/:eventId", auth, async (c) => {
    const id = listOf(c);
    const eventId = c.req.param("eventId");
    if (!id) return gone(c);
    const u = c.var.user.id;
    const [l] = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.userId, u), eq(lists.id, id)));
    if (!l) return gone(c);
    if (isUuid(eventId)) await db.delete(listEvents).where(and(eq(listEvents.userId, u), eq(listEvents.listId, id), eq(listEvents.eventId, eventId)));
    return c.body(null, 204);
  });

  return app;
}

// How many saved an event, from 10 up (Saved doc, P9.3); never who. Suspended and deleted accounts don't count.
// ponytail: counted live, not refreshed daily as the doc says.
export const SAVES_SHOWN_FROM = 10;
export async function savedCount(db: Db, eventId: string, now: Date) {
  const [r] = await db
    .select({ n: count() })
    .from(saves)
    .innerJoin(users, eq(users.id, saves.userId))
    .where(and(eq(saves.eventId, eventId), sql`${users.deletedAt} is null`, sql`not (${users.suspendedAt} is not null and (${users.suspendedUntil} is null or ${users.suspendedUntil} > ${now.toISOString()}::timestamptz))`));
  return r!.n >= SAVES_SHOWN_FROM ? r!.n : null;
}
