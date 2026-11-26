import { and, desc, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { DecideReport, NewReport, REPORTS_PER_DAY, ReportStatus, type StaffReport, type StaffReportDetail } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { auditLog, events, hosts, reports, users } from "./db/schema.ts";
import { openable } from "./events/public.ts";
import { fail, invalid, isUuid, parse, signedIn } from "./http.ts";
import { masked, onHost, requireFeature, type StaffEnv } from "./roles/access.ts";

// Reports (orbit-pm X15, contract/src/reports.ts): a person flags an event or a host from its page in the app; holders of
// Queues resolve or dismiss them in Galaxy. Acting on the event or host (unpublish, cancel, suspend) happens on its own
// Galaxy page, so a decision here only closes the report. Staff never see or decide a report on a host they're on (or
// an event of one), as on every other Galaxy host action (onHost).

const DAY = 24 * 3600_000;
const LIST_MAX = 200;
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const ownHost = (c: Context) =>
  fail(c, 403, "ownHost", "Staff never act on a host they're on, invited to or left in the last 30 days. Ask another staff member with this access.");
type Row = typeof reports.$inferSelect;

// Open reports on the same event or host as this row, itself included while it's open.
const openOnSubject = sql<number>`(select count(*)::int from reports r2 where r2.status = 'open' and (r2.event_id = ${reports.eventId} or r2.host_id = ${reports.hostId}))`;
const columns = {
  r: reports,
  u: users,
  openOnSubject,
  eventSlug: events.slug,
  eventTitle: events.title,
  eventHost: events.hostId,
  hostSlug: hosts.slug,
  hostName: hosts.name,
};
type Joined = { r: Row; u: typeof users.$inferSelect; openOnSubject: number; eventSlug: string | null; eventTitle: string | null; eventHost: string | null; hostSlug: string | null; hostName: string | null };

// The host a report is about: its own, or its event's.
const hostOf = (x: Joined) => (x.r.hostId ?? x.eventHost)!;

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
    // The partial unique indexes keep one open report per person per subject, even for two sent at once. The open one
    // that blocked the insert may be decided before it's read: then the insert is tried once more.
    for (let tries = 0; tries < 2; tries++) {
      const [made] = await db
        .insert(reports)
        .values({ userId, eventId: b.eventId ?? null, hostId: b.hostId ?? null, reason: b.reason, note: b.note || null, createdAt: at() })
        .onConflictDoNothing()
        .returning({ id: reports.id });
      if (made) return c.json({ id: made.id }, 201);
      const [have] = await db.select({ id: reports.id }).from(reports).where(and(eq(reports.userId, userId), eq(reports.status, "open"), subject));
      if (have) return c.json({ id: have.id });
    }
    return fail(c, 409, "busy", "That didn't go through. Try again.");
  });

  // ---------- Galaxy: Queues ----------
  const joined = () =>
    db
      .select(columns)
      .from(reports)
      .innerJoin(users, eq(users.id, reports.userId))
      .leftJoin(events, eq(events.id, reports.eventId))
      .leftJoin(hosts, eq(hosts.id, reports.hostId));

  // One report, or null when it's missing or on a host the viewer is on.
  const detail = async (c: Context<StaffEnv>, id: string): Promise<StaffReportDetail | null> => {
    const [x] = await joined().where(eq(reports.id, id));
    if (!x || (await onHost(db, hostOf(x), c.var.user, now()))) return null;
    const [by] = x.r.decidedBy ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, x.r.decidedBy)) : [];
    return { ...toStaff(x), staffNote: x.r.staffNote, decidedBy: by ?? null, decidedAt: x.r.decidedAt?.toISOString() ?? null };
  };

  // GET /galaxy/reports?status=: newest first, 200 at most. Default: open.
  // Reports on a host the viewer is on are left out, so a page may hold fewer than 200.
  // ponytail: one page of 200 and an onHost read per host on it; page it (listPage) when the queue grows past that.
  app.get("/galaxy/reports", auth, queues, async (c) => {
    const status = ReportStatus.safeParse(c.req.query("status") ?? "open");
    if (!status.success) return invalid(c);
    const rows = await joined().where(eq(reports.status, status.data)).orderBy(desc(reports.createdAt), desc(reports.id)).limit(LIST_MAX);
    const mine = new Map<string, boolean>();
    for (const h of new Set(rows.map(hostOf))) mine.set(h, await onHost(db, h, c.var.user, now()));
    return c.json({ reports: rows.filter((x) => !mine.get(hostOf(x))).map(toStaff) });
  });

  app.get("/galaxy/reports/:id", auth, queues, async (c) => {
    const id = c.req.param("id");
    const r = isUuid(id) ? await detail(c, id) : null;
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
      const [x] = await joined().where(eq(reports.id, id));
      if (!x) return nothing(c);
      if (await onHost(db, hostOf(x), c.var.user, now())) return ownHost(c);
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
      return c.json(await detail(c, id));
    });

  return app;
}
