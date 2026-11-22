import { createHmac, randomBytes } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deviceOf, PAGES, sourceOf, VisitHit, type SiteStats, type Tally } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import type { Db } from "./db/index.ts";
import { auditLog, visit } from "./db/schema.ts";
import { bucketOf, fail, invalid, ipOf, parse, signedIn } from "./http.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";

// The site's own visit log (contract/src/visit.ts): the web's server posts what a browser did on a page, Galaxy reads the
// sums. A row keeps only what the sums use: the page, a source name, app and system names, Cloudflare's place, times
// and steps. No address, raw browser string or link is stored. The visitor is a code over the address's network and the
// browser string, keyed by a salt that is random each IST day and deleted after it, so the code can't be remade later.
const DAY = 86_400_000;
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python|go-http|java\//i;
const PER_MINUTE = 120; // a page sends up to three hits; room for a shared Wi-Fi
const KEEP = 12;
export const ist = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10); // India's date (IST is a fixed UTC+5:30)

// Folds everything past the first KEEP rows into one "Others" row.
export const top = <T extends { name: string }>(all: T[], sum: (rest: T[]) => Omit<T, "name">): T[] =>
  all.length > KEEP ? [...all.slice(0, KEEP), { name: "Others", ...sum(all.slice(KEEP)) } as T] : all;

