import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Apply, applyFields, type ApplicationList, type OpeningAdmin, type OpeningCard, type OpeningPage, Opening, proofOf, RESUME_MAX_BYTES, SetApplication } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { applicationEmail } from "./careers-email.ts";
import type { Media } from "./media.ts";
import { proofs } from "./auth/proof.ts";
import { applications, auditLog, openings } from "./db/schema.ts";
import { bucketOf, fail, invalid, ipOf, isUuid, listPage, parse, signedIn, taken } from "./http.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";
import { slugFor } from "./slugs.ts";
import type { Db } from "./db/index.ts";

// Careers (contract/src/careers.ts; owner, 22 Nov 2026: "careers page at heyorbit.in/careers, link to galaxy", "Openings
// + applications"): openings staff write in Galaxy, shown while open, and the applications sent from their pages, with a
// PDF résumé. Résumés sit in the private bucket under resumes/ and are never served by /media: only People holders
// download them, through Galaxy's own route below. Application details are personal, so every staff read is logged.

// Applications from one address an hour, tries that fail included: room for a campus Wi-Fi or a carrier's shared
// address fixing a mistake, not for filling the table.
const PER_HOUR = 10;
const nope = (c: Parameters<typeof fail>[0]) => fail(c, 404, "notFound", "There's nothing here.");

// Privacy Policy: "We keep it while the role is open, and delete it within 12 months of the role closing." So: every
// application over 12 months old whose role isn't open. Applications only arrive while a role is open, so one sent
// before the role closed goes at most 12 months after it closes, and reopening a role can't push that later. Résumé
// first, then the row: a file that won't delete leaves its row for the next run, so nothing is orphaned. A batch where
// no file would go (the bucket down) ends the run rather than trying every row. Returns how many applications went.
// ponytail: a résumé stored by a request that died before its row was written has no row, so this never sees it; the
// orphaned-media sweep (PM T10.5) is where it goes.
const KEEP = 365 * 24 * 3600_000;
export async function pruneApplications(db: Db, media: Media | undefined, now: number): Promise<number> {
  if (!media) return 0; // no bucket, no way to remove files: leave the rows
  const stale = and(ne(openings.status, "open"), lt(applications.createdAt, new Date(now - KEEP)));
  let deleted = 0;
  const skipped: string[] = [];
  for (;;) {
    const rows = await db.select({ id: applications.id, key: applications.resumeKey }).from(applications).innerJoin(openings, eq(applications.openingId, openings.id)).where(and(stale, skipped.length ? notInArray(applications.id, skipped) : undefined)).limit(200);
    if (!rows.length) break;
    const gone: string[] = [];
    for (const r of rows) {
      try {
        await media.files.remove(r.key);
        gone.push(r.id);
      } catch (e) {
        console.error(`[careers] couldn't delete ${r.key}`, e);
        skipped.push(r.id);
      }
    }
    if (!gone.length) break;
    await db.delete(applications).where(inArray(applications.id, gone));
    deleted += gone.length;
  }
  if (deleted) console.log(`[careers] deleted ${deleted} old application${deleted === 1 ? "" : "s"}`);
  return deleted;
}

