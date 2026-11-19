import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { type AnalyticsStats, PLATFORMS, type Platform } from "@orbit/contract";
import { istDay } from "./activity.ts";
import type { Deps } from "./auth/routes.ts";
import type { Db } from "./db/index.ts";
import { auditLog } from "./db/schema.ts";
import { signedIn } from "./http.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";

// Galaxy's Analytics reading side (owner, 19 Nov 2026: "user analytics, mau, dau etc", "app analytics and more"). The
// numbers come from the activity log (activity.ts), kept "90 days", then summed into activityDays by sweepActivity.
// Days are India's (IST, a fixed UTC+5:30), as on the Dashboard.
const DAY = 86_400_000;
const IST = 330 * 60_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`); // an IST day's label as a UTC time, for counting days
const addDays = (day: string, n: number) => new Date(dayMs(day) + n * DAY).toISOString().slice(0, 10);

type Tally = { name: string; count: number }[];
const byCount = (a: { name: string; count: number }, b: { name: string; count: number }) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const many = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

/** The one definition of "active": distinct people (accounts not deleted) in the activity log today, in the last 7 IST days, in the last 30. */
export async function activeCounts(db: Db, at: number) {
  const today = istDay(at);
  const [r] = await many<{ day: number; week: number; month: number }>(
    db,
    sql`select (count(distinct a.user_id) filter (where a.day = ${today}::date))::int as day, (count(distinct a.user_id) filter (where a.day >= ${addDays(today, -6)}::date))::int as week, (count(distinct a.user_id) filter (where a.day >= ${addDays(today, -29)}::date))::int as month from activity a join users u on u.id = a.user_id where u.deleted_at is null and a.day >= ${addDays(today, -29)}::date`,
  );
  return r!;
}

export function analyticsRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();

  app.get("/galaxy/analytics", signedIn(db, secret, now), requireFeature(db, now, "people"), async (c) => {
    const at = now(); // one clock for the whole answer
    const today = istDay(at);
    const from30 = addDays(today, -29);
    const from7 = addDays(today, -6);
    const ts = (ms: number) => sql`${new Date(ms).toISOString()}::timestamptz`; // a raw template doesn't map a Date for the driver
    // One query at a time, as the Dashboard does: all at once would hold every pooled connection.

    // Since: the first day anyone was counted, in the log or in the kept totals.
    const [first] = await many<{ day: string | null }>(
      db,
      sql`select to_char(least((select min(day) from activity), (select min(day) from activity_days)), 'YYYY-MM-DD') as day`,
    );

    const active = await activeCounts(db, at);

    const perDay = await many<{ day: string; active: number; new: number }>(
      db,
      sql`select to_char(a.day, 'YYYY-MM-DD') as day, count(distinct a.user_id)::int as active, (count(distinct a.user_id) filter (where (u.created_at at time zone 'Asia/Kolkata')::date = a.day))::int as new from activity a join users u on u.id = a.user_id where u.deleted_at is null and a.day >= ${from30}::date group by a.day`,
    );
    const dayRow = new Map(perDay.map((r) => [r.day, r]));
    const days = Array.from({ length: 30 }, (_, i) => {
      const day = addDays(from30, i);
      const r = dayRow.get(day);
      return { day, active: r?.active ?? 0, new: r?.new ?? 0, returning: (r?.active ?? 0) - (r?.new ?? 0) };
    });

    const plat = await many<{ platform: Platform; count: number }>(
      db,
      sql`select a.platform, count(distinct a.user_id)::int as count from activity a join users u on u.id = a.user_id where u.deleted_at is null and a.day >= ${from30}::date group by a.platform`,
    );
    const platforms: Tally = plat.map((r) => ({ name: PLATFORMS[r.platform], count: r.count })).sort(byCount);

    const vers = await many<{ platform: "ios" | "android"; version: string; count: number }>(
      db,
      sql`select a.platform, a.version, count(distinct a.user_id)::int as count from activity a join users u on u.id = a.user_id where u.deleted_at is null and a.day >= ${from7}::date and a.platform in ('ios', 'android') and a.version is not null group by a.platform, a.version`,
    );
    const versions: Tally = vers.map((r) => ({ name: `${PLATFORMS[r.platform]} ${r.version}`, count: r.count })).sort(byCount);

    // Retention: the last 8 full weeks (Monday to Sunday). ponytail: the cohorts' sign-ups and every activity row of theirs
    // since (up to about 62 days of person-day-platform rows) are loaded and counted here on each view; fine for a few
    // thousand sign-ups a week, past that move it to one SQL count(distinct) grouped by cohort week and weeks after.
    const monday = addDays(today, -((new Date(dayMs(today)).getUTCDay() + 6) % 7)); // this week's Monday
    const firstWeek = addDays(monday, -56);
    const signups = await many<{ id: string; day: string }>(
      db,
      sql`select id, to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day from users where deleted_at is null and (created_at at time zone 'Asia/Kolkata')::date >= ${firstWeek}::date and (created_at at time zone 'Asia/Kolkata')::date < ${monday}::date`,
    );
    const seen = await many<{ user_id: string; day: string }>(
      db,
      sql`select a.user_id, to_char(a.day, 'YYYY-MM-DD') as day from activity a join users u on u.id = a.user_id where u.deleted_at is null and a.day >= ${addDays(firstWeek, 7)}::date and (u.created_at at time zone 'Asia/Kolkata')::date >= ${firstWeek}::date and (u.created_at at time zone 'Asia/Kolkata')::date < ${monday}::date`,
    );
    const weekOf = (day: string) => Math.floor((dayMs(day) - dayMs(firstWeek)) / (7 * DAY)); // 0..7 for a sign-up, more for activity
    const cohort = new Map(signups.map((s) => [s.id, weekOf(s.day)]));
    const size = Array<number>(8).fill(0);
    for (const w of cohort.values()) size[w]!++;
    const back = Array.from({ length: 8 }, () => Array.from({ length: 4 }, () => new Set<string>()));
    for (const r of seen) {
      const w = cohort.get(r.user_id)!;
      const k = weekOf(r.day) - w - 1; // 0 = the week after sign-up
      if (k >= 0 && k < 4) back[w]![k]!.add(r.user_id);
    }
    const retention = Array.from({ length: 8 }, (_, w) => {
      const start = addDays(firstWeek, 7 * w);
      return {
        week: start,
        size: size[w]!,
        // null until the (k+1)th week after has fully ended (its next IST midnight has passed), for an empty cohort, or for
        // a week that began before the log did: unknown, never 0%.
        weeks: Array.from({ length: 4 }, (_, k) =>
          size[w] && dayMs(addDays(start, 7 * (k + 2))) - IST <= at && !!first?.day && addDays(start, 7 * (k + 1)) >= first.day
            ? Math.round((back[w]![k]!.size / size[w]!) * 100) / 100
            : null,
        ),
      };
    });

    const ins = await many<{ via: "phone" | "email" | "google" | "apple" | "passkey"; count: number }>(
      db,
      // Not Galaxy's own sign-ins (its sessions are named "Galaxy · …"): staff at work aren't people using Orbit. Each
      // session's latest check: a later step-up code replaces how it began.
      sql`select fresh_via as via, count(*)::int as count from sessions where created_at >= ${ts(at - 30 * DAY)} and fresh_via is not null and name not like 'Galaxy%' group by fresh_via`,
    );
    const VIA = { phone: "Phone code", email: "Email code", google: "Google", apple: "Apple", passkey: "Passkey" } as const;
    const signIns: Tally = ins.map((r) => ({ name: VIA[r.via], count: r.count })).sort(byCount);

    const [w] = await many<{ phone: number; email: number; google: number; apple: number; passkey: number }>(
      db,
      sql`select (count(*) filter (where phone is not null))::int as phone, (count(*) filter (where email is not null))::int as email, (count(*) filter (where exists (select 1 from identities i where i.user_id = users.id and i.provider = 'google')))::int as google, (count(*) filter (where exists (select 1 from identities i where i.user_id = users.id and i.provider = 'apple')))::int as apple, (count(*) filter (where exists (select 1 from passkeys p where p.user_id = users.id)))::int as passkey from users where deleted_at is null`,
    );
    const ways: Tally = [
      { name: "Phone", count: w!.phone },
      { name: "Email", count: w!.email },
      { name: "Google", count: w!.google },
      { name: "Apple", count: w!.apple },
      { name: "Passkey", count: w!.passkey },
    ];

    // Age on today's IST date; no dob is "Not given". All six bands are kept so the order never changes.
    const [a] = await many<Record<"u18" | "a18" | "a25" | "a35" | "a45" | "none", number>>(
      db,
      sql`select (count(*) filter (where age < 18))::int as u18, (count(*) filter (where age between 18 and 24))::int as a18, (count(*) filter (where age between 25 and 34))::int as a25, (count(*) filter (where age between 35 and 44))::int as a35, (count(*) filter (where age >= 45))::int as a45, (count(*) filter (where age is null))::int as none from (select extract(year from age(${today}::date, dob))::int as age from users where deleted_at is null) x`,
    );
    const ages: Tally = [
      { name: "Under 18", count: a!.u18 },
      { name: "18–24", count: a!.a18 },
      { name: "25–34", count: a!.a25 },
      { name: "35–44", count: a!.a35 },
      { name: "45+", count: a!.a45 },
      { name: "Not given", count: a!.none },
    ];

    // The app's four choices (app/src/app/account/edit.tsx); anything else typed in through the API is "Other", so no
    // one's own words reach this page.
    const g = await many<{ name: string; count: number }>(
      db,
      sql`select case when gender is null then 'Not given' when gender in ('Woman', 'Man', 'Non-binary', 'Rather not say') then gender else 'Other' end as name, count(*)::int as count from users where deleted_at is null group by 1`,
    );
    const genders: Tally = g.sort(byCount);

    const ct = await many<{ name: string; count: number }>(db, sql`select city as name, count(*)::int as count from users where deleted_at is null and city is not null group by city`);
    const sorted = ct.sort(byCount);
    const rest = sorted.slice(10).reduce((n, r) => n + r.count, 0);
    const cities: Tally = rest ? [...sorted.slice(0, 10), { name: "Others", count: rest }] : sorted;

    const [f] = await many<{ people: number; following: number; total: number }>(
      db,
      sql`select count(*)::int as people, (count(*) filter (where exists (select 1 from follows f where f.user_id = users.id)))::int as following, (select count(*) from follows f join users u on u.id = f.user_id where u.deleted_at is null)::int as total from users where deleted_at is null`,
    );
    const follows = { people: f!.people, following: f!.following, average: f!.people ? Math.round((f!.total / f!.people) * 100) / 100 : 0 };

    const [d] = await many<{ pending: number; month: number }>(
      db,
      sql`select (count(*) filter (where deletion_due_at is not null and deleted_at is null))::int as pending, (count(*) filter (where deleted_at >= ${ts(at - 30 * DAY)}))::int as month from users`,
    );

    await db.insert(auditLog).values({ actorId: c.var.actor.id, action: "analytics.view", data: {}, at: new Date(at) });
    const body: AnalyticsStats = {
      since: first?.day ?? null,
      active,
      days,
      platforms,
      versions,
      retention,
      signIns,
      ways,
      ages,
      genders,
      cities,
      follows,
      deletions: d!,
    };
    return c.json(body satisfies AnalyticsStats);
  });

  return app;
}

/** The 90-day rule (owner, 19 Nov 2026: "90 days"): each older day's totals go to activity_days, then its rows go, in one transaction. */
export async function sweepActivity(db: Db, now: number) {
  const keepFrom = addDays(istDay(now), -89); // today and the 89 days before it are kept: 90 days
  await db.transaction(async (tx) => {
    // Any row left by a request that raced its account's deletion goes now, before it could be counted.
    await tx.execute(sql`delete from activity a using users u where u.id = a.user_id and u.deleted_at is not null`);
    await tx.execute(
      sql`insert into activity_days (day, active, ios, android, web, app) select day, count(distinct user_id)::int, (count(distinct user_id) filter (where platform = 'ios'))::int, (count(distinct user_id) filter (where platform = 'android'))::int, (count(distinct user_id) filter (where platform = 'web'))::int, (count(distinct user_id) filter (where platform = 'app'))::int from activity where day < ${keepFrom}::date group by day on conflict do nothing`,
    );
    await tx.execute(sql`delete from activity where day < ${keepFrom}::date`);
  });
}
