import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  Admit, type CounterStation, EditStation, FreeOne, type InTheWay, NewBlock, NewHold, NewStation, type SlotClaim, type SlotHold, type StationRow,
  VENUE_GONE, VenueSetup, type VenueDay, type VenueSettings, WalkIn, type Week,
} from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { hosts, stationClaims, stations, teamRoles, users, venues } from "../db/schema.ts";
import { fail, invalid, isUuid, type Notify, parse, signedIn, taken, type Env } from "../http.ts";
import { changeable, teamOf } from "../roles/access.ts";
import { type HoldResult, hold, toClaim } from "./hold.ts";
import { door, hours, HOUR, MIN, admitTo, outsideWeek, scanRefusal, stranded, taken as takenAt, timeLabel, walkIn } from "./rules.ts";

// A Venue's setup and its counter (Orbit flows: Play, "Setting up a venue" and "At the desk"). Admins set the venue up
// and edit it; Admins and Desk (a crew seat on a Venue host) run the counter. Desk never sees a price.
// The capacity guarantee: a station type's row is locked for update by every write that adds a claim, then its live
// claims are read and the pure rule (rules.ts) decides. Two writes on one station never run side by side.

type Deps = { db: Db; notify: Notify; secret: string; now?: () => number };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = typeof stationClaims.$inferSelect;
type Station = typeof stations.$inferSelect;
type Venue = typeof venues.$inferSelect;

const IST = 330 * MIN;
// ponytail: a guess (the Play doc sets no number); one venue rarely has more than a dozen kinds.
const MAX_STATIONS = 50;
const iso = (ms: number) => new Date(ms).toISOString();
const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;

// A refusal inside a transaction, said once outside it.
type No = { no: { status: 400 | 404 | 409; error: string; message: string; extra?: object } };
const no = (status: 400 | 404 | 409, error: string, message: string, extra?: object): No => ({ no: { status, error, message, extra } });
const GONE = no(404, "notFound", "There's nothing here.");
const CLOSED = no(409, "hostClosed", "This host can't change anything right now.");
const NO_VENUE = no(409, "noVenue", "Set the venue's address and hours first.");
const said = (c: Context, r: No) => fail(c, r.no.status, r.no.error, r.no.message, r.no.extra);
const nothing = (c: Context) => fail(c, 404, VENUE_GONE.notFound, "There's nothing here.");
// A seat on a venue nobody has set up yet: not the same 404 as no seat, so Station can tell "set it up" from "you're off the team".
const noVenue = (c: Context) => fail(c, 404, VENUE_GONE.noVenue, "This venue isn't set up yet.");
// A hold's refusals, as the player hears them.
const HOLD_NO: Record<Exclude<HoldResult, { ok: true }>["error"], [400 | 404 | 409, string]> = {
  notFound: [404, "There's nothing here."],
  hostClosed: [409, "This venue isn't taking bookings right now."],
  badTime: [400, "That time can't be booked. Pick another."],
  badCount: [400, "Pick how many."],
  tooMany: [409, "The venue doesn't have that many."],
  full: [409, "That slot just filled up. Pick another."],
};

// "Meera P.": a booking's name as the counter says it.
const shortName = (name: string | null) => {
  const [first, ...rest] = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return first ? (rest.length ? `${first} ${rest.at(-1)![0]!.toUpperCase()}.` : first) : "Someone";
};

const counterStation = (s: Station): CounterStation => ({
  id: s.id, name: s.name, unit: s.unit, tile: s.tile, count: s.count, whole: s.whole, step: s.step as 30 | 60, archived: s.archivedAt !== null,
});
export const stationRow = (s: Station): StationRow => ({
  ...counterStation(s),
  pricePaise: s.pricePaise,
  coopPaise: s.coopPaise,
  offPeak: s.offPeakFrom === null ? null : { from: s.offPeakFrom, to: s.offPeakTo!, weekdays: s.offPeakWeekdays!, pricePaise: s.offPeakPaise! },
  games: s.games,
});