// Marks a step on a view made in the last day. Never throws: a log must not hold up a join. "applied" only marks an
// opening's page, the one the Apply form is on, so an applicant can't flag any other view of theirs.
export async function markVisit(db: Db, id: string | undefined, step: "code" | "joined" | "applied", now: number) {
  if (!id) return;
  try {
    await db
      .update(visit)
      .set({ [step]: true })
      .where(and(eq(visit.id, id), gte(visit.at, new Date(now - DAY)), step === "applied" ? eq(visit.path, "/careers/[slug]") : undefined));
  } catch (e) {
    console.error(`[visit] ${step} not marked: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function visitRoutes({ db, store, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const cap = bodyLimit({ maxSize: 4 * 1024, onError: (c) => invalid(c) });

  // Today's salt, made on the first visit of the (IST) day and kept until an hour after that day ends.
  // ponytail: two first visits racing at midnight may each make a salt, so a visitor can count twice that day.
  const saltFor = async (t: number) => {
    const key = `visit:salt:${ist(t)}`;
    let salt = await store.get(key);
    if (!salt) {
      await store.set(key, randomBytes(32).toString("hex"), DAY - ((t + 330 * 60_000) % DAY) + 3600_000);
      salt = (await store.get(key))!;
    }
    return salt;
  };

  // POST /public/visit: 204 whatever happened (a bot, an unknown view), so the browser learns nothing.
  app.post("/public/visit", cap, async (c) => {
    const ip = ipOf(c);
    if ((await store.incr(`visit:${bucketOf(ip)}`, 60_000)) > PER_MINUTE) return fail(c, 429, "tooMany", "Too many tries. Wait a minute.");
    const b = await parse(c, VisitHit);
    if (!b) return invalid(c);
    const t = now();
    const recent = and(eq(visit.id, b.id), gte(visit.at, new Date(t - DAY)));
    if (b.kind === "view") {
      if (!b.userAgent || BOT.test(b.userAgent)) return c.body(null, 204); // a browser always says what it is
      const visitor = createHmac("sha256", await saltFor(t)).update(`${bucketOf(ip)}|${b.userAgent ?? ""}`).digest("base64url").slice(0, 22);
      const { app: appName, os } = deviceOf(b.userAgent);
      await db
        .insert(visit)
        .values({
          id: b.id,
          at: new Date(t),
          visitor,
          path: b.path,
          source: sourceOf({ referrer: b.referrer, utm: b.utm, userAgent: b.userAgent }),
          app: appName,
          os,
          country: b.country,
          region: b.region,
          city: b.city,
        })
        .onConflictDoNothing({ target: visit.id });
    } else if (b.kind === "leave") {
      // The largest time wins (sent each time the page is hidden); a vital the new hit has replaces the old.
      await db
        .update(visit)
        .set({
          ms: sql`GREATEST(COALESCE(${visit.ms}, 0), ${b.ms})`,
          lcp: sql`COALESCE(${b.lcp ?? null}::integer, ${visit.lcp})`,
          inp: sql`COALESCE(${b.inp ?? null}::integer, ${visit.inp})`,
          ttfb: sql`COALESCE(${b.ttfb ?? null}::integer, ${visit.ttfb})`,
          cls: sql`COALESCE(${b.cls ?? null}::double precision, ${visit.cls})`,
        })
        .where(recent);
    } else {
      await db.update(visit).set({ started: true }).where(recent);
    }
    return c.body(null, 204);
  });

  // GET /galaxy/website/stats: the last 30 IST days, for holders of People. Each read is logged.
  app.get("/galaxy/website/stats", signedIn(db, secret, now), requireFeature(db, now, "people"), async (c) => {
    const at = now(); // one clock for the whole answer
    await db.insert(auditLog).values({ actorId: c.var.actor.id, action: "website.stats", data: {}, at: new Date(at) });
    const today = ist(at);
    const from = new Date(`${ist(at - 29 * DAY)}T00:00:00+05:30`);
    const win = sql`${visit.at} >= ${from.toISOString()}::timestamptz`; // a raw template doesn't map a Date for the driver
    const day = sql`(${visit.at} AT TIME ZONE 'Asia/Kolkata')::date`;
    const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
    // One row per visitor-day (the visitor code changes daily): their first view's source and the steps they reached.
    const perVisitor = sql`select (array_agg(source order by at))[1] as source, bool_or(started) as s, bool_or(code) as c, bool_or(joined) as j from visit where ${win} group by visitor`;
    const median = sql`round((percentile_cont(0.5) within group (order by ms) / 1000)::numeric, 1)::float`;
    // Distinct visitors per value of a column, most first.
    const tally = async (value: ReturnType<typeof sql>): Promise<Tally> =>
      top(
        await rows<{ name: string; count: number }>(
          sql`select ${value} as name, count(distinct visitor)::int as count from visit where ${win} and ${value} is not null group by 1 order by 2 desc, 1`,
        ),
        (r) => ({ count: r.reduce((n, t) => n + t.count, 0) }),
      );

    // One query at a time: all at once would hold every pooled connection while a join waits for one.
    const inTurn = async <T extends (() => Promise<unknown>)[]>(fns: [...T]) => {
      const out: unknown[] = [];
      for (const f of fns) out.push(await f());
      return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
    };
    const [perDay, funnel, sources, pages, overall, os, apps, countries, cities, vitals, first] = await inTurn([
      () => rows<{ day: string; visitors: number; views: number; joined: number }>(
        sql`select to_char(${day}, 'YYYY-MM-DD') as day, count(distinct visitor)::int as visitors, count(*)::int as views, (count(distinct visitor) filter (where joined))::int as joined from visit where ${win} group by 1`,
      ),
      () => rows<SiteStats["funnel"]>(
        sql`select count(*)::int as visitors, (count(*) filter (where s))::int as started, (count(*) filter (where c))::int as code, (count(*) filter (where j))::int as joined from (${perVisitor}) v`,
      ),
      () => rows<{ name: string; visitors: number; joined: number }>(
        sql`select source as name, count(*)::int as visitors, (count(*) filter (where j))::int as joined from (${perVisitor}) v group by 1 order by 2 desc, 1`,
      ),
      () => rows<SiteStats["pages"][number]>(
        sql`select path as name, count(*)::int as views, count(distinct visitor)::int as visitors, ${median} as seconds from visit where ${win} group by 1 order by 2 desc, 1`,
      ),
      () => rows<{ seconds: number | null }>(sql`select ${median} as seconds from visit where ${win}`),
      () => tally(sql`os`),
      () => tally(sql`app`),
      () => tally(sql`country`),
      () => tally(sql`case when city is null then null when region is null then city else city || ', ' || region end`),
      () => rows<{ lcp: number | null; inp: number | null; ttfb: number | null; cls: number | null; samples: number }>(
        sql`select round((percentile_cont(0.75) within group (order by lcp))::numeric)::int as lcp, round((percentile_cont(0.75) within group (order by inp))::numeric)::int as inp, round((percentile_cont(0.75) within group (order by ttfb))::numeric)::int as ttfb, round((percentile_cont(0.75) within group (order by cls))::numeric, 3)::float as cls, (count(lcp))::int as samples from visit where ${win}`,
      ),
      () => rows<{ first: Date | null }>(sql`select min(at) as first from visit`),
    ]);

    const byDay = new Map(perDay.map((d) => [d.day, d]));
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = ist(at - (29 - i) * DAY);
      const r = byDay.get(d);
      return { day: d, visitors: r?.visitors ?? 0, views: r?.views ?? 0, joined: r?.joined ?? 0 };
    });
    const v = vitals[0]!;
    const body: SiteStats = {
      since: first[0]?.first ? ist(new Date(first[0].first).getTime()) : null,
      visitors: days.reduce((n, d) => n + d.visitors, 0),
      views: days.reduce((n, d) => n + d.views, 0),
      today: { visitors: byDay.get(today)?.visitors ?? 0, views: byDay.get(today)?.views ?? 0 },
      days,
      funnel: funnel[0]!,
      sources: top(sources, (r) => ({ visitors: r.reduce((n, s) => n + s.visitors, 0), joined: r.reduce((n, s) => n + s.joined, 0) })),
      pages: pages.filter((p) => (PAGES as readonly string[]).includes(p.name)),
      seconds: overall[0]?.seconds ?? null,
      os,
      apps,
      countries,
      cities,
      vitals: { lcp: v.lcp, inp: v.inp, cls: v.cls, ttfb: v.ttfb, samples: v.samples },
    };
    return c.json(body);
  });

  return app;
}

// Rows older than the 180 days the privacy page promises are deleted.
export const pruneVisits = (db: Db, now: number) => db.delete(visit).where(lt(visit.at, new Date(now - 180 * DAY)));
