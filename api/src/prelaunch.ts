import { isIP, isIPv6 } from "node:net";
import { count, desc } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Interest, type InterestList, type InterestMeta } from "@orbit/contract";
import type { Store } from "./auth/store.ts";
import type { Db } from "./db/index.ts";
import { auditLog, interest } from "./db/schema.ts";
import { clientIp, fail, invalid, listPage, parse, signedIn } from "./http.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";

// Prelaunch interest: Coming Soon's email sign-up, its count, and Galaxy's list (contract/src/prelaunch.ts).

type Deps = { db: Db; store: Store; secret: string; now?: () => number };

const PER_MINUTE = 10; // sign-ups from one address a minute: room for a shared Wi-Fi, not for filling the table

// An IPv6 address as its eight groups, so the first four name its /64.
const expand = (ip: string) => {
  const [head, tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  return [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
};

export function prelaunchRoutes({ db, store, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const total = async () => (await db.select({ n: count() }).from(interest))[0]!.n;

  // GET /public/interest: how many have asked, for Coming Soon.
  app.get("/public/interest", async (c) => c.json({ count: await total() }));

  // POST /public/interest: 204 for an email already on the list as for a new one, which keeps its first visit. The body
  // is capped before it's read; one IPv6 network (a /64, what one home or phone gets) counts as one address.
  app.post("/public/interest", bodyLimit({ maxSize: 8 * 1024, onError: (c) => invalid(c) }), async (c) => {
    const ip = clientIp(c).replace(/^::ffff:(?=\d+\.)/i, ""); // an IPv4 address as Node may show it
    const bucket = isIPv6(ip) ? expand(ip).slice(0, 4).join(":") : ip;
    if ((await store.incr(`interest:${bucket}`, 60_000)) > PER_MINUTE) return fail(c, 429, "tooMany", "Too many tries. Wait a minute.");
    const b = await parse(c, Interest);
    if (!b) return invalid(c);
    await db
      .insert(interest)
      .values({ email: b.email, ip: isIP(ip) ? ip : null, ...b.meta, createdAt: new Date(now()) })
      .onConflictDoNothing({ target: interest.email });
    return c.body(null, 204);
  });

  // GET /galaxy/prelaunch?page=: everyone who has asked, newest first, for holders of People. Each read is logged.
  app.get("/galaxy/prelaunch", signedIn(db, secret, now), requireFeature(db, now, "people"), async (c) => {
    const { page, limit, offset } = listPage(c);
    const rows = await db.select().from(interest).orderBy(desc(interest.createdAt), desc(interest.id)).limit(limit).offset(offset);
    await db.insert(auditLog).values({ actorId: c.var.actor.id, action: "prelaunch.list", data: { page, results: rows.map((r) => r.id) }, at: new Date(now()) });
    // A field the visit didn't give is left out, not null.
    const strip = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as InterestMeta;
    const body: InterestList = {
      people: rows.map(({ createdAt, ...r }) => ({ ...strip(r), id: r.id, email: r.email, ip: r.ip, createdAt: createdAt.toISOString() })),
      total: await total(),
      page,
      pageSize: limit,
    };
    return c.json(body);
  });

  return app;
}
