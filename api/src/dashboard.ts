import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { STAFF_FEATURES, type DashboardStats, type DayCount, type StaffFeature } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { activeCounts, bookingWeeks, checkInCounts, revenueWeeks } from "./analytics.ts";
import { auditLog } from "./db/schema.ts";
import { signedIn } from "./http.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";
import { holds } from "./roles/rules.ts";

// Galaxy's Dashboard (owner, 19 Nov 2026: "remove all in dashboard page", "add Analytics, Traction and all"). One read
// for any staff; each block only if they hold the feature that owns it, and only those blocks are worked out.
// Days are India's (IST, a fixed UTC+5:30), as on the Website page.
const DAY = 86_400_000;
const IST = 330 * 60_000;
const ist = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
const istMidnight = (ms: number) => ms - ((ms + IST) % DAY); // the last IST midnight, as a UTC time

export function dashboardRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();

  app.get("/galaxy/dashboard", signedIn(db, secret, now), requireFeature(db, now, ...STAFF_FEATURES), async (c) => {
    const at = now(); // one clock for the whole answer
    const actor = c.var.actor;
    const has = (f: StaffFeature) => holds(actor, f);
    const ts = (ms: number) => sql`${new Date(ms).toISOString()}::timestamptz`; // a raw template doesn't map a Date for the driver
    const today = ts(istMidnight(at));
    const week = ts(istMidnight(at) - 6 * DAY);
    const prev = ts(istMidnight(at) - 13 * DAY);
    const from30 = ts(istMidnight(at) - 29 * DAY);
    const one = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as T[])[0]!;
    const many = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

    // Sign-ups of a table by created_at: totals, the week against the one before, and 30 days with the gaps filled.
    const counts = async (table: ReturnType<typeof sql>, where: ReturnType<typeof sql>) => {
      const t = await one<{ total: number; today: number; week: number; prev: number }>(
        sql`select count(*)::int as total, (count(*) filter (where created_at >= ${today}))::int as today, (count(*) filter (where created_at >= ${week}))::int as week, (count(*) filter (where created_at >= ${prev} and created_at < ${week}))::int as prev from ${table} where ${where}`,
      );
      const rows = await many<{ day: string; count: number }>(
        sql`select to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, count(*)::int as count from ${table} where ${where} and created_at >= ${from30} group by 1`,
      );
      const byDay = new Map(rows.map((r) => [r.day, r.count]));
      const days: DayCount[] = Array.from({ length: 30 }, (_, i) => {
        const day = ist(at - (29 - i) * DAY);
        return { day, count: byDay.get(day) ?? 0 };
      });
      return { total: t.total, today: t.today, week: t.week, prevWeek: t.prev, days };
    };

    // One query at a time: all at once would hold every pooled connection.
    const body: DashboardStats = {};
    if (has("people")) {
      body.people = {
        ...(await counts(sql`users`, sql`deleted_at is null`)),
        // As Analytics counts: distinct people in the activity log, today, the last 7 IST days, the last 30.
        active: await activeCounts(db, at),
      };
      body.waitlist = await counts(sql`interest`, sql`true`);
      // As the Website page counts: a visitor is a visitor-day, a join is a visitor-day with the joined step.
      body.website = await one(
        sql`select count(distinct (visitor, (at at time zone 'Asia/Kolkata')::date))::int as visitors, count(*)::int as views, (count(distinct (visitor, (at at time zone 'Asia/Kolkata')::date)) filter (where joined))::int as joined from visit where at >= ${week}`,
      );
    }
    if (has("hosts")) {
      body.hosts = await one(
        sql`select count(*)::int as total, (count(*) filter (where verified_at is not null))::int as verified, (count(*) filter (where created_at >= ${week}))::int as week, (select count(*) from follows f join hosts h on h.id = f.host_id where h.status <> 'archived')::int as follows from hosts where status <> 'archived'`,
      );
      body.events = await one(
        sql`select (count(*) filter (where status = 'published' and starts_at >= ${ts(at)}))::int as upcoming, (count(*) filter (where published_at >= ${week}))::int as week, (count(*) filter (where status = 'draft'))::int as drafts, (count(*) filter (where status = 'cancelled'))::int as cancelled from events`,
      );
      // As Analytics counts them (analytics.ts): confirmed ticket bookings, and the 30-day check-in rate.
      body.bookings = { ...(await bookingWeeks(db, at)), checkInRate: (await checkInCounts(db, at)).rate };
    }
    if (has("money")) body.revenue = await revenueWeeks(db, at);
    if (has("staff")) {
      // The same test as activeFeatures (started, not ended), plus the platform owner whether or not they hold a grant.
      body.staff = await one(
        sql`select count(*)::int as active from (select user_id from staff_grants where ended_at is null and starts_at is not null and starts_at <= ${ts(at)} union select id from users where platform_owner and deleted_at is null) p`,
      );
    }

    await db.insert(auditLog).values({ actorId: actor.id, action: "dashboard.view", data: { blocks: Object.keys(body) }, at: new Date(at) });
    return c.json(body satisfies DashboardStats);
  });

  return app;
}
