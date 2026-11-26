import { and, count, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { DecideRequest, type EventRequest, NewEventRequest, RequestStatus, type StaffEventRequest } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { auditLog, eventRequests, users } from "../db/schema.ts";
import { fail, invalid, isUuid, listPage, type Notify, parse, signedIn, taken } from "../http.ts";
import { newDraft } from "../events/routes.ts";
import { holdersOf, masked, requireFeature, type StaffEnv, tell } from "../roles/access.ts";
import { startHost } from "../roles/routes.ts";

// Event Requests (contract/src/requests.ts; docs/context/event-partner-api.md 2b): a person asks to host; staff with
// Hosts approve, ask for changes or decline. Approving starts the host (as POST /hosts does, without its daily cap: staff
// chose it) with the requester as owner and Admin, and the first event as a draft. Each answer reaches the requester.

type Deps = { db: Db; notify: Notify; secret: string; now?: () => number };
type Row = typeof eventRequests.$inferSelect;

const WAITING = ["open", "changes"] as const;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");

const toOut = (r: Row): EventRequest => ({
  id: r.id, status: r.status, note: r.note, host: r.host, event: r.event, hostId: r.hostId, eventId: r.eventId,
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), decidedAt: iso(r.decidedAt),
});

export function requestsRoutes({ db, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());
  const mineWaiting = (userId: string) => and(eq(eventRequests.userId, userId), inArray(eventRequests.status, WAITING));

  // ---------- The requester ----------

  // POST /event-requests: one waiting at a time (the partial unique index decides a race).
  app.post("/event-requests", auth, async (c) => {
    const b = await parse(c, NewEventRequest);
    if (!b) return invalid(c);
    try {
      const [r] = await db.insert(eventRequests).values({ userId: c.var.user.id, host: b.host, event: b.event, createdAt: at(), updatedAt: at() }).returning();
      return c.json(toOut(r!), 201);
    } catch (e) {
      if (taken(e)) return fail(c, 409, "requestOpen", "You already have a request waiting. Edit or withdraw it first.");
      throw e;
    }
  });

  // GET /me/event-request: the latest, whatever became of it, or null.
  app.get("/me/event-request", auth, async (c) => {
    const [r] = await db.select().from(eventRequests).where(eq(eventRequests.userId, c.var.user.id)).orderBy(desc(eventRequests.createdAt)).limit(1);
    return c.json(r ? toOut(r) : null);
  });

  // PATCH /me/event-request: the whole request again, only after staff asked for changes; it goes back to open.
  app.patch("/me/event-request", auth, async (c) => {
    const b = await parse(c, NewEventRequest);
    if (!b) return invalid(c);
    const [r] = await db
      .update(eventRequests)
      .set({ host: b.host, event: b.event, status: "open", note: null, updatedAt: at() })
      .where(and(eq(eventRequests.userId, c.var.user.id), eq(eventRequests.status, "changes")))
      .returning();
    return r ? c.json(toOut(r)) : fail(c, 409, "notChanges", "You can edit your request only when Orbit asks for changes.");
  });

  // DELETE /me/event-request: withdraw the waiting one.
  app.delete("/me/event-request", auth, async (c) => {
    const [r] = await db.update(eventRequests).set({ status: "withdrawn", updatedAt: at() }).where(mineWaiting(c.var.user.id)).returning();
    return r ? c.json(toOut(r)) : nothing(c);
  });

  // ---------- Galaxy: Hosts ----------
  const hostsOnly = requireFeature(db, now, "hosts");
  const forStaff = (r: Row, u: typeof users.$inferSelect): StaffEventRequest => {
    const m = masked(u);
    return { ...toOut(r), user: { id: m.id, name: m.name, phone: m.phone, email: m.email }, decidedBy: r.decidedBy };
  };

  // GET /galaxy/event-requests?status=&page=: oldest first, so the longest waiting is answered first. Default: open.
  app.get("/galaxy/event-requests", auth, hostsOnly, async (c) => {
    const status = RequestStatus.safeParse(c.req.query("status") ?? "open");
    if (!status.success) return invalid(c);
    const { page, limit, offset } = listPage(c);
    const where = eq(eventRequests.status, status.data);
    const rows = await db
      .select()
      .from(eventRequests)
      .innerJoin(users, eq(users.id, eventRequests.userId))
      .where(where)
      .orderBy(eventRequests.createdAt, eventRequests.id)
      .limit(limit)
      .offset(offset);
    const [total] = await db.select({ n: count() }).from(eventRequests).where(where);
    return c.json({ requests: rows.map((r) => forStaff(r.event_requests, r.users)), total: total!.n, page, pageSize: limit });
  });

  app.get("/galaxy/event-requests/:id", auth, hostsOnly, async (c) => {
    const id = c.req.param("id");
    const [r] = isUuid(id) ? await db.select().from(eventRequests).innerJoin(users, eq(users.id, eventRequests.userId)).where(eq(eventRequests.id, id)) : [];
    return r ? c.json(forStaff(r.event_requests, r.users)) : nothing(c);
  });

  // Each answer: under a lock on the request, only from the statuses it allows; logged, told to the requester in the same
  // transaction, and to every holder of Hosts after, as other staff actions are. Staff never answer their own request.
  const decide = (action: "approve" | "changes" | "decline", from: readonly Row["status"][]) =>
    app.post(`/galaxy/event-requests/:id/${action}`, auth, hostsOnly, async (c) => {
      const b = await parse(c, DecideRequest);
      if (!b) return invalid(c);
      const id = c.req.param("id");
      if (!isUuid(id)) return nothing(c);
      const actor = c.var.actor.id;
      for (let tries = 0; ; tries++) {
        try {
          const done = await db.transaction(async (tx) => {
            const [r] = await tx.select().from(eventRequests).where(eq(eventRequests.id, id)).for("update");
            if (!r) return "missing" as const;
            if (r.userId === actor) return "self" as const;
            if (!from.includes(r.status)) return "notOpen" as const;
            const set: Partial<typeof eventRequests.$inferInsert> = { decidedBy: actor, decidedAt: at(), updatedAt: at() };
            if (action === "approve") {
              const [u] = await tx.select().from(users).where(eq(users.id, r.userId));
              if (u!.deletedAt || u!.deletionRequestedAt || u!.suspendedAt) return "unavailable" as const;
              const h = await startHost(tx, r.host, u!, at());
              const e = r.event
                ? await newDraft(tx, h, { title: r.event.title, category: r.event.category, startsAt: new Date(r.event.startsAt) }, u!.id, at())
                : null;
              Object.assign(set, { status: "approved", note: null, hostId: h.id, eventId: e?.id ?? null });
            } else Object.assign(set, { status: action === "changes" ? "changes" : "declined", note: b.reason });
            const [out] = await tx.update(eventRequests).set(set).where(eq(eventRequests.id, r.id)).returning();
            await tx.insert(auditLog).values({
              actorId: actor, action: `requests.${action}`, targetUser: r.userId, targetHost: out!.hostId, reason: b.reason, data: { requestId: r.id }, at: at(),
            });
            const decision = action === "approve" ? "approved" : action === "changes" ? "changes" : "declined";
            await notify(
              { to: { userId: r.userId }, kind: "eventRequestAnswered", data: { requestId: r.id, decision, name: r.host.name, reason: decision === "approved" ? null : b.reason } },
              tx,
            );
            return out!;
          });
          if (done === "missing") return nothing(c);
          if (done === "self") return fail(c, 403, "self", "Staff never answer their own request. Ask another staff member with this access.");
          if (done === "notOpen") return fail(c, 409, "notOpen", "That request isn't waiting for this answer any more.");
          if (done === "unavailable") return fail(c, 409, "unavailable", "The account that sent this can't run a host right now.");
          await tell(notify, await holdersOf(db, "hosts", at()), "staffRiskyAction", { action: `requests.${action}`, requestId: id, reason: b.reason, by: actor });
          const [u] = await db.select().from(users).where(eq(users.id, done.userId));
          return c.json(forStaff(done, u!));
        } catch (e) {
          // A random slug ending met another host's or event's: try again with fresh ones.
          if (action === "approve" && taken(e) && tries < 2) continue;
          throw e;
        }
      }
    });
  decide("approve", ["open"]);
  decide("changes", ["open"]);
  decide("decline", ["open", "changes"]);

  return app;
}
