import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { EditHost, HostSlug, type HostPage, type NoticeKind, SetParent, StaffReason, VerifyHost } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { auditLog, follows, hosts, hostSlugs, teamRoles, users, venues } from "../db/schema.ts";
import { type Env, fail, invalid, isUuid, type Notify, listPage, parse, signedIn, taken } from "../http.ts";
import { adminsOf, changeable, holdersOf, holdIfUnanswered, masked, onHost, requireFeature, type StaffEnv, teamOf, tell } from "../roles/access.ts";
import { type Action, parentRule, statusRule } from "./rules.ts";

// Hosts without events: profile, owner status, follows and the public read, and Galaxy's host tools
// (Orbit flows: Hosts, Galaxy, Discover and Roles).

type Deps = { db: Db; notify: Notify; secret: string; now?: () => number };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Host = typeof hosts.$inferSelect;

const SHOWN_FROM = 10; // Discover decision 16: a host's follower count shows from 10
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const visible = and(eq(hosts.visibility, "public"), eq(hosts.status, "live")); // what the public sees

export function hostsRoutes({ db, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  // Signed in when a token comes, so `following` can be filled; otherwise anyone may read.
  const maybe = createMiddleware<Env>(async (c, next) => (c.req.header("authorization") ? auth(c, next) : next()));
  const at = () => new Date(now());
  const audit = (tx: Tx, row: Omit<typeof auditLog.$inferInsert, "at">) => tx.insert(auditLog).values({ ...row, at: at() });
  const say = (ids: string[], kind: NoticeKind, data: Record<string, unknown>) => tell(notify, ids, kind, data);
  // Admins hear it, and every holder of Hosts, who see what staff do (as in Roles).
  const sayStaff = async (h: Host, kind: NoticeKind, extra: Record<string, unknown>, action: string, reason: string, by: string) => {
    await say(await adminsOf(db, h.id), kind, { hostId: h.id, hostName: h.name, ...extra });
    await say(await holdersOf(db, "hosts", at()), "staffRiskyAction", { action, hostId: h.id, reason, by });
  };

  const followersOf = async (hostId: string) => (await db.select({ n: count() }).from(follows).where(eq(follows.hostId, hostId)))[0]!.n;
  // What the public and the team both read of a host. A parent or club that isn't public and live isn't shown.
  const profile = async (h: Host) => {
    const [parent] = h.parentId ? await db.select({ slug: hosts.slug, name: hosts.name }).from(hosts).where(and(eq(hosts.id, h.parentId), visible)) : [];
    const clubs = await db.select({ slug: hosts.slug, name: hosts.name }).from(hosts).where(and(eq(hosts.parentId, h.id), visible)).orderBy(hosts.name);
    return {
      id: h.id, slug: h.slug, name: h.name, kind: h.kind as HostPage["kind"], city: h.city, verified: !!h.verifiedAt,
      about: h.about, website: h.website, logo: h.logo, banner: h.banner, parent: parent ?? null, clubs,
    };
  };
  const pageOf = async (h: Host, userId: string): Promise<HostPage> => ({
    ...(await profile(h)), status: h.status, visibility: h.visibility, suspendReason: h.suspendReason, followers: await followersOf(h.id), owner: h.ownerId === userId,
  });

  // ---------- The host's own team ----------

  // GET /hosts/:id: anyone with a started seat. Followers are exact here.
  app.get("/hosts/:id", auth, async (c) => {
    const t = await teamOf(db, c.req.param("id"), c.var.user.id);
    return t ? c.json(await pageOf(t.host, c.var.user.id)) : nothing(c);
  });

  // PATCH /hosts/:id: Admins edit the profile. Renaming removes verification (Hosts flow); a new link keeps the old.
  app.patch("/hosts/:id", auth, async (c) => {
    const b = await parse(c, EditHost);
    if (!b) return invalid(c);
    const t = await teamOf(db, c.req.param("id"), c.var.user.id);
    if (t?.mine.role !== "admin") return nothing(c);
    const { host } = t;
    if (!changeable(host)) return fail(c, 409, "hostClosed", "This host can't be edited right now.");
    try {
      // The host and the person's seat are read again under a lock: a suspension or removal that landed since the
      // first read stands.
      const done = await db.transaction(async (tx) => {
        const [cur] = await tx.select().from(hosts).where(eq(hosts.id, host.id)).for("update");
        const [seat] = await tx
          .select({ id: teamRoles.id })
          .from(teamRoles)
          .where(and(eq(teamRoles.hostId, host.id), eq(teamRoles.userId, c.var.user.id), eq(teamRoles.role, "admin"), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt)));
        if (!seat) return "gone" as const;
        if (!changeable(cur!)) return "closed" as const;
        // A Venue with its counter set up, or a Desk seat that has started, stays a Venue: as anything else its bookings
        // couldn't be checked in or released (slots routes answer only Venue hosts). A waiting Desk invite doesn't count:
        // accept refuses on a host that's no longer a Venue.
        if (b.kind !== undefined && b.kind !== "venue" && cur!.kind === "venue") {
          const [v] = await tx.select({ id: venues.hostId }).from(venues).where(eq(venues.hostId, host.id));
          const [desk] = await tx.select({ id: teamRoles.id }).from(teamRoles).where(and(eq(teamRoles.hostId, host.id), eq(teamRoles.role, "crew"), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt)));
          if (v || desk) return "venue" as const;
        }
        if (b.slug && b.slug !== cur!.slug) {
          // Every slug stays held by its host: its own old one is free to come back to, anyone else's is not.
          const [got] = await tx
            .insert(hostSlugs)
            .values({ slug: b.slug, hostId: host.id, createdAt: at() })
            .onConflictDoUpdate({ target: hostSlugs.slug, set: { hostId: host.id }, setWhere: eq(hostSlugs.hostId, host.id) })
            .returning();
          if (!got) return "taken" as const;
        }
        const renamed = b.name !== undefined && b.name !== cur!.name;
        await tx
          .update(hosts)
          .set({ ...b, ...(renamed ? { verifiedAt: null, verifiedBy: null } : {}), updatedAt: at() })
          .where(eq(hosts.id, host.id));
        return "done" as const;
      });
      if (done === "gone") return nothing(c);
      if (done === "closed") return fail(c, 409, "hostClosed", "This host can't be edited right now.");
      if (done === "taken") return fail(c, 409, "linkTaken", "That link is taken. Try another.");
      if (done === "venue") return fail(c, 409, "stillVenue", "This Venue takes bookings by the hour, so it stays a Venue.");
    } catch (e) {
      if (taken(e)) return fail(c, 409, "linkTaken", "That link is taken. Try another.");
      throw e;
    }
    const [h] = await db.select().from(hosts).where(eq(hosts.id, host.id));
    return c.json(await pageOf(h!, c.var.user.id));
  });

  // POST /hosts/:id/pause | resume | archive | restore: the owner only. A suspended host is staff's to lift.
  for (const action of ["pause", "resume", "archive", "restore"] as Action[])
    app.post(`/hosts/:id/${action}`, auth, async (c) => {
      const t = await teamOf(db, c.req.param("id"), c.var.user.id);
      if (!t || t.host.ownerId !== c.var.user.id) return nothing(c);
      const { host } = t;
      // ponytail: events with bookings, and payouts or refunds open, don't exist yet; the Events, Booking and Money
      // slices fill these in.
      const ok = statusRule(host.status, action, { eventsWithBookings: 0, openMoney: 0 });
      const notNow = () => fail(c, 409, "notNow", `You can't ${action} a host that is ${host.status}.`);
      if (!ok.ok) return ok.error === "busy" ? fail(c, 409, "busy", "Wait until every event with bookings has ended and no payout or refund is open.") : notNow();
      // Only if it's still where we read it, so two requests can't both win.
      const [done] = await db.update(hosts).set({ status: ok.to, updatedAt: at() }).where(and(eq(hosts.id, host.id), eq(hosts.status, host.status))).returning();
      if (!done) return notNow();
      await say((await adminsOf(db, host.id)).filter((id) => id !== c.var.user.id), "hostStatus", { hostId: host.id, hostName: host.name, status: done.status });
      return c.json({ id: host.id, status: done.status });
    });

  // ---------- Follows (Discover flow: Follow keeps a host, gives no role) ----------

  // POST /hosts/:id/follow: only a public, live host can be followed.
  app.post("/hosts/:id/follow", auth, async (c) => {
    const id = c.req.param("id");
    const [h] = isUuid(id) ? await db.select({ id: hosts.id }).from(hosts).where(and(eq(hosts.id, id), visible)) : [];
    if (!h) return nothing(c);
    await db.insert(follows).values({ userId: c.var.user.id, hostId: h.id, createdAt: at() }).onConflictDoNothing();
    return c.json({ following: true });
  });

  // DELETE /hosts/:id/follow: whatever the host's state.
  app.delete("/hosts/:id/follow", auth, async (c) => {
    const id = c.req.param("id");
    if (isUuid(id)) await db.delete(follows).where(and(eq(follows.userId, c.var.user.id), eq(follows.hostId, id)));
    return c.body(null, 204);
  });

  // GET /me/follows: newest first. Hosts gone private, paused, suspended or archived are hidden, never deleted.
  // `notify`: whether the host's new events push and email (all) or only reach the inbox (off).
  app.get("/me/follows", auth, async (c) =>
    c.json(
      (
        await db
          .select({ id: hosts.id, slug: hosts.slug, name: hosts.name, city: hosts.city, verifiedAt: hosts.verifiedAt, logo: hosts.logo, notify: follows.notify })
          .from(follows)
          .innerJoin(hosts, eq(hosts.id, follows.hostId))
          .where(and(eq(follows.userId, c.var.user.id), visible))
          .orderBy(desc(follows.createdAt))
      ).map(({ verifiedAt, ...h }) => ({ ...h, verified: !!verifiedAt })),
    ),
  );

  // ---------- The public read ----------

  // GET /public/hosts/:slug: any slug the host has had finds it; the body carries the current one, so the client
  // redirects when it differs. Public reads live under /public so no host's link can collide with /hosts/:id/<word>.
  // Events come with the events slice.
  app.get("/public/hosts/:slug", maybe, async (c) => {
    if (!HostSlug.safeParse(c.req.param("slug")).success) return nothing(c); // a NUL or other odd text never reaches the query
    const [row] = await db
      .select({ host: hosts })
      .from(hostSlugs)
      .innerJoin(hosts, eq(hosts.id, hostSlugs.hostId))
      .where(and(eq(hostSlugs.slug, c.req.param("slug")), visible));
    if (!row) return nothing(c);
    const userId = c.var.user?.id;
    const n = await followersOf(row.host.id);
    const following = userId ? (await db.select().from(follows).where(and(eq(follows.userId, userId), eq(follows.hostId, row.host.id)))).length > 0 : null;
    return c.json({ ...(await profile(row.host)), followers: n >= SHOWN_FROM ? n : null, following });
  });

  // ---------- Galaxy: Hosts and events ----------
  const hostsOnly = requireFeature(db, now, "hosts");
  const hostById = async (id: string) => (isUuid(id) ? ((await db.select().from(hosts).where(eq(hosts.id, id)))[0] ?? null) : null);
  const ownHost = (c: Context) =>
    fail(c, 403, "ownHost", "Staff never act on a host they're on, invited to or left in the last 30 days. Ask another staff member with this access.");

  // GET /galaxy/hosts?q=: by exact slug (any it has had) or by name.
  app.get("/galaxy/hosts", auth, hostsOnly, async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return fail(c, 400, "invalid", "Type at least 2 characters.");
    const bySlug = inArray(hosts.id, db.select({ id: hostSlugs.hostId }).from(hostSlugs).where(eq(hostSlugs.slug, q.toLowerCase())));
    const rows = await db
      .select()
      .from(hosts)
      .where(or(bySlug, ilike(hosts.name, `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)))
      .orderBy(hosts.name)
      .limit(20);
    return c.json(rows.map((h) => ({ id: h.id, slug: h.slug, name: h.name, city: h.city, status: h.status, verified: !!h.verifiedAt })));
  });

  // GET /galaxy/hosts/:id: the staff page. Opening it is logged; the owner's contacts stay masked.
  app.get("/galaxy/hosts/:id", auth, hostsOnly, async (c) => {
    const h = await hostById(c.req.param("id"));
    if (!h) return nothing(c);
    const seats = await db
      .select({ userId: teamRoles.userId, name: users.name, role: teamRoles.role })
      .from(teamRoles)
      .innerJoin(users, eq(users.id, teamRoles.userId))
      .where(and(eq(teamRoles.hostId, h.id), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt)));
    const [owner] = await db.select().from(users).where(eq(users.id, h.ownerId));
    const [parent] = h.parentId ? await db.select({ id: hosts.id, slug: hosts.slug, name: hosts.name }).from(hosts).where(eq(hosts.id, h.parentId)) : [];
    const clubs = await db.select({ id: hosts.id, slug: hosts.slug, name: hosts.name, status: hosts.status }).from(hosts).where(eq(hosts.parentId, h.id)).orderBy(hosts.name);
    await db.transaction((tx) => audit(tx, { actorId: c.var.actor.id, action: "hosts.view", targetHost: h.id }));
    return c.json({
      id: h.id, slug: h.slug, name: h.name, kind: h.kind, city: h.city, about: h.about, website: h.website, logo: h.logo, banner: h.banner,
      status: h.status, visibility: h.visibility, suspendReason: h.suspendReason,
      verified: h.verifiedAt ? { at: h.verifiedAt.toISOString(), by: h.verifiedBy } : null,
      parent: parent ?? null, clubs, followers: await followersOf(h.id),
      team: seats.map((s) => ({ userId: s.userId, name: s.name, role: s.role, owner: s.userId === h.ownerId })),
      owner: masked(owner!),
    });
  });

  // GET /galaxy/teams?page=: every started seat on every host's team, newest first: who runs which host. Names only,
  // as on a host's page, so like the host search it isn't logged.
  app.get("/galaxy/teams", auth, hostsOnly, async (c) => {
    const { page, limit, offset } = listPage(c);
    const live = and(isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt));
    const rows = await db
      .select({ id: teamRoles.id, userId: teamRoles.userId, name: users.name, role: teamRoles.role, since: teamRoles.startedAt, hostId: hosts.id, host: hosts.name, status: hosts.status, ownerId: hosts.ownerId })
      .from(teamRoles)
      .innerJoin(users, eq(users.id, teamRoles.userId))
      .innerJoin(hosts, eq(hosts.id, teamRoles.hostId))
      .where(live)
      .orderBy(desc(teamRoles.startedAt), desc(teamRoles.id))
      .limit(limit)
      .offset(offset);
    const [total] = await db.select({ n: count() }).from(teamRoles).where(live);
    return c.json({
      seats: rows.map(({ ownerId, since, ...s }) => ({ ...s, owner: ownerId === s.userId, since: since!.toISOString() })),
      total: total!.n,
      page,
      pageSize: limit,
    });
  });

  // The host, once staff may act on it: they're not on its team, invited, or recently gone from it (Roles flow).
  const actable = async (c: Context<StaffEnv>, ...ids: string[]) => {
    for (const id of ids) if (await onHost(db, id, c.var.user, now())) return false;
    return true;
  };

  // POST /galaxy/hosts/:id/verify: carries the name staff saw. A rename since then refuses it (Hosts flow: renaming
  // removes verification), so the badge never lands on a name nobody checked.
  app.post("/galaxy/hosts/:id/verify", auth, hostsOnly, async (c) => {
    const b = await parse(c, VerifyHost);
    if (!b) return invalid(c);
    const h = await hostById(c.req.param("id"));
    if (!h) return nothing(c);
    if (!(await actable(c, h.id))) return ownHost(c);
    const done = await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(hosts).where(eq(hosts.id, h.id)).for("update");
      if (cur!.name !== b.name) return "changed" as const;
      if (cur!.verifiedAt) return "already" as const;
      await tx.update(hosts).set({ verifiedAt: at(), verifiedBy: c.var.actor.id, updatedAt: at() }).where(eq(hosts.id, h.id));
      await audit(tx, { actorId: c.var.actor.id, action: "hosts.verify", targetHost: h.id, reason: b.reason, data: { name: cur!.name } });
      return "done" as const;
    });
    if (done === "changed") return fail(c, 409, "changed", "The host changed its name since you opened it. Open it again and check.");
    if (done === "already") return fail(c, 409, "already", "That host is already verified.");
    await sayStaff(h, "hostVerified", {}, "hosts.verify", b.reason, c.var.actor.id);
    return c.json({ id: h.id, verified: true });
  });

  // DELETE /galaxy/hosts/:id/verify
  app.delete("/galaxy/hosts/:id/verify", auth, hostsOnly, async (c) => {
    const b = await parse(c, StaffReason);
    if (!b) return invalid(c);
    const h = await hostById(c.req.param("id"));
    if (!h) return nothing(c);
    if (!(await actable(c, h.id))) return ownHost(c);
    const done = await db.transaction(async (tx) => {
      const [row] = await tx.update(hosts).set({ verifiedAt: null, verifiedBy: null, updatedAt: at() }).where(and(eq(hosts.id, h.id), isNotNull(hosts.verifiedAt))).returning();
      if (row) await audit(tx, { actorId: c.var.actor.id, action: "hosts.unverify", targetHost: h.id, reason: b.reason });
      return row;
    });
    if (!done) return fail(c, 409, "notVerified", "That host isn't verified.");
    await sayStaff(h, "hostUnverified", { reason: b.reason }, "hosts.unverify", b.reason, c.var.actor.id);
    return c.json({ id: h.id, verified: false });
  });

  // POST /galaxy/hosts/:id/suspend: from live, paused, archived, or held for want of an Admin. Tied to no account, so an account
  // coming back never lifts it (liftHostsOf only lifts holds tied to one).
  // ponytail: open payouts holding and refunds going to Orbit come with the Money slice.
  app.post("/galaxy/hosts/:id/suspend", auth, hostsOnly, async (c) => {
    const b = await parse(c, StaffReason);
    if (!b) return invalid(c);
    const h = await hostById(c.req.param("id"));
    if (!h) return nothing(c);
    if (!(await actable(c, h.id))) return ownHost(c);
    const done = await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(hosts).where(eq(hosts.id, h.id)).for("update");
      if (cur!.status === "suspended" && !cur!.suspendedWith) return "already" as const;
      // An archived host is suspended too, and a lift puts it back archived: the owner can't restore it meanwhile.
      const liftTo = cur!.status === "paused" || cur!.status === "archived" ? cur!.status : "live";
      await tx.update(hosts).set({ status: "suspended", suspendReason: b.reason, suspendedWith: null, liftTo, updatedAt: at() }).where(eq(hosts.id, h.id));
      await audit(tx, { actorId: c.var.actor.id, action: "hosts.suspend", targetHost: h.id, reason: b.reason, data: { from: cur!.status, liftTo } });
      return "done" as const;
    });
    if (done === "already") return fail(c, 409, "already", "That host is already suspended by staff.");
    await sayStaff(h, "hostSuspended", { reason: b.reason }, "hosts.suspend", b.reason, c.var.actor.id);
    return c.json({ id: h.id, status: "suspended" });
  });

  // POST /galaxy/hosts/:id/lift: only a staff suspension. If every Admin is still suspended, it's held again at once.
  app.post("/galaxy/hosts/:id/lift", auth, hostsOnly, async (c) => {
    const b = await parse(c, StaffReason);
    if (!b) return invalid(c);
    const h = await hostById(c.req.param("id"));
    if (!h) return nothing(c);
    if (!(await actable(c, h.id))) return ownHost(c);
    const status = await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(hosts).where(eq(hosts.id, h.id)).for("update");
      if (cur!.status !== "suspended" || cur!.suspendedWith) return null;
      const to = cur!.liftTo ?? "live";
      await tx.update(hosts).set({ status: to, suspendReason: null, liftTo: null, updatedAt: at() }).where(eq(hosts.id, h.id));
      await holdIfUnanswered(tx, h.id, at());
      await audit(tx, { actorId: c.var.actor.id, action: "hosts.lift", targetHost: h.id, reason: b.reason, data: { to } });
      return (await tx.select({ status: hosts.status }).from(hosts).where(eq(hosts.id, h.id)))[0]!.status;
    });
    if (!status) return fail(c, 409, "notSuspended", "That host wasn't suspended by staff.");
    await sayStaff(h, "hostLifted", {}, "hosts.lift", b.reason, c.var.actor.id);
    return c.json({ id: h.id, status });
  });

  // PUT /galaxy/hosts/:id/parent: make it a club of another host, one level deep (Hosts decision 3), or null to clear.
  app.put("/galaxy/hosts/:id/parent", auth, hostsOnly, async (c) => {
    const b = await parse(c, SetParent);
    if (!b) return invalid(c);
    const h = await hostById(c.req.param("id"));
    if (!h) return nothing(c);
    if (!(await actable(c, h.id, ...(b.parentId ? [b.parentId] : []), ...(h.parentId ? [h.parentId] : [])))) return ownHost(c);
    const out = await db.transaction(async (tx) => {
      // Both rows locked in id order, so two moves at once can't each pass the depth check or deadlock.
      const ids = [...new Set([h.id, ...(b.parentId ? [b.parentId] : [])])];
      const locked = await tx.select().from(hosts).where(inArray(hosts.id, ids)).orderBy(hosts.id).for("update");
      const parent = locked.find((r) => r.id === b.parentId) ?? null;
      if (b.parentId) {
        const [{ n }] = (await tx.select({ n: count() }).from(hosts).where(eq(hosts.parentId, h.id))) as [{ n: number }];
        const ok = parentRule({ id: h.id, hasClubs: n > 0 }, parent);
        if (!ok.ok) return ok.error;
      }
      const from = locked.find((r) => r.id === h.id)!.parentId;
      await tx.update(hosts).set({ parentId: b.parentId, updatedAt: at() }).where(eq(hosts.id, h.id));
      await audit(tx, { actorId: c.var.actor.id, action: "hosts.parent", targetHost: h.id, reason: b.reason, data: { from, to: b.parentId } });
      return parent?.name ?? null;
    });
    if (out === "self") return fail(c, 400, "self", "A host can't be its own parent.");
    if (out === "notFound") return fail(c, 404, "notFound", "Pick a host that exists and isn't archived.");
    if (out === "tooDeep") return fail(c, 409, "tooDeep", "A club can't have clubs of its own; Orbit hosts go one level deep.");
    await sayStaff(h, "hostParentSet", { parentId: b.parentId, parentName: out }, "hosts.parent", b.reason, c.var.actor.id);
    return c.json({ id: h.id, parentId: b.parentId });
  });

  return app;
}