export function careersRoutes({ db, store, secret, media, proof, mail, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  // As the waitlist (prelaunch.ts): once Turnstile is set up, an apply without a good token is refused, whatever PROOF says.
  const proven = proof ? proofs(proof.turnstile ? { ...proof, enforce: true } : proof, store) : null;
  const cap = bodyLimit({ maxSize: 16 * 1024, onError: (c) => invalid(c) });
  const staff = [signedIn(db, secret, now), requireFeature(db, now, "people")] as const;
  const firstIssue = (r: { error: { issues: { message: string }[] } }) => r.error.issues[0]!.message;
  const audit = (actorId: string, action: string, data: object) => db.insert(auditLog).values({ actorId, action, data, at: new Date(now()) });
  const dropResume = async (key: string) => {
    if (media) await media.files.remove(key).catch((e) => console.error(`[careers] couldn't delete ${key}`, e));
  };

  // ---- public

  app.get("/public/openings", async (c) => {
    c.header("cache-control", "public, max-age=60");
    const rows = await db.select().from(openings).where(eq(openings.status, "open")).orderBy(desc(openings.createdAt), desc(openings.id));
    const list: OpeningCard[] = rows.map((r) => ({ slug: r.slug, title: r.title, team: r.team, place: r.place, kind: r.kind }));
    return c.json({ openings: list });
  });

  // A draft, a closed opening and a missing one look the same.
  app.get("/public/openings/:slug", async (c) => {
    const [r] = await db.select().from(openings).where(eq(openings.slug, c.req.param("slug")));
    if (!r || r.status !== "open") return nope(c);
    c.header("cache-control", "public, max-age=60");
    const body: OpeningPage = { slug: r.slug, title: r.title, team: r.team, place: r.place, kind: r.kind, ...(r.pay ? { pay: r.pay } : {}), about: r.about, does: r.does, needs: r.needs };
    return c.json(body);
  });

  const tooBig = "That file is over 5 MB.";
  app.post("/public/openings/:slug/apply", bodyLimit({ maxSize: RESUME_MAX_BYTES + 32 * 1024, onError: (c) => fail(c, 413, "tooBig", tooBig) }), async (c) => {
    const ip = ipOf(c);
    if ((await store.incr(`apply:${bucketOf(ip)}`, 3_600_000)) > PER_HOUR) return fail(c, 429, "tooMany", "Too many applications from here. Try again in an hour.");
    const body = await c.req.parseBody().catch(() => null);
    if (!body) return invalid(c);
    const token = body.turnstile;
    const r = proven && (await proven.check(typeof token === "string" ? { kind: "web", token } : undefined, proofOf.code));
    if (r === "tooMany") return fail(c, 429, "tooMany", "Too many tries today. Try again tomorrow.");
    if (r) return fail(c, 403, "unproven", "We couldn't check you’re a person. If a content blocker is on, allow this page, then try again.");
    const [opening] = await db.select().from(openings).where(eq(openings.slug, c.req.param("slug")));
    if (!opening || opening.status !== "open") return nope(c);
    const a = Apply.safeParse(applyFields((k) => body[k]));
    if (!a.success) return fail(c, 400, "invalid", firstIssue(a));
    // The résumé is read by its bytes: the declared type and name are the sender's word.
    const file = body.resume;
    const bytes = file instanceof File && file.size <= RESUME_MAX_BYTES ? new Uint8Array(await file.arrayBuffer()) : null;
    if (!bytes || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") return fail(c, 400, "notPdf", "Attach your résumé as a PDF.");
    const exists = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.openingId, opening.id), eq(applications.email, a.data.email)));
    // Already applied: the same 204 as a new one, the first kept, so nobody can learn who applied (as the waitlist).
    const dup = () => c.body(null, 204);
    if (exists.length) return dup();
    if (!media) return fail(c, 503, "notSetUp", "Uploads aren't working right now. Try again later.");
    const key = `resumes/${opening.id}/${randomBytes(16).toString("base64url")}.pdf`;
    await media.files.put(key, bytes, "application/pdf");
    try {
      await db.insert(applications).values({ ...a.data, openingId: opening.id, resumeKey: key, ip: isIP(ip) ? ip : null, createdAt: new Date(now()), updatedAt: new Date(now()) });
    } catch (e) {
      await dropResume(key);
      if (taken(e)) return dup();
      throw e;
    }
    // The confirmation, for a new application only. It never holds up or fails the 204: a send that fails is logged.
    if (mail)
      void Promise.resolve()
        .then(() => mail(a.data.email, applicationEmail({ name: a.data.name, title: opening.title, slug: opening.slug })))
        .catch((e) => console.error(`[mail] application email not sent: ${e instanceof Error ? e.message : String(e)}`));
    return c.body(null, 204);
  });

  // ---- Galaxy, for holders of People

  const adminOf = async (where?: ReturnType<typeof eq>): Promise<OpeningAdmin[]> => {
    const rows = await db.select().from(openings).where(where).orderBy(desc(openings.createdAt), desc(openings.id));
    const sums = await db
      .select({ id: applications.openingId, n: count(), fresh: sql<number>`count(*) filter (where ${applications.status} = 'new')`.mapWith(Number) })
      .from(applications)
      .groupBy(applications.openingId);
    return rows.map((r) => {
      const s = sums.find((x) => x.id === r.id);
      return { id: r.id, slug: r.slug, title: r.title, team: r.team, place: r.place, kind: r.kind, ...(r.pay ? { pay: r.pay } : {}), about: r.about, does: r.does, needs: r.needs, status: r.status, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), applications: s?.n ?? 0, fresh: s?.fresh ?? 0 };
    });
  };

  app.get("/galaxy/openings", ...staff, async (c) => c.json({ openings: await adminOf() }));

  app.get("/galaxy/openings/:id", ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nope(c);
    const [one] = await adminOf(eq(openings.id, id));
    return one ? c.json(one) : nope(c);
  });

  app.post("/galaxy/openings", cap, ...staff, async (c) => {
    const r = Opening.safeParse(await c.req.json().catch(() => null));
    if (!r.success) return fail(c, 400, "invalid", firstIssue(r));
    const stamp = new Date(now());
    const [row] = await db.insert(openings).values({ ...r.data, slug: slugFor(r.data.title, "role"), createdAt: stamp, updatedAt: stamp, updatedBy: c.var.actor.id }).returning({ id: openings.id, slug: openings.slug });
    await audit(c.var.actor.id, "careers.opening.create", { id: row!.id });
    return c.json(row!, 201);
  });

  // The slug is left alone: a link already shared must keep working.
  app.put("/galaxy/openings/:id", cap, ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nope(c);
    const r = Opening.safeParse(await c.req.json().catch(() => null));
    if (!r.success) return fail(c, 400, "invalid", firstIssue(r));
    const stamp = new Date(now());
    const [row] = await db.update(openings).set({ ...r.data, pay: r.data.pay ?? null, updatedAt: stamp, updatedBy: c.var.actor.id }).where(eq(openings.id, id)).returning({ id: openings.id });
    if (!row) return nope(c);
    await audit(c.var.actor.id, "careers.opening.set", { id });
    return c.json({ at: stamp.toISOString() });
  });

  // Only an opening nobody applied to: applications stay with their opening (12-month cleanup, Privacy Policy). The
  // foreign key has no cascade, so an application that lands during the delete fails it (23503) and gets the same 409.
  app.delete("/galaxy/openings/:id", ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nope(c);
    const applied = () => fail(c, 409, "applied", "People have applied to this opening. Close it instead: their applications stay until they're deleted.");
    const [{ n }] = (await db.select({ n: count() }).from(applications).where(eq(applications.openingId, id))) as [{ n: number }];
    if (n) return applied();
    let row: { title: string } | undefined;
    try {
      [row] = await db.delete(openings).where(eq(openings.id, id)).returning({ title: openings.title });
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      if ((err.code ?? err.cause?.code) === "23503") return applied();
      throw e;
    }
    if (!row) return nope(c);
    await audit(c.var.actor.id, "careers.opening.delete", { id, title: row.title });
    return c.body(null, 204);
  });

  app.get("/galaxy/openings/:id/applications", ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nope(c);
    const { page, limit, offset } = listPage(c);
    const rows = await db.select().from(applications).where(eq(applications.openingId, id)).orderBy(desc(applications.createdAt), desc(applications.id)).limit(limit).offset(offset);
    const [{ n }] = (await db.select({ n: count() }).from(applications).where(eq(applications.openingId, id))) as [{ n: number }];
    await audit(c.var.actor.id, "careers.applications.list", { opening: id, page, results: rows.map((r) => r.id) });
    const body: ApplicationList = {
      applications: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        ...(r.phone ? { phone: r.phone } : {}),
        ...(r.linkedin ? { linkedin: r.linkedin } : {}),
        ...(r.link ? { link: r.link } : {}),
        ...(r.note ? { note: r.note } : {}),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      total: n,
      page,
      pageSize: limit,
    };
    return c.json(body);
  });

  app.put("/galaxy/applications/:id", cap, ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nope(c);
    const b = await parse(c, SetApplication);
    if (!b) return invalid(c);
    const [row] = await db.update(applications).set({ status: b.status, updatedAt: new Date(now()), updatedBy: c.var.actor.id }).where(eq(applications.id, id)).returning({ id: applications.id });
    if (!row) return nope(c);
    await audit(c.var.actor.id, "careers.application.status", { id, status: b.status });
    return c.body(null, 204);
  });

  // For someone who asks (Privacy Policy): the application and its résumé, for good.
  app.delete("/galaxy/applications/:id", ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nope(c);
    // The file first, and a failure fails the request: with the row gone, nothing would point at the file to retry.
    // Deleting a file that's already gone is fine, so asking again after a failure works.
    const [row] = await db.select({ key: applications.resumeKey }).from(applications).where(eq(applications.id, id));
    if (!row) return nope(c);
    if (media) await media.files.remove(row.key);
    await db.delete(applications).where(eq(applications.id, id));
    await audit(c.var.actor.id, "careers.application.delete", { id });
    return c.body(null, 204);
  });

  app.get("/galaxy/applications/:id/resume", ...staff, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nope(c);
    const [row] = await db.select({ key: applications.resumeKey, name: applications.name }).from(applications).where(eq(applications.id, id));
    const file = row && media ? await media.files.get(row.key) : null;
    if (!row || !file) return nope(c);
    await audit(c.var.actor.id, "careers.resume.read", { id });
    // ASCII only in the header: a name in another script falls back to "resume".
    const who = row.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "resume";
    return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${who}-resume.pdf"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
  });

  return app;
}
