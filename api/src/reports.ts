import { and, desc, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { DecideReport, NewReport, REPORTS_PER_DAY, ReportStatus, type StaffReport, type StaffReportDetail } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { auditLog, events, hosts, reports, users } from "./db/schema.ts";
import { openable } from "./events/public.ts";
import { fail, invalid, isUuid, parse, signedIn } from "./http.ts";
import { masked, requireFeature, type StaffEnv } from "./roles/access.ts";

// Reports (orbit-pm X15, contract/src/reports.ts): a person flags an event or a host from its page in the app; holders of
// Queues resolve or dismiss them in Galaxy. Acting on the event or host (unpublish, cancel, suspend) happens on its own
// Galaxy page, so a decision here only closes the report.

const DAY = 24 * 3600_000;
const LIST_MAX = 200;
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
type Row = typeof reports.$inferSelect;

// Open reports on the same event or host as this row, itself included while it's open.
const openOnSubject = sql<number>`(select count(*)::int from reports r2 where r2.status = 'open' and (r2.event_id = ${reports.eventId} or r2.host_id = ${reports.hostId}))`;
const columns = {
  r: reports,
  u: users,
  openOnSubject,
  eventSlug: events.slug,
  eventTitle: events.title,
  hostSlug: hosts.slug,
  hostName: hosts.name,
};
type Joined = { r: Row; u: typeof users.$inferSelect; openOnSubject: number; eventSlug: string | null; eventTitle: string | null; hostSlug: string | null; hostName: string | null };

const toStaff = (x: Joined): StaffReport => {
  const m = masked(x.u);
  return {
    id: x.r.id,
    status: x.r.status,
    reason: x.r.reason,
    note: x.r.note,
    createdAt: x.r.createdAt.toISOString(),
    subject: x.r.eventId ? { kind: "event", id: x.r.eventId, slug: x.eventSlug!, name: x.eventTitle! } : { kind: "host", id: x.r.hostId!, slug: x.hostSlug!, name: x.hostName! },
    reporter: { id: m.id, name: m.name, phone: m.phone, email: m.email },
    openOnSubject: x.openOnSubject,
  };
};

export function reportsRoutes({ db, store, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const queues = requireFeature(db, now, "queues");
  const at = () => new Date(now());

  // POST /reports {eventId | hostId, reason, note?}: {id}. Events: only ones whose page opens; hosts: any that exists.
  // A second report on the same subject while the first is open answers with the first.
  app.post("/reports", auth, async (c) => {
    const b = await parse(c, NewReport);
    if (!b) return invalid(c);
    const userId = c.var.user.id;
    // Every valid try counts, a 404 too, so the limit also stops guessing at subjects.
    if ((await store.incr(`report:${userId}`, DAY)) > REPORTS_PER_DAY) return fail(c, 429, "tooMany", "You've sent a lot of reports today. Try again tomorrow.");
    const [found] = b.eventId
      ? await db.select({ id: events.id }).from(events).innerJoin(hosts, eq(hosts.id, events.hostId)).where(and(eq(events.id, b.eventId), openable))
      : await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, b.hostId!));
    if (!found) return nothing(c);
    const subject = b.eventId ? eq(reports.eventId, b.eventId) : eq(reports.hostId, b.hostId!);
    // The partial unique indexes keep one open report per person per subject, even for two sent at once.
    const [made] = await db
      .insert(reports)
      .values({ userId, eventId: b.eventId ?? null, hostId: b.hostId ?? null, reason: b.reason, note: b.note || null, createdAt: at() })
      .onConflictDoNothing()
      .returning({ id: reports.id });
    if (made) return c.json({ id: made.id }, 201);
    const [have] = await db.select({ id: reports.id }).from(reports).where(and(eq(reports.userId, userId), eq(reports.status, "open"), subject));
    return c.json({ id: have!.id });
  });

  // ---------- Galaxy: Queues ----------
  const joined = () =>
    db
      .select(columns)
      .from(reports)
      .innerJoin(users, eq(users.id, reports.userId))
      .leftJoin(events, eq(events.id, reports.eventId))
      .leftJoin(hosts, eq(hosts.id, reports.hostId));

  const detail = async (id: string): Promise<StaffReportDetail | null> => {
    const [x] = await joined().where(eq(reports.id, id));
    if (!x) return null;
    const [by] = x.r.decidedBy ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, x.r.decidedBy)) : [];
    return { ...toStaff(x), staffNote: x.r.staffNote, decidedBy: by ?? null, decidedAt: x.r.decidedAt?.toISOString() ?? null };
  };

  // GET /galaxy/reports?status=: newest first, 200 at most. Default: open.
  // ponytail: one page of 200; page it (listPage) when the queue grows past that.
  app.get("/galaxy/reports", auth, queues, async (c) => {
    const status = ReportStatus.safeParse(c.req.query("status") ?? "open");
    if (!status.success) return invalid(c);
    const rows = await joined().where(eq(reports.status, status.data)).orderBy(desc(reports.createdAt), desc(reports.id)).limit(LIST_MAX);
    return c.json({ reports: rows.map(toStaff) });
  });

  app.get("/galaxy/reports/:id", auth, queues, async (c) => {
    const id = c.req.param("id");
    const r = isUuid(id) ? await detail(id) : null;
    return r ? c.json(r) : nothing(c);
  });

  // Resolve or dismiss: open reports only, one decision each, logged.
  for (const action of ["resolve", "dismiss"] as const)
    app.post(`/galaxy/reports/:id/${action}`, auth, queues, async (c) => {
      const b = await parse(c, DecideReport);
      if (!b) return invalid(c);
      const id = c.req.param("id");
      if (!isUuid(id)) return nothing(c);
      const actor = c.var.actor.id;
      const done = await db.transaction(async (tx) => {
        const [r] = await tx.select().from(reports).where(eq(reports.id, id)).for("update");
        if (!r) return "missing" as const;
        if (r.status !== "open") return "decided" as const;
        await tx
          .update(reports)
          .set({ status: action === "resolve" ? "resolved" : "dismissed", staffNote: b.note || null, decidedBy: actor, decidedAt: at() })
          .where(eq(reports.id, id));
        await tx.insert(auditLog).values({ actorId: actor, action: `reports.${action}`, targetHost: r.hostId, reason: b.note || null, data: { reportId: id, eventId: r.eventId }, at: at() });
        return "ok" as const;
      });
      if (done === "missing") return nothing(c);
      if (done === "decided") return fail(c, 409, "decided", "That report has already been dealt with.");
      return c.json(await detail(id));
    });

  return app;
}
