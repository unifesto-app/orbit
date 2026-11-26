import { asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { StaffVenues } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { hosts, stations, venues } from "../db/schema.ts";
import { signedIn } from "../http.ts";
import { requireFeature, type StaffEnv } from "../roles/access.ts";

// Galaxy's Venues (X9), for holders of Hosts: every Venue host, set up or not. An approved venue request makes the host;
// its venue row comes from Play Partner's setup (PUT /venues/:hostId), so a host without one is "Setup pending".
// ponytail: one unpaged list; page it as Events does once venues run past a few hundred.

type Deps = { db: Db; secret: string; now?: () => number };

export function galaxyVenuesRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();

  app.get("/galaxy/venues", signedIn(db, secret, now), requireFeature(db, now, "hosts"), async (c) => {
    const rows = await db.select().from(hosts).leftJoin(venues, eq(venues.hostId, hosts.id)).where(eq(hosts.kind, "venue")).orderBy(asc(hosts.name), asc(hosts.id));
    const ids = rows.map((r) => r.hosts.id);
    const all = ids.length ? await db.select().from(stations).where(inArray(stations.hostId, ids)).orderBy(asc(stations.createdAt), asc(stations.id)) : [];
    const out: StaffVenues = {
      venues: rows.map(({ hosts: h, venues: v }) => ({
        host: { id: h.id, name: h.name, city: h.city, status: h.status, createdAt: h.createdAt.toISOString() },
        venue: v && { area: v.area, address: v.address, deskPhone: v.deskPhone },
        stations: all
          .filter((s) => s.hostId === h.id)
          .map((s) => ({ id: s.id, name: s.name, unit: s.unit, tile: s.tile, count: s.count, pricePaise: s.pricePaise, archived: s.archivedAt !== null })),
      })),
    };
    return c.json(out);
  });

  return app;
}
