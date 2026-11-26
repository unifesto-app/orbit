import { and, count, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lte, ne, notLike, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { GrantFeatures, InviteAdmin, Lift, type NoticeKind, readPhone, STAFF_FEATURES, type StaffFeature, StaffReason, StartHost, Suspend } from "@orbit/contract";
import type { Store } from "../auth/store.ts";
import type { Db } from "../db/index.ts";
import { auditLog, hosts, hostSlugs, sessions, staffGrants, teamRoles, users } from "../db/schema.ts";
import { contactOf, type Env, fail, invalid, isUuid, type Notify, listPage, parse, signedIn, taken } from "../http.ts";
import { activeFeatures, adminsOf, changeable, holdersOf, masked, holdIfUnanswered, liftHostsOf, person, type StaffEnv, requireFeature, teamOf as teamOf_, tell } from "./access.ts";
import { slugFor } from "../slugs.ts";
import { acceptRule, addRule, confirmRule, confirmSeatRule, endRule, endSeatRule, expired, holds, INVITE_DAYS, suspendRule, waiting } from "./rules.ts";

// Hosts and their teams, and Galaxy's staff and People tools (Orbit flows: Roles, Hosts and Galaxy).

type Deps = { db: Db; store: Store; notify: Notify; secret: string; now?: () => number };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const HOSTS_PER_DAY = 5;
const INVITES_PER_DAY = 20; // per inviter; and 1 a day per address, so the invite email is no relay
const DAY = 24 * 3600 * 1000;
const IST = 5.5 * 3600 * 1000; // India is UTC+5:30, with no daylight saving
const HEAVY_PAGES = 20; // 1,000 accounts: a day of honest support work rarely pages this far

const ERRORS: Record<string, [403 | 404 | 409, string]> = {
  forbidden: [404, "There's nothing here."],
  self: [403, "Staff never act on themselves. Ask another staff member with this access."],
  owner: [403, "The platform owner can't be changed here."],
  needsStaff: [403, "Acting on a staff account needs Staff access as well as People."],
  notWaiting: [409, "That's no longer waiting."],
  notOpen: [409, "That has already ended."],
  notFound: [404, "That invite isn't for this account, or has gone."],
  notAccepted: [409, "They haven't accepted yet."],
  lapsed: [409, "That invite lapsed after 14 days. Send a new one."],
};
const refuse = (c: Context, error: string) => fail(c, ERRORS[error]![0], error, ERRORS[error]![1]);

// Thrown by startHost for an account with neither phone nor email: the Admin seat needs a contact.
export class NoContact extends Error {}
export const noContact = (c: Context) => fail(c, 409, "noContact", "They need a phone or email on their account first.");

// A new host, live and unverified, with `u` as its owner and started Admin. POST /hosts and an approved Event Request.
export async function startHost(
  tx: Tx,
  b: { name: string; kind: string; city: string; about?: string | null },
  u: { id: string; phone: string | null; email: string | null },
  at: Date,
) {
  const contact = u.phone ?? u.email;
  if (!contact) throw new NoContact();
  const [h] = await tx.insert(hosts).values({ ...b, slug: slugFor(b.name), ownerId: u.id, createdBy: u.id, createdAt: at, updatedAt: at }).returning();
  await tx.insert(hostSlugs).values({ slug: h!.slug, hostId: h!.id, createdAt: at });
  await tx.insert(teamRoles).values({ hostId: h!.id, role: "admin", contact, userId: u.id, addedBy: u.id, addedAt: at, acceptedAt: at, startedAt: at });
  return h!;
}

export function rolesRoutes({ db, store, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());
  const audit = (tx: Tx, row: Omit<typeof auditLog.$inferInsert, "at">) => tx.insert(auditLog).values({ ...row, at: at() });

  const holders = (f: StaffFeature) => holdersOf(db, f, at());
  const say = (ids: string[], kind: NoticeKind, data: Record<string, unknown>) => tell(notify, ids, kind, data);

  // ---------- Hosts and teams ----------

  const teamOf = (hostId: string, userId: string) => teamOf_(db, hostId, userId);
  const seatById = async (hostId: string, seatId: string) =>
    isUuid(seatId) ? ((await db.select().from(teamRoles).where(and(eq(teamRoles.id, seatId), eq(teamRoles.hostId, hostId))))[0] ?? null) : null;
  const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");

  // POST /hosts: Start a host. Live at once, unverified, with the starter as its owner and Admin.
  app.post("/hosts", auth, async (c) => {
    const b = await parse(c, StartHost);
    if (!b) return invalid(c);
    const u = c.var.user;
    const host = await db
      .transaction(async (tx) => {
        // Counted under a lock on the person, so hosts started at once still meet the limit.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, u.id)).for("update");
        const [made] = await tx.select({ n: count() }).from(hosts).where(and(eq(hosts.createdBy, u.id), gt(hosts.createdAt, new Date(now() - DAY))));
        if (made!.n >= HOSTS_PER_DAY) return null;
        return startHost(tx, b, u, at());
      })
      .catch((e) => (e instanceof NoContact ? e : Promise.reject(e)));
    if (host instanceof NoContact) return noContact(c);
    if (!host) return fail(c, 429, "tooMany", `You can start ${HOSTS_PER_DAY} hosts a day. Try again tomorrow.`);
    return c.json({ id: host.id, slug: host.slug, name: host.name, kind: host.kind, city: host.city, status: host.status }, 201);
  });

  // GET /hosts/:id/team: everyone on the team reads it; only Admins see waiting invites, with who accepted each, so the
  // adder can check it's the right person before confirming.
  app.get("/hosts/:id/team", auth, async (c) => {
    const t = await teamOf(c.req.param("id"), c.var.user.id);
    if (!t) return nothing(c);
    const rows = await db
      .select({ seat: teamRoles, name: users.name })
      .from(teamRoles)
      .leftJoin(users, eq(users.id, teamRoles.userId))
      .where(and(eq(teamRoles.hostId, t.host.id), isNull(teamRoles.endedAt)))
      .orderBy(desc(teamRoles.addedAt));
    const members = rows
      .filter((r) => r.seat.startedAt)
      .map((r) => ({ id: r.seat.id, userId: r.seat.userId, name: r.name, role: r.seat.role, owner: r.seat.userId === t.host.ownerId }));
    const invites =
      t.mine.role === "admin"
        ? rows
            .filter((r) => waiting(r.seat, now()))
            .map((r) => ({ id: r.seat.id, contact: r.seat.contact, accepted: !!r.seat.acceptedAt, acceptedBy: r.seat.acceptedAt ? r.name : null, addedBy: r.seat.addedBy }))
        : [];
    return c.json({ members, invites });
  });

  // POST /hosts/:id/team: invite an Admin, or a Venue's Desk, by phone or email. The answer is the same whether or not they're on Orbit.
  app.post("/hosts/:id/team", auth, async (c) => {
    const b = await parse(c, InviteAdmin);
    if (!b) return invalid(c);
    const to = contactOf(c, b.to);
    if (to instanceof Response) return to;
    const contact = to.kind === "phone" ? to.e164 : to.email;
    const t = await teamOf(c.req.param("id"), c.var.user.id);
    if (t?.mine.role !== "admin") return nothing(c);
    const { host } = t;
    if (!changeable(host)) return fail(c, 409, "hostClosed", "This host can't change its team right now.");
    // Desk is a crew seat with no event, and only a Venue has a counter.
    const desk = b.role === "desk";
    if (desk && host.kind !== "venue") return fail(c, 400, "notVenue", "Desk is for a Venue's counter.");

    const [open] = await db.select().from(teamRoles).where(and(eq(teamRoles.hostId, host.id), eq(teamRoles.contact, contact), isNull(teamRoles.endedAt)));
    const invited = () => fail(c, 409, "invited", "They already have an invite waiting. Withdraw it to send a new one.");
    if (open && !expired(open, now())) return open.startedAt ? fail(c, 409, "onTeam", "They're already on this team.") : invited();
    const tooMany = () => fail(c, 429, "tooMany", "Too many tries today. Try again tomorrow.");
    if ((await store.incr(`invite:${c.var.user.id}`, DAY)) > INVITES_PER_DAY) return tooMany();
    if ((await store.incr(`invited:${contact}`, DAY)) > 1) return tooMany();
    let seat;
    try {
      seat = await db.transaction(async (tx) => {
        if (open) await tx.update(teamRoles).set({ endedAt: at(), endReason: "expired" }).where(eq(teamRoles.id, open.id));
        const [s] = await tx.insert(teamRoles).values({ hostId: host.id, role: desk ? "crew" : "admin", contact, addedBy: c.var.user.id, addedAt: at() }).returning();
        return s!;
      });
    } catch (e) {
      if (taken(e)) return invited(); // another invite to them landed at the same moment
      throw e;
    }
    await notify({ to: { contact }, kind: "teamInvite", data: { seatId: seat.id, hostId: host.id, hostName: host.name, role: desk ? "desk" : "admin" } });
    return c.json({ id: seat.id, contact, status: "waiting" }, 201);
  });

  // The person's verified phone and email: an invite is theirs only if it went to one of them.
  const contactsOf = (u: Env["Variables"]["user"]) => [u.phoneVerifiedAt && u.phone, u.emailVerifiedAt && u.email].filter((x): x is string => !!x);

  // GET /me/invites: team roles waiting for this account.
  app.get("/me/invites", auth, async (c) => {
    const mine = contactsOf(c.var.user);
    if (!mine.length) return c.json([]);
    const rows = await db
      .select({ seat: teamRoles, hostName: hosts.name })
      .from(teamRoles)
      .innerJoin(hosts, eq(hosts.id, teamRoles.hostId))
      .where(and(inArray(teamRoles.contact, mine), isNull(teamRoles.endedAt), isNull(teamRoles.startedAt)));
    return c.json(
      rows.filter((r) => waiting(r.seat, now())).map((r) => ({ id: r.seat.id, hostId: r.seat.hostId, hostName: r.hostName, role: r.seat.role, accepted: !!r.seat.acceptedAt })),
    );
  });

  // POST /invites/:id/accept. An Admin role then waits for the adder to confirm it's the right person. A crew seat (Desk)
  // starts on Accept: it holds no money and edits nothing, and the Roles review asked for no confirm step.
  app.post("/invites/:id/accept", auth, async (c) => {
    const id = c.req.param("id");
    const [seat] = isUuid(id) ? await db.select().from(teamRoles).where(eq(teamRoles.id, id)) : [];
    if (!seat) return refuse(c, "notFound");
    const ok = acceptRule(seat, contactsOf(c.var.user).includes(seat.contact), now());
    if (!ok.ok) return refuse(c, ok.error);
    try {
      const done = await db.transaction(async (tx) => {
        // Their own places on this host that lapsed unconfirmed don't stand in the way of this one.
        await tx
          .update(teamRoles)
          .set({ endedAt: at(), endReason: "expired" })
          .where(
            and(
              eq(teamRoles.hostId, seat.hostId),
              eq(teamRoles.userId, c.var.user.id),
              isNull(teamRoles.startedAt),
              isNull(teamRoles.endedAt),
              lte(teamRoles.addedAt, new Date(now() - INVITE_DAYS * DAY)),
            ),
          );
        // A Desk seat starts here, so it gets the checks an Admin's confirm makes: the host still has a counter and can
        // change its team, and whoever sent it is still one of its Admins.
        if (seat.role === "crew") {
          const [h] = await tx.select().from(hosts).where(eq(hosts.id, seat.hostId)).for("share");
          if (!h || h.kind !== "venue" || !changeable(h)) return "closed" as const;
          const [adder] = await tx
            .select({ id: teamRoles.id })
            .from(teamRoles)
            .where(and(eq(teamRoles.hostId, h.id), eq(teamRoles.userId, seat.addedBy), eq(teamRoles.role, "admin"), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt)));
          if (!adder) return undefined;
        }
        const [row] = await tx
          .update(teamRoles)
          .set({ userId: c.var.user.id, acceptedAt: at(), ...(seat.role === "crew" ? { startedAt: at() } : {}) })
          .where(and(eq(teamRoles.id, seat.id), isNull(teamRoles.acceptedAt), isNull(teamRoles.endedAt)))
          .returning();
        return row;
      });
      if (done === "closed") return fail(c, 409, "hostClosed", "This host can't change its team right now.");
      if (!done) return refuse(c, "notWaiting");
    } catch (e) {
      // One open place per person on a host: an invite by phone and another by email can't both be accepted.
      if (taken(e)) return fail(c, 409, "onTeam", "You're already on this team, or have accepted a place on it.");
      throw e;
    }
    await notify({ to: { userId: seat.addedBy }, kind: "teamAccepted", data: { seatId: seat.id, hostId: seat.hostId, name: c.var.user.name } });
    return c.json({ id: seat.id, status: seat.role === "crew" ? "started" : "accepted" });
  });

  // POST /hosts/:id/team/:seat/confirm: the adder confirms it's the right person, and the Admin role starts.
  app.post("/hosts/:id/team/:seat/confirm", auth, async (c) => {
    const t = await teamOf(c.req.param("id"), c.var.user.id);
    const seat = t && (await seatById(t.host.id, c.req.param("seat")));
    if (!t || !seat) return nothing(c);
    const ok = confirmSeatRule(c.var.user.id, t.mine.role === "admin", seat, now());
    if (!ok.ok) return refuse(c, ok.error);
    if (!changeable(t.host)) return fail(c, 409, "hostClosed", "This host can't change its team right now.");
    const [done] = await db
      .update(teamRoles)
      .set({ startedAt: at() })
      .where(and(eq(teamRoles.id, seat.id), isNull(teamRoles.startedAt), isNull(teamRoles.endedAt)))
      .returning();
    if (!done) return refuse(c, "notWaiting");
    await notify({ to: { userId: seat.userId! }, kind: "teamRoleStarted", data: { hostId: t.host.id, hostName: t.host.name, role: seat.role } });
    return c.json({ id: seat.id, status: "started" });
  });

  // DELETE /hosts/:id/team/:seat: withdraw an invite, or remove someone. Events they made stay.
  app.delete("/hosts/:id/team/:seat", auth, async (c) => {
    const t = await teamOf(c.req.param("id"), c.var.user.id);
    const seat = t && (await seatById(t.host.id, c.req.param("seat")));
    if (!t || !seat) return nothing(c);
    const ok = endSeatRule(c.var.user.id, t.mine.role === "admin", { ...seat, owner: !!seat.startedAt && seat.userId === t.host.ownerId }, now());
    if (!ok.ok)
      return ok.error === "owner"
        ? fail(c, 403, "owner", "The owner can't be removed.")
        : ok.error === "self"
          ? fail(c, 403, "self", "To step down, leave the team instead.")
          : refuse(c, ok.error);
    const [ended] = await db
      .update(teamRoles)
      .set({ endedAt: at(), endedBy: c.var.user.id, endReason: ok.reason })
      .where(and(eq(teamRoles.id, seat.id), isNull(teamRoles.endedAt)))
      .returning();
    if (!ended) return refuse(c, "notOpen");
    if (ok.reason === "removed") await holdIfUnanswered(db, t.host.id, at());
    const data = { hostId: t.host.id, hostName: t.host.name };
    if (ok.reason === "removed") await notify({ to: { userId: seat.userId! }, kind: "teamRemoved", data });
    else if (seat.addedBy !== c.var.user.id) await notify({ to: { userId: seat.addedBy }, kind: "teamInviteWithdrawn", data: { ...data, contact: seat.contact } });
    // ponytail: nobody is told when an invite lapses after 14 days; that needs the job runner (Notifications flow).
    return c.body(null, 204);
  });

  // POST /hosts/:id/leave. The owner can't leave.
  app.post("/hosts/:id/leave", auth, async (c) => {
    const t = await teamOf(c.req.param("id"), c.var.user.id);
    if (!t) return nothing(c);
    if (t.host.ownerId === c.var.user.id) return fail(c, 403, "owner", "The owner can't leave. Ask Orbit to change the owner first.");
    await db.update(teamRoles).set({ endedAt: at(), endedBy: c.var.user.id, endReason: "left" }).where(and(eq(teamRoles.id, t.mine.id), isNull(teamRoles.endedAt)));
    await holdIfUnanswered(db, t.host.id, at());
    await say(await adminsOf(db, t.host.id), "teamLeft", { hostId: t.host.id, hostName: t.host.name, name: c.var.user.name });
    return c.body(null, 204);
  });

  // ---------- Galaxy: Platform › Staff ----------
  const staffOnly = requireFeature(db, now, "staff");
  const grantById = async (id: string) => (isUuid(id) ? ((await db.select().from(staffGrants).where(eq(staffGrants.id, id)))[0] ?? null) : null);

  // GET /galaxy/staff: every open grant, waiting or active.
  app.get("/galaxy/staff", auth, staffOnly, async (c) => {
    const rows = await db
      .select({ grant: staffGrants, name: users.name })
      .from(staffGrants)
      .innerJoin(users, eq(users.id, staffGrants.userId))
      .where(isNull(staffGrants.endedAt))
      .orderBy(desc(staffGrants.addedAt));
    await db.transaction((tx) => audit(tx, { actorId: c.var.actor.id, action: "staff.list" }));
    return c.json(
      rows.map(({ grant: g, name }) => ({
        id: g.id,
        userId: g.userId,
        name,
        feature: g.feature,
        addedBy: g.addedBy,
        status: !g.startsAt ? "waitingConfirm" : g.startsAt.getTime() > now() ? "startsLater" : "active",
        startsAt: g.startsAt?.toISOString() ?? null,
      })),
    );
  });

  // POST /galaxy/staff/grants: give features. They wait for a second holder of Staff, or 24 hours for the owner's.
  app.post("/galaxy/staff/grants", auth, staffOnly, async (c) => {
    const b = await parse(c, GrantFeatures);
    if (!b) return invalid(c);
    const [target] = await db.select().from(users).where(and(eq(users.id, b.userId), isNull(users.deletedAt)));
    if (!target) return fail(c, 404, "notFound", "No account with that id.");
    const ok = addRule(c.var.actor, { id: target.id, owner: target.platformOwner }, now());
    if (!ok.ok) return refuse(c, ok.error);
    try {
      const made = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(staffGrants)
          .values(b.features.map((feature) => ({ userId: target.id, feature, addedBy: c.var.actor.id, addedAt: at(), startsAt: ok.startsAt })))
          .returning();
        await audit(tx, { actorId: c.var.actor.id, action: "staff.grant", targetUser: target.id, reason: b.reason, data: { features: b.features, startsAt: ok.startsAt } });
        return rows;
      });
      await say(await holders("staff"), "staffGrantAdded", { userId: target.id, features: b.features, reason: b.reason, by: c.var.actor.id, startsAt: ok.startsAt?.toISOString() ?? null, grants: made.map((g) => g.id) });
      return c.json(made.map((g) => ({ id: g.id, feature: g.feature, status: g.startsAt ? "startsLater" : "waitingConfirm" })), 201);
    } catch (e) {
      if (taken(e)) return fail(c, 409, "hasFeature", "They already have, or are waiting for, one of those features.");
      throw e;
    }
  });

  // POST /galaxy/staff/grants/:id/confirm: a second holder of Staff, neither the adder nor the person.
  app.post("/galaxy/staff/grants/:id/confirm", auth, staffOnly, async (c) => {
    const b = await parse(c, StaffReason);
    if (!b) return invalid(c);
    const g = await grantById(c.req.param("id"));
    if (!g) return fail(c, 404, "notFound", "There's nothing here.");
    const ok = confirmRule(c.var.actor, g);
    if (!ok.ok) return refuse(c, ok.error);
    const done = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(staffGrants)
        .set({ confirmedBy: c.var.actor.id, startsAt: at() })
        .where(and(eq(staffGrants.id, g.id), isNull(staffGrants.startsAt), isNull(staffGrants.endedAt)))
        .returning();
      if (row) await audit(tx, { actorId: c.var.actor.id, action: "staff.confirm", targetUser: g.userId, reason: b.reason, data: { feature: g.feature } });
      return row;
    });
    if (!done) return refuse(c, "notWaiting");
    await say(await holders("staff"), "staffGrantStarted", { userId: g.userId, feature: g.feature, reason: b.reason, by: c.var.actor.id });
    return c.json({ id: g.id, status: "active" });
  });

  // DELETE /galaxy/staff/grants/:id: take a feature away, or cancel one still waiting. At once.
  app.delete("/galaxy/staff/grants/:id", auth, staffOnly, async (c) => {
    const b = await parse(c, StaffReason);
    if (!b) return invalid(c);
    const g = await grantById(c.req.param("id"));
    if (!g) return fail(c, 404, "notFound", "There's nothing here.");
    const ok = endRule(c.var.actor, g);
    if (!ok.ok) return refuse(c, ok.error);
    const ended = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(staffGrants)
        .set({ endedAt: at(), endedBy: c.var.actor.id })
        .where(and(eq(staffGrants.id, g.id), isNull(staffGrants.endedAt)))
        .returning();
      if (!row) return null;
      // Losing Staff takes their adds still waiting with it, so a holder removed for cause leaves nothing to confirm.
      const dropped =
        g.feature === "staff"
          ? await tx
              .update(staffGrants)
              .set({ endedAt: at(), endedBy: c.var.actor.id })
              .where(and(eq(staffGrants.addedBy, g.userId), isNull(staffGrants.endedAt), or(isNull(staffGrants.startsAt), gt(staffGrants.startsAt, at()))))
              .returning({ id: staffGrants.id })
          : [];
      await audit(tx, { actorId: c.var.actor.id, action: "staff.end", targetUser: g.userId, reason: b.reason, data: { feature: g.feature, alsoEnded: dropped.map((d) => d.id) } });
      return row;
    });
    if (!ended) return refuse(c, "notOpen");
    await say([...new Set([...(await holders("staff")), g.userId])], "staffGrantEnded", { userId: g.userId, feature: g.feature, reason: b.reason, by: c.var.actor.id });
    return c.body(null, 204);
  });

  // ---------- Galaxy: People ----------
  const peopleOnly = requireFeature(db, now, "people");
  // Holders of Staff search too, to find who to give access to.
  const peopleOrStaff = requireFeature(db, now, "people", "staff");
  // GET /galaxy/people?q=: by exact phone or email, or by name; without q, every account, newest first (People only).
  // Contacts show in full to holders of People, masked to holders of Staff alone. Every read is logged, by ids only.
  app.get("/galaxy/people", auth, peopleOrStaff, async (c) => {
    const shown = holds(c.var.actor, "people") ? person : masked;
    if (c.req.query("q") === undefined) {
      if (!holds(c.var.actor, "people")) return refuse(c, "forbidden");
      const { page, limit, offset } = listPage(c);
      const live = isNull(users.deletedAt); // a deleted account's row stays, scrubbed, for bookings and payments
      const rows = await db.select().from(users).where(live).orderBy(desc(users.createdAt), desc(users.id)).limit(limit).offset(offset);
      const [total] = await db.select({ n: count() }).from(users).where(live);
      await db.transaction((tx) => audit(tx, { actorId: c.var.actor.id, action: "people.list", data: { page, results: rows.map((r) => r.id) } }));
      // Paging is how every contact could be taken, so each HEAVY_PAGES pages one person reads in a day (India's)
      // tell everyone with People; nobody is stopped (owner, 17 Nov 2026: "Alert on heavy paging"). Every 20th, not
      // only the first, so two pages read at once across the line can't skip it for the rest of the day.
      const dayStart = new Date(Math.floor((now() + IST) / DAY) * DAY - IST);
      const [today] = await db
        .select({ n: count() })
        .from(auditLog)
        .where(and(eq(auditLog.actorId, c.var.actor.id), eq(auditLog.action, "people.list"), gte(auditLog.at, dayStart)));
      if (today!.n % HEAVY_PAGES === 0) await say(await holders("people"), "staffHeavyPaging", { by: c.var.actor.id, pages: today!.n });
      return c.json({ people: rows.map(person), total: total!.n, page, pageSize: limit });
    }
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 3) return fail(c, 400, "invalid", "Type at least 3 characters.");
    const phone = readPhone(q);
    const exact = typeof phone === "string" && phone !== "abroad" ? eq(users.phone, phone) : q.includes("@") ? eq(users.email, q.toLowerCase()) : null;
    // Holders of Staff alone find someone to give access to by their exact number or email; browsing by name is People's.
    if (!exact && !holds(c.var.actor, "people")) return fail(c, 400, "invalid", "Search by their exact phone number or email.");
    const where = exact ?? ilike(users.name, `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const rows = await db.select().from(users).where(and(where, isNull(users.deletedAt))).limit(20);
    // Only ids are kept, never the phone or email typed, so a deleted person leaves no contact in the log.
    const by = exact ? (q.includes("@") ? "email" : "phone") : "name";
    await db.transaction((tx) => audit(tx, { actorId: c.var.actor.id, action: "people.search", data: { by, results: rows.map((r) => r.id) } }));
    return c.json(rows.map(shown));
  });

  // GET /galaxy/people/:id: a person's page (Galaxy flow, People): contacts and the ways in, staff access, the hosts
  // they're an Admin of, signed-in devices and what staff did to the account. Opening it is logged.
  app.get("/galaxy/people/:id", auth, peopleOnly, async (c) => {
    const id = c.req.param("id");
    const [u] = isUuid(id) ? await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))) : [];
    if (!u) return fail(c, 404, "notFound", "No account with that id.");
    // Staff access, and the staff.* rows in the history, are for holders of Staff, as the Staff page is.
    const seesStaff = holds(c.var.actor, "staff");
    const staff = !seesStaff ? null : u.platformOwner ? [...STAFF_FEATURES] : await activeFeatures(db, u.id, now());
    const onHosts = await db
      .select({ id: hosts.id, slug: hosts.slug, name: hosts.name, status: hosts.status, ownerId: hosts.ownerId })
      .from(teamRoles)
      .innerJoin(hosts, eq(hosts.id, teamRoles.hostId))
      .where(and(eq(teamRoles.userId, u.id), isNotNull(teamRoles.startedAt), isNull(teamRoles.endedAt)))
      .orderBy(hosts.name);
    const devices = await db
      .select({ name: sessions.name, client: sessions.client, since: sessions.createdAt, lastActive: sessions.lastActiveAt })
      .from(sessions)
      .where(and(eq(sessions.userId, u.id), isNull(sessions.endedAt), gt(sessions.expiresAt, at())))
      .orderBy(desc(sessions.lastActiveAt));
    // What was done to the account, never who opened this page: views would push the suspensions out of the last 50.
    const history = await db
      .select({ action: auditLog.action, by: users.name, reason: auditLog.reason, at: auditLog.at })
      .from(auditLog)
      .innerJoin(users, eq(users.id, auditLog.actorId))
      .where(and(eq(auditLog.targetUser, u.id), ne(auditLog.action, "people.view"), seesStaff ? undefined : notLike(auditLog.action, "staff.%")))
      .orderBy(desc(auditLog.at))
      .limit(50);
    await db.transaction((tx) => audit(tx, { actorId: c.var.actor.id, action: "people.view", targetUser: u.id }));
    return c.json({
      ...person(u),
      phoneVerified: !!u.phoneVerifiedAt,
      emailVerified: !!u.emailVerifiedAt,
      dob: u.dob,
      gender: u.gender,
      suspendedUntil: u.suspendedUntil?.toISOString() ?? null,
      suspensionReason: u.suspensionReason,
      deletionDue: u.deletionDueAt?.toISOString() ?? null,
      owner: seesStaff ? u.platformOwner : null,
      staff,
      hosts: onHosts.map(({ ownerId, ...h }) => ({ ...h, owner: ownerId === u.id })),
      devices: devices.map((d) => ({ ...d, since: d.since.toISOString(), lastActive: d.lastActive.toISOString() })),
      history: history.map((h) => ({ ...h, at: h.at.toISOString() })),
    });
  });

  const isStaffAccount = async (userId: string) =>
    (await db.select({ id: staffGrants.id }).from(staffGrants).where(and(eq(staffGrants.userId, userId), isNull(staffGrants.endedAt))).limit(1)).length > 0;

  // POST /galaxy/people/:id/suspend: until a date, or closed for good. Ends every session at once, and suspends hosts
  // where they're the only Admin, so nothing keeps selling with nobody to answer.
  app.post("/galaxy/people/:id/suspend", auth, peopleOnly, async (c) => {
    const b = await parse(c, Suspend);
    if (!b) return invalid(c);
    if (b.until && Date.parse(b.until) <= now()) return fail(c, 400, "invalid", "Pick a time in the future, or close the account for good.");
    const id = c.req.param("id");
    const [target] = isUuid(id) ? await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))) : [];
    if (!target) return fail(c, 404, "notFound", "No account with that id.");
    const ok = suspendRule(c.var.actor, { id: target.id, owner: target.platformOwner, staff: await isStaffAccount(target.id) });
    if (!ok.ok) return refuse(c, ok.error);

    const held = await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ suspendedAt: at(), suspendedUntil: b.until ? new Date(b.until) : null, suspensionReason: b.reason, updatedAt: at() })
        .where(eq(users.id, target.id));
      await tx.update(sessions).set({ endedAt: at() }).where(and(eq(sessions.userId, target.id), isNull(sessions.endedAt)));
      // Live hosts where no other Admin can answer: none, or only ones suspended themselves. A paused host isn't selling.
      const alone = await tx.execute<{ id: string }>(sql`
        select h.id from hosts h
        join team_roles t on t.host_id = h.id and t.user_id = ${target.id} and t.role = 'admin' and t.started_at is not null and t.ended_at is null
        where h.status = 'live'
          and not exists (select 1 from team_roles o join users ou on ou.id = o.user_id
                          where o.host_id = h.id and o.role = 'admin' and o.started_at is not null and o.ended_at is null
                            and o.user_id <> ${target.id}
                            and not (ou.suspended_at is not null and (ou.suspended_until is null or ou.suspended_until > ${at().toISOString()}::timestamptz)))`);
      const found = [...alone].map((r) => r.id);
      // Still live when the update lands: a host staff suspended meanwhile keeps its own suspension.
      const ids = found.length
        ? (await tx.update(hosts).set({ status: "suspended", suspendedWith: target.id, updatedAt: at() }).where(and(inArray(hosts.id, found), eq(hosts.status, "live"))).returning({ id: hosts.id })).map((r) => r.id)
        : [];
      await audit(tx, { actorId: c.var.actor.id, action: "people.suspend", targetUser: target.id, reason: b.reason, data: { until: b.until, hosts: ids } });
      return ids;
    });
    await notify({ to: { userId: target.id }, kind: "accountSuspended", data: { until: b.until, reason: b.reason } });
    await say(await holders("people"), "staffRiskyAction", { action: "people.suspend", userId: target.id, reason: b.reason, by: c.var.actor.id });
    return c.json({ id: target.id, suspended: true, hosts: held });
  });

  // POST /galaxy/people/:id/lift: lifts the suspension, and the hosts it suspended.
  app.post("/galaxy/people/:id/lift", auth, peopleOnly, async (c) => {
    const b = await parse(c, Lift);
    if (!b) return invalid(c);
    const id = c.req.param("id");
    const [target] = isUuid(id) ? await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))) : [];
    if (!target) return fail(c, 404, "notFound", "No account with that id.");
    const ok = suspendRule(c.var.actor, { id: target.id, owner: target.platformOwner, staff: await isStaffAccount(target.id) });
    if (!ok.ok) return refuse(c, ok.error);
    if (!target.suspendedAt) return fail(c, 409, "notSuspended", "That account isn't suspended.");
    await db.transaction(async (tx) => {
      await tx.update(users).set({ suspendedAt: null, suspendedUntil: null, suspensionReason: null, updatedAt: at() }).where(eq(users.id, target.id));
      await liftHostsOf(tx, target.id, at());
      await audit(tx, { actorId: c.var.actor.id, action: "people.lift", targetUser: target.id, reason: b.reason });
    });
    await notify({ to: { userId: target.id }, kind: "accountLifted", data: {} });
    await say(await holders("people"), "staffRiskyAction", { action: "people.lift", userId: target.id, reason: b.reason, by: c.var.actor.id });
    return c.json({ id: target.id, suspended: false });
  });

  return app;
}

