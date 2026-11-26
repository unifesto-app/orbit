import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { CONTENT, type ContentAdmin, CONTENT_KEYS, type ContentImage, CONTENT_SHAPES, type ContentShape, isContentKey, ITEM_NAMES, PHOTO_MAX_BYTES, readContent, SaveContent } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { appContent, auditLog, users } from "./db/schema.ts";
import { fail, invalid, parse, signedIn } from "./http.ts";
import { contentImage, dropContent, linkOf, newKey } from "./media.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";

// App content: the words in the app that Orbit writes (ads, help answers, chat chips), kept as one row per list and
// edited in Galaxy's App content page (owner, 19 Nov 2026: "build CMS for Orbit App in galaxy web"). The lists and their
// rules are in contract/src/content.ts. A list nobody has saved reads as its default, so an empty table changes nothing.

export function contentRoutes({ db, secret, media, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const cap = bodyLimit({ maxSize: 32 * 1024, onError: (c) => invalid(c) });
  const rows = () => db.select().from(appContent);
  const valueOf = (all: { key: string; value: unknown }[]) => readContent(Object.fromEntries(all.map((r) => [r.key, r.value])));

  // GET /public/app-content: every list but knowledge (staff's words for Ask Orbit only), for the app. A minute old at most.
  app.get("/public/app-content", async (c) => {
    c.header("cache-control", "public, max-age=60");
    const { knowledge: _, ...lists } = valueOf(await rows());
    return c.json(lists);
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

  // POST /galaxy/app-content/image?shape=strip|wide: one image for an ad strip (4.5:1) or a carousel slide (4:3), from
  // the page's upload button. Never cropped: an off-shape image is refused. Answers its link and top-edge colour.
  const tooBig = "That image is over 5 MB.";
  app.post(
    "/galaxy/app-content/image",
    bodyLimit({ maxSize: PHOTO_MAX_BYTES + 16 * 1024, onError: (c) => fail(c, 413, "tooBig", tooBig) }),
    signedIn(db, secret, now),
    requireFeature(db, now, "platform"),
    async (c) => {
      if (!media) return fail(c, 503, "notSetUp", "Uploads aren't working right now. Try again later.");
      const shape = c.req.query("shape") ?? "";
      if (!Object.hasOwn(CONTENT_SHAPES, shape)) return invalid(c);
      const file = (await c.req.parseBody().catch(() => null))?.image;
      if (!(file instanceof File)) return invalid(c);
      if (file.size > PHOTO_MAX_BYTES) return fail(c, 413, "tooBig", tooBig);
      const image = await contentImage(new Uint8Array(await file.arrayBuffer()), shape as ContentShape);
      if ("error" in image) {
        const size = shape === "strip" ? "1350 × 300" : "1200 × 900";
        if (image.error === "wrongShape") return fail(c, 400, "wrongShape", `That image isn't ${shape === "strip" ? "4.5:1" : "4:3"}. Make it ${size}.`);
        if (image.error === "tooSmall") return fail(c, 400, "tooSmall", `That image is too small to look sharp on a phone. Make it ${size}.`);
        return fail(c, 400, "notImage", "That file isn't an image we can use. Choose a JPG, PNG or WebP.");
      }
      const actorId = c.var.actor.id;
      const key = newKey("content", actorId);
      await media.files.put(key, image.bytes, "image/webp");
      const body: ContentImage = { url: linkOf(media, key), edge: image.edge };
      await db.insert(auditLog).values({ actorId, action: "content.image", data: { url: body.url, shape }, at: new Date(now()) });
      return c.json(body, 201);
    },
  );

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
      const what = ITEM_NAMES[key];
      return fail(c, 400, "invalid", n ? `${what} ${n}: ${i.message}` : i.message);
    }
    // Only images this API made are kept: a link from elsewhere, or no uploads at all, means upload it again.
    const imagesOf = (list: unknown) => (Array.isArray(list) ? list.flatMap((i: { image?: string }) => (i.image ? [i.image] : [])) : []);
    if (key === "ads" || key === "featured") {
      const list = r.data as { image?: string }[];
      const bad = list.findIndex((i) => i.image && !(media && i.image.startsWith(`${media.url}/content/`)));
      if (bad >= 0) return fail(c, 400, "invalid", `${ITEM_NAMES[key]} ${bad + 1}: Upload the image again.`);
    }
    const actorId = c.var.actor.id;
    const stamp = new Date(now()); // to the millisecond, so the ISO string we hand back matches the row exactly
    let before: string[] = [];
    const done = await db.transaction(async (tx) => {
      const [prev] = await tx.select({ value: appContent.value }).from(appContent).where(eq(appContent.key, key));
      before = imagesOf(prev?.value);
      const values = { value: r.data, updatedAt: stamp, updatedBy: actorId };
      const [row] = b.at === null
        ? await tx.insert(appContent).values({ key, ...values }).onConflictDoNothing().returning()
        : await tx.update(appContent).set(values).where(and(eq(appContent.key, key), eq(appContent.updatedAt, new Date(b.at)))).returning();
      if (!row) return false;
      await tx.insert(auditLog).values({ actorId, action: "content.set", data: { key, value: r.data }, at: stamp });
      return true;
    });
    if (!done) return fail(c, 409, "changed", "Someone saved this list since you opened the page. Open it again to see their change.");
    // The images the list no longer uses are deleted, after the save, never on a refused one, and never one another list
    // still shows. A phone that read the list in the last minute may draw that slot's fill colour once instead.
    // ponytail: an image uploaded but never saved stays in the bucket; the orphaned-media sweep (PM T10.5) clears it.
    if (media) {
      const others = await db.select({ value: appContent.value }).from(appContent);
      const kept = new Set([...imagesOf(r.data), ...others.flatMap((o) => imagesOf(o.value))]);
      for (const link of before) if (!kept.has(link)) await dropContent(media, link);
    }
    return c.json({ at: stamp.toISOString() });
  });

  return app;
}
