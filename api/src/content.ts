import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { CONTENT, type ContentAdmin, CONTENT_KEYS, isContentKey, readContent, SaveContent } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { appContent, auditLog, users } from "./db/schema.ts";
import { fail, invalid, parse, signedIn } from "./http.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";

// App content: the words in the app that Orbit writes (ads, help answers, chat chips), kept as one row per list and
// edited in Galaxy's App content page (owner, 19 Nov 2026: "build CMS for Orbit App in galaxy web"). The lists and their
// rules are in contract/src/content.ts. A list nobody has saved reads as its default, so an empty table changes nothing.

export function contentRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const cap = bodyLimit({ maxSize: 32 * 1024, onError: (c) => invalid(c) });
  const rows = () => db.select().from(appContent);
  const valueOf = (all: { key: string; value: unknown }[]) => readContent(Object.fromEntries(all.map((r) => [r.key, r.value])));

  // GET /public/app-content: every list, for the app. A minute old at most.
  app.get("/public/app-content", async (c) => {
    c.header("cache-control", "public, max-age=60");
    return c.json(valueOf(await rows()));
  });

  // GET /galaxy/app-content: what's live, and when and by whom each list was last saved.
  app.get("/galaxy/app-content", signedIn(db, secret, now), requireFeature(db, now, "platform"), async (c) => {
    const all = await db
      .select({ key: appContent.key, value: appContent.value, updatedAt: appContent.updatedAt, by: users.name })
      .from(appContent)
      .leftJoin(users, eq(users.id, appContent.updatedBy));
    const saved = Object.fromEntries(
      CONTENT_KEYS.map((k) => {
        const r = all.find((x) => x.key === k);
        return [k, r ? { at: r.updatedAt.toISOString(), by: r.by } : null];
      }),
    ) as ContentAdmin["saved"];
    const body: ContentAdmin = { content: valueOf(all), saved };
    return c.json(body);
  });

  // PUT /galaxy/app-content/:key: replace one whole list. `at` is when the page read it (null if never saved); a list
  // saved by someone else since is refused with 409, so two staff can't silently undo each other.
  app.put("/galaxy/app-content/:key", cap, signedIn(db, secret, now), requireFeature(db, now, "platform"), async (c) => {
    const key = c.req.param("key");
    if (!isContentKey(key)) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, SaveContent);
    if (!b) return invalid(c);
    const r = CONTENT[key].safeParse(b.value);
    if (!r.success) {
      // One line: the first problem, led by where it is ("Ad 2: …", "Question 1: …").
      const i = r.error.issues[0]!;
      const n = typeof i.path[0] === "number" ? i.path[0] + 1 : null;
      const what = { ads: "Ad", help: "Question", asks: "Chip" }[key];
      return fail(c, 400, "invalid", n ? `${what} ${n}: ${i.message}` : i.message);
    }
    const actorId = c.var.actor.id;
    const stamp = new Date(now()); // to the millisecond, so the ISO string we hand back matches the row exactly
    const done = await db.transaction(async (tx) => {
      const values = { value: r.data, updatedAt: stamp, updatedBy: actorId };
      const [row] = b.at === null
        ? await tx.insert(appContent).values({ key, ...values }).onConflictDoNothing().returning()
        : await tx.update(appContent).set(values).where(and(eq(appContent.key, key), eq(appContent.updatedAt, new Date(b.at)))).returning();
      if (!row) return false;
      await tx.insert(auditLog).values({ actorId, action: "content.set", data: { key, value: r.data }, at: stamp });
      return true;
    });
    if (!done) return fail(c, 409, "changed", "Someone saved this list since you opened the page. Open it again to see their change.");
    return c.json({ at: stamp.toISOString() });
  });

  return app;
}