export function slotsRoutes({ db, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());

  // The one place that decides who may touch a venue: Admins of a Venue host, and its Desk seats (role crew).
  const seatOn = async (hostId: string, userId: string) => {
    const t = await teamOf(db, hostId, userId);
    if (!t || t.host.kind !== "venue") return null;
    return { host: t.host, role: t.mine.role === "admin" ? ("admin" as const) : ("desk" as const) };
  };

  // Names for claims: the booker's, and who let them in.
  const names = async (ids: (string | null)[]) => {
    const want = [...new Set(ids.filter((i): i is string => !!i))];
    const rows = want.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, want)) : [];
    return new Map(rows.map((r) => [r.id, r.name]));
  };
  const claimOut = (r: Row, who: Map<string, string | null>): SlotClaim => ({
    id: r.id, stationId: r.stationId, kind: r.kind, status: r.status, count: r.count, start: r.startsAt.toISOString(), end: r.endsAt.toISOString(),
    who: r.userId ? (who.get(r.userId) ?? null) : null, why: r.reason, admitted: r.admitted,
    checkedInAt: isoOrNull(r.checkedInAt), checkedInBy: r.checkedInBy ? (who.get(r.checkedInBy) ?? null) : null, releasedAt: isoOrNull(r.releasedAt),
  });
  const oneClaim = async (r: Row) => claimOut(r, await names([r.userId, r.checkedInBy]));

  // A write, in the order of locks every slots write takes: the host (shared) with the person's started seat read again,
  // then the venue row (shared, or for update when its hours change). The station is locked inside `body`. Whatever
  // landed since the first read stands: a suspension, a removed seat.
  const write = async (
    c: Context<Env>,
    hostId: string,
    adminOnly: boolean,
    venueLock: "share" | "update",
    body: (tx: Tx, k: { host: typeof hosts.$inferSelect; venue: Venue | undefined; userId: string }) => Promise<No | { json?: unknown; status?: 200 | 201 | 204; after?: () => Promise<void> }>,
  ) => {
    const userId = c.var.user.id;
    const seat = await seatOn(hostId, userId);
    if (!seat || (adminOnly && seat.role !== "admin")) return nothing(c);
    if (!changeable(seat.host)) return said(c, CLOSED);
    try {
      const done = await db.transaction(async (tx) => {
        const [host] = await tx.select().from(hosts).where(eq(hosts.id, hostId)).for("share");
        const [mine] = await tx
          .select({ role: teamRoles.role })
          .from(teamRoles)
          .where(and(eq(teamRoles.hostId, hostId), eq(teamRoles.userId, userId), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt)));
        if (!mine || (adminOnly && mine.role !== "admin")) return GONE;
        if (!changeable(host!)) return CLOSED;
        if (host!.kind !== "venue") return GONE; // a kind change that landed since the first read
        const [venue] = await tx.select().from(venues).where(eq(venues.hostId, hostId)).for(venueLock);
        return body(tx, { host: host!, venue, userId });
      });
      if ("no" in done) return said(c, done);
      await done.after?.();
      return done.status === 204 ? c.body(null, 204) : c.json(done.json, done.status ?? 200);
    } catch (e) {
      // A check the rules should have caught: a refusal, not a 500.
      if (((e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code) === "23514") return invalid(c);
      throw e;
    }
  };

  // A station, locked for update. Every claim write and every count or archive edit goes through here.
  const lockStation = async (tx: Tx, hostId: string, id: string) => {
    if (!isUuid(id)) return undefined;
    const [s] = await tx.select().from(stations).where(and(eq(stations.id, id), eq(stations.hostId, hostId))).for("update");
    return s;
  };
  // The station's claims that can still matter at `from`: a step back covers a walk-in freed earlier in the same step.
  const claimsOf = async (tx: Tx, stationId: string, from: number) =>
    tx.select().from(stationClaims).where(and(eq(stationClaims.stationId, stationId), gt(stationClaims.endsAt, new Date(from - HOUR))));
  // The venue's live bookings: what a setup change can strand.
  const liveBookings = async (tx: Tx, hostId: string, only?: string) => {
    const rows = await tx
      .select({ claim: stationClaims, station: stations.name, who: users.name })
      .from(stationClaims)
      .innerJoin(stations, eq(stations.id, stationClaims.stationId))
      .leftJoin(users, eq(users.id, stationClaims.userId))
      .where(
        and(
          eq(stations.hostId, hostId),
          only ? eq(stations.id, only) : undefined,
          eq(stationClaims.kind, "booking"),
          gt(stationClaims.endsAt, at()),
          or(inArray(stationClaims.status, ["paid", "checked_in"]), and(eq(stationClaims.status, "held"), gt(stationClaims.holdEndsAt, at()))),
        ),
      );
    return rows;
  };
  type Live = Awaited<ReturnType<typeof liveBookings>>;
  // "3 bookings need more stations than that. Cancel and refund them first: Meera P., 3 × Gaming PC, 7:30 to 10:30 PM; …"
  const inTheWay = (rows: Live, why: string) => {
    const n = rows.length;
    const line = (r: Live[number]) => `${shortName(r.who)}, ${r.claim.count} × ${r.station}, ${timeLabel(r.claim.startsAt.getTime())} to ${timeLabel(r.claim.endsAt.getTime())}`;
    const list = rows.slice(0, 3).map(line).join("; ") + (n > 3 ? `, and ${n - 3} more` : "");
    const bookings: InTheWay[] = rows.map((r) => ({
      id: r.claim.id, stationId: r.claim.stationId, who: r.who, count: r.claim.count, start: r.claim.startsAt.toISOString(), end: r.claim.endsAt.toISOString(),
    }));
    return no(409, "inTheWay", `${n} booking${n === 1 ? " needs" : "s need"} ${why}. Cancel and refund ${n === 1 ? "it" : "them"} first: ${list}.`, { bookings });
  };
  const byId = (rows: Live) => new Map(rows.map((r) => [r.claim.id, r]));

  const settingsOf = async (hostId: string): Promise<VenueSettings | null> => {
    const [v] = await db.select().from(venues).where(eq(venues.hostId, hostId));
    if (!v) return null;
    const list = await db.select().from(stations).where(eq(stations.hostId, hostId)).orderBy(asc(stations.createdAt), asc(stations.id));
    return {
      hostId, address: v.address, area: v.area, lat: v.lat, lng: v.lng, placeId: v.placeId, deskPhone: v.deskPhone, week: v.week,
      cutoffMinutes: v.cutoffMinutes, logsWalkIns: v.logsWalkIns, stations: list.map(stationRow),
    };
  };

  // ---------- Admin setup ----------

  // PUT /venues/:hostId: the address, desk phone and weekly hours. Hours that would leave a live booking outside them are
  // refused, naming the bookings.
  app.put("/venues/:hostId", auth, async (c) => {
    const b = await parse(c, VenueSetup);
    if (!b) return invalid(c);
    const hostId = c.req.param("hostId");
    for (let tries = 0; ; tries++) {
      try {
        let created = false;
        const r = await write(c, hostId, true, "update", async (tx, { venue }) => {
          const fields = { address: b.address, area: b.area, lat: b.lat, lng: b.lng, placeId: b.placeId ?? null, deskPhone: b.deskPhone, week: b.week, cutoffMinutes: b.cutoffMinutes, logsWalkIns: b.logsWalkIns };
          if (!venue) {
            created = true;
            await tx.insert(venues).values({ hostId, ...fields, createdAt: at(), updatedAt: at() });
          } else {
            if (JSON.stringify(venue.week) !== JSON.stringify(b.week)) {
              const live = byId(await liveBookings(tx, hostId));
              const out = outsideWeek([...live.values()].map((r) => toClaim(r.claim)), b.week, now());
              if (out.length) return inTheWay(out.map((o) => live.get(o.id)!), "the old hours");
            }
            await tx.update(venues).set({ ...fields, updatedAt: at() }).where(eq(venues.hostId, hostId));
          }
          return {};
        });
        if (r.status !== 200) return r;
        return c.json(await settingsOf(hostId), created ? 201 : 200);
      } catch (e) {
        // Two first saves met on the same row: the second now finds it and updates.
        if (taken(e) && tries < 1) continue;
        throw e;
      }
    }
  });

  // GET /venues/:hostId: Admins only (it holds the prices).
  app.get("/venues/:hostId", auth, async (c) => {
    const seat = await seatOn(c.req.param("hostId"), c.var.user.id);
    if (seat?.role !== "admin") return nothing(c);
    const out = await settingsOf(seat.host.id);
    return out ? c.json(out) : noVenue(c);
  });

  // POST /venues/:hostId/stations: gaming starts every 30 minutes and is booked by the seat; sports starts on the hour and
  // is booked whole (Play). Coop and games are gaming's.
  app.post("/venues/:hostId/stations", auth, async (c) => {
    const b = await parse(c, NewStation);
    if (!b) return invalid(c);
    return write(c, c.req.param("hostId"), true, "share", async (tx, { host, venue }) => {
      if (!venue) return NO_VENUE;
      const [n] = await tx.select({ n: count() }).from(stations).where(and(eq(stations.hostId, host.id), isNull(stations.archivedAt)));
      if (n!.n >= MAX_STATIONS) return no(409, "tooMany", `A venue can have ${MAX_STATIONS} kinds. Archive one first.`);
      const gaming = b.tile === "gaming";
      const [s] = await tx
        .insert(stations)
        .values({
          hostId: host.id, name: b.name, unit: b.unit, tile: b.tile, count: b.count, whole: !gaming, step: gaming ? 30 : 60, pricePaise: b.pricePaise,
          coopPaise: gaming ? (b.coopPaise ?? null) : null, games: gaming ? (b.games || null) : null,
          offPeakFrom: b.offPeak?.from ?? null, offPeakTo: b.offPeak?.to ?? null, offPeakWeekdays: b.offPeak?.weekdays ?? null, offPeakPaise: b.offPeak?.pricePaise ?? null,
          createdAt: at(), updatedAt: at(),
        })
        .returning();
      return { json: stationRow(s!), status: 201 };
    });
  });

  // PATCH /venues/:hostId/stations/:stationId: fewer stations, or archiving, is refused while bookings need them.
  app.patch("/venues/:hostId/stations/:stationId", auth, async (c) => {
    const b = await parse(c, EditStation);
    if (!b) return invalid(c);
    return write(c, c.req.param("hostId"), true, "share", async (tx, { host }) => {
      const s = await lockStation(tx, host.id, c.req.param("stationId"));
      if (!s) return GONE;
      const gaming = s.tile === "gaming";
      const price = b.pricePaise ?? s.pricePaise;
      const stored = s.offPeakFrom === null ? null : { from: s.offPeakFrom, to: s.offPeakTo!, weekdays: s.offPeakWeekdays!, pricePaise: s.offPeakPaise! };
      const off = b.offPeak === undefined ? stored : b.offPeak;
      if (off && off.pricePaise >= price) return no(400, "invalid", "Off-peak is cheaper than the price an hour.");
      const cnt = b.count ?? s.count;
      const archiving = b.archived === true && s.archivedAt === null;
      if (cnt < s.count || archiving) {
        const live = byId(await liveBookings(tx, host.id, s.id));
        const out = stranded([...live.values()].map((r) => toClaim(r.claim)), s.id, archiving ? 0 : cnt, now());
        if (out.length) return inTheWay(out.map((o) => live.get(o.id)!), archiving ? "this station kind" : `more than ${cnt}`);
      }
      const [row] = await tx
        .update(stations)
        .set({
          name: b.name ?? s.name, unit: b.unit ?? s.unit, count: cnt, pricePaise: price,
          coopPaise: gaming ? (b.coopPaise === undefined ? s.coopPaise : b.coopPaise) : null,
          games: gaming ? (b.games === undefined ? s.games : b.games || null) : null,
          offPeakFrom: off?.from ?? null, offPeakTo: off?.to ?? null, offPeakWeekdays: off?.weekdays ?? null, offPeakPaise: off?.pricePaise ?? null,
          archivedAt: b.archived === undefined ? s.archivedAt : b.archived ? (s.archivedAt ?? at()) : null,
          updatedAt: at(),
        })
        .where(eq(stations.id, s.id))
        .returning();
      return { json: stationRow(row!) };
    });
  });

  // ---------- Counter ----------

  // GET /venues/:hostId/day: the opening that holds `at` (now unless given). No price anywhere: Desk reads it.
  app.get("/venues/:hostId/day", auth, async (c) => {
    const seat = await seatOn(c.req.param("hostId"), c.var.user.id);
    if (!seat) return nothing(c);
    const [venue] = await db.select().from(venues).where(eq(venues.hostId, seat.host.id));
    if (!venue) return noVenue(c);
    const q = c.req.query("at");
    const when = q === undefined ? now() : Date.parse(q);
    if (!Number.isFinite(when) || when < Date.UTC(2000, 0, 1) || when > Date.UTC(2100, 0, 1)) return invalid(c);
    const h = hours(venue.week, when);
    const list = await db.select().from(stations).where(eq(stations.hostId, seat.host.id)).orderBy(asc(stations.createdAt), asc(stations.id));
    // A lapsed hold is nobody's: left out whole.
    const rows =
      h.closes > h.opens
        ? await db
            .select({ claim: stationClaims })
            .from(stationClaims)
            .innerJoin(stations, eq(stations.id, stationClaims.stationId))
            .where(
              and(
                eq(stations.hostId, seat.host.id),
                lt(stationClaims.startsAt, new Date(h.closes)),
                gt(stationClaims.endsAt, new Date(h.opens)),
                or(ne(stationClaims.status, "held"), gt(stationClaims.holdEndsAt, at())),
              ),
            )
            .orderBy(asc(stationClaims.startsAt), asc(stationClaims.id))
        : [];
    const claims = rows.map((r) => r.claim);
    const rule = claims.map(toClaim);
    const free: VenueDay["free"] = {};
    for (const s of list) {
      free[s.id] = [];
      // The step now is in reads from now, as a walk-in does: a station freed early this step is free again.
      for (let t = h.opens; t < h.closes; t += 30 * MIN) free[s.id]!.push({ at: iso(t), free: takenAt(rule, s, t <= now() && now() < t + 30 * MIN ? now() : t, now()).free });
    }
    const who = await names(claims.flatMap((r) => [r.userId, r.checkedInBy]));
    const out: VenueDay = {
      opening: { day: iso(h.day), opens: iso(h.opens), closes: iso(h.closes), state: h.state },
      logsWalkIns: venue.logsWalkIns,
      stations: list.map(counterStation),
      claims: claims.map((r) => claimOut(r, who)),
      free,
    };
    return c.json(out);
  });

  // A walk-in or block that starts at the step `ref` is in, as the rules say, under the station's lock.
  const place = async (tx: Tx, host: typeof hosts.$inferSelect, venue: Venue | undefined, stationId: string, ref: number, hrs: number, cnt: number) => {
    if (!venue) return GONE;
    const s = await lockStation(tx, host.id, stationId);
    if (!s || s.archivedAt) return GONE;
    const claims = (await claimsOf(tx, s.id, ref)).map(toClaim);
    const fit = walkIn(claims, venue.week, { id: s.id, step: s.step as 30 | 60, count: s.count }, ref, hrs, cnt, now());
    return fit.ok ? { s, start: fit.start, end: fit.end } : no(409, "noRoom", fit.line);
  };

  // POST /venues/:hostId/walk-ins: someone at the counter, from the current step.
  app.post("/venues/:hostId/walk-ins", auth, async (c) => {
    const b = await parse(c, WalkIn);
    if (!b) return invalid(c);
    return write(c, c.req.param("hostId"), false, "share", async (tx, { host, venue, userId }) => {
      const p = await place(tx, host, venue, b.stationId, now(), b.hours, b.count);
      if ("no" in p) return p;
      const [row] = await tx
        .insert(stationClaims)
        .values({
          stationId: p.s.id, kind: "walkin", status: "checked_in", count: b.count, startsAt: new Date(p.start), endsAt: new Date(p.end), admitted: b.count,
          checkedInAt: at(), checkedInBy: userId, createdBy: userId, createdAt: at(), updatedAt: at(),
        })
        .returning();
      return { json: await oneClaim(row!), status: 201 };
    });
  });

  // POST /venues/:hostId/walk-ins/free: the minus. The latest walk-in on now ends now; of several, one splits off.
  app.post("/venues/:hostId/walk-ins/free", auth, async (c) => {
    const b = await parse(c, FreeOne);
    if (!b) return invalid(c);
    return write(c, c.req.param("hostId"), false, "share", async (tx, { host }) => {
      const s = await lockStation(tx, host.id, b.stationId);
      if (!s) return GONE;
      const t = now();
      const w = (await claimsOf(tx, s.id, t))
        .filter((r) => r.kind === "walkin" && r.status === "checked_in" && r.startsAt.getTime() <= t && t < r.endsAt.getTime())
        .sort((a, z) => z.startsAt.getTime() - a.startsAt.getTime())[0];
      if (!w) return no(409, "nothingToFree", "No walk-in is on that station now.");
      const one = { ...w, count: 1, admitted: 1 };
      if (w.count > 1) await tx.update(stationClaims).set({ count: w.count - 1, admitted: Math.min(w.admitted, w.count - 1), updatedAt: at() }).where(eq(stationClaims.id, w.id));
      // Added this very moment: it can't end at its own start (a claim ends after it starts), so freed before it began
      // it simply goes, and the reply is the claim as it was, one of it.
      if (w.startsAt.getTime() >= t) {
        if (w.count === 1) await tx.delete(stationClaims).where(eq(stationClaims.id, w.id));
        return { json: await oneClaim(one) };
      }
      if (w.count === 1) {
        const [row] = await tx.update(stationClaims).set({ status: "freed", endsAt: at(), updatedAt: at() }).where(eq(stationClaims.id, w.id)).returning();
        return { json: await oneClaim(row!) };
      }
      const { id: _id, ...rest } = one;
      const [row] = await tx.insert(stationClaims).values({ ...rest, status: "freed", endsAt: at(), updatedAt: at() }).returning();
      return { json: await oneClaim(row!) };
    });
  });

  // POST /venues/:hostId/blocks: a venue holds stations back for its own use (Play decision 16). Checked as a walk-in is,
  // from the current step, or from a start on the station's grid in the future.
  app.post("/venues/:hostId/blocks", auth, async (c) => {
    const b = await parse(c, NewBlock);
    if (!b) return invalid(c);
    return write(c, c.req.param("hostId"), false, "share", async (tx, { host, venue, userId }) => {
      let ref = now();
      if (b.start) {
        const s = await lockStation(tx, host.id, b.stationId);
        if (!s) return GONE;
        ref = Date.parse(b.start);
        if (ref <= now() || (ref + IST) % (s.step * MIN) !== 0) return no(400, "invalid", "Check what you typed and try again.");
      }
      const p = await place(tx, host, venue, b.stationId, ref, b.hours, b.count);
      if ("no" in p) return p;
      const [row] = await tx
        .insert(stationClaims)
        .values({
          stationId: p.s.id, kind: "block", status: "paid", count: b.count, startsAt: new Date(p.start), endsAt: new Date(p.end), reason: b.why,
          createdBy: userId, createdAt: at(), updatedAt: at(),
        })
        .returning();
      return { json: await oneClaim(row!), status: 201 };
    });
  });

  // A claim of this venue, read before its station is locked, and read again under the lock by the caller.
  const stationOf = async (hostId: string, claimId: string) => {
    if (!isUuid(hostId) || !isUuid(claimId)) return null;
    const [r] = await db
      .select({ stationId: stationClaims.stationId })
      .from(stationClaims)
      .innerJoin(stations, eq(stations.id, stationClaims.stationId))
      .where(and(eq(stationClaims.id, claimId), eq(stations.hostId, hostId)));
    return r?.stationId ?? null;
  };
  const claimUnder = async (tx: Tx, stationId: string, claimId: string) =>
    (await tx.select().from(stationClaims).where(and(eq(stationClaims.id, claimId), eq(stationClaims.stationId, stationId))))[0];

  // DELETE /venues/:hostId/blocks/:claimId: one not started goes; one started ends now.
  app.delete("/venues/:hostId/blocks/:claimId", auth, async (c) => {
    const hostId = c.req.param("hostId");
    const claimId = c.req.param("claimId");
    const sid = await stationOf(hostId, claimId);
    if (!sid) return nothing(c);
    return write(c, hostId, false, "share", async (tx, { host }) => {
      if (!(await lockStation(tx, host.id, sid))) return GONE;
      const r = await claimUnder(tx, sid, claimId);
      if (!r || r.kind !== "block" || r.status !== "paid" || r.endsAt.getTime() <= now()) return GONE;
      // ponytail: one starting this very moment goes too: it can't end at its own start.
      if (r.startsAt.getTime() >= now()) await tx.delete(stationClaims).where(eq(stationClaims.id, r.id));
      else await tx.update(stationClaims).set({ status: "ended", endsAt: at(), updatedAt: at() }).where(eq(stationClaims.id, r.id));
      return { status: 204 };
    });
  });

  // POST /venues/:hostId/claims/:claimId/admit: the scan, then the desk's count of who is here. The same total twice
  // changes nothing; the first time and who stay.
  app.post("/venues/:hostId/claims/:claimId/admit", auth, async (c) => {
    const b = await parse(c, Admit);
    if (!b) return invalid(c);
    const hostId = c.req.param("hostId");
    const claimId = c.req.param("claimId");
    const sid = await stationOf(hostId, claimId);
    if (!sid) return nothing(c);
    return write(c, hostId, false, "share", async (tx, { host, userId }) => {
      if (!(await lockStation(tx, host.id, sid))) return GONE;
      const r = await claimUnder(tx, sid, claimId);
      // A refunded or released booking reaches the scan order below, so the desk is told why it won't let them in.
      if (!r || r.kind !== "booking" || !["paid", "checked_in", "refunded", "released"].includes(r.status)) return GONE;
      const rule = toClaim(r);
      const why = scanRefusal(rule, now());
      if (why) return no(409, why.error, why.message);
      const next = admitTo(rule, b.total, now(), userId);
      // ponytail: counting nobody in checks nobody in: it stays releasable as a no-show until someone is.
      if (next.admitted === 0) return { json: await oneClaim(r) };
      const [row] = await tx
        .update(stationClaims)
        .set({ admitted: next.admitted, status: "checked_in", checkedInAt: r.checkedInAt ?? at(), checkedInBy: r.checkedInBy ?? userId, updatedAt: at() })
        .where(eq(stationClaims.id, r.id))
        .returning();
      return { json: await oneClaim(row!) };
    });
  });

  // POST /venues/:hostId/claims/:claimId/release: a no-show let go 15 minutes after the start. No refund; they're told.
  app.post("/venues/:hostId/claims/:claimId/release", auth, async (c) => {
    const hostId = c.req.param("hostId");
    const claimId = c.req.param("claimId");
    const sid = await stationOf(hostId, claimId);
    if (!sid) return nothing(c);
    return write(c, hostId, false, "share", async (tx, { host, userId }) => {
      if (!(await lockStation(tx, host.id, sid))) return GONE;
      const r = await claimUnder(tx, sid, claimId);
      if (!r || r.kind !== "booking") return GONE;
      // A retried tap on one already released answers as the first did, and tells nobody twice.
      if (r.status === "released") return { json: await oneClaim(r) };
      if (r.status === "checked_in" || r.admitted > 0) return no(409, "here", "They've checked in.");
      if (r.status !== "paid") return no(409, "notOpen", "That booking can't be released.");
      const d = door(toClaim(r), now());
      if (d !== "noShow") {
        if (d === "missed") return no(409, "notOpen", "That booking can't be released.");
        return no(409, "tooEarly", "A booking can be released 15 minutes after it starts.");
      }
      const [row] = await tx
        .update(stationClaims)
        .set({ status: "released", releasedAt: at(), releasedBy: userId, updatedAt: at() })
        .where(eq(stationClaims.id, r.id))
        .returning();
      return {
        json: await oneClaim(row!),
        after: async () => {
          if (r.userId) await notify({ to: { userId: r.userId }, kind: "slotReleased", data: { claimId: r.id, hostId, hostName: host.name, start: r.startsAt.toISOString() } });
        },
      };
    });
  });

  // ---------- Players ----------

  // POST /venues/:hostId/holds: any signed-in person holds a slot for 10 minutes while they pay (hold.ts). No seat needed.
  app.post("/venues/:hostId/holds", auth, async (c) => {
    const hostId = c.req.param("hostId");
    if (!isUuid(hostId)) return nothing(c);
    const b = await parse(c, NewHold);
    if (!b) return invalid(c);
    const r = await hold(db, { hostId, stationId: b.stationId, userId: c.var.user.id, start: Date.parse(b.start), hours: b.hours, count: b.count }, now());
    if (!r.ok) return fail(c, HOLD_NO[r.error][0], r.error, HOLD_NO[r.error][1]);
    const h = r.claim;
    const out: SlotHold = { id: h.id, stationId: h.stationId, start: h.startsAt.toISOString(), end: h.endsAt.toISOString(), count: h.count, holdEndsAt: h.holdEndsAt!.toISOString() };
    return c.json(out, 201);
  });

  return app;
}
