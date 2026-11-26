import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  NewSupportMessage,
  SUPPORT_PER_DAY,
  SupportApp,
  SupportReply,
  SupportStatus,
  SupportStatusBody,
  type StaffSupportRow,
  type StaffSupportThread,
  type SupportMessage,
  type SupportThread,
} from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import type { Db } from "./db/index.ts";
import { auditLog, supportMessages, supportThreads, users } from "./db/schema.ts";
import { fail, invalid, isUuid, parse, signedIn, taken, type Tx } from "./http.ts";
import { masked, requireFeature, type StaffEnv } from "./roles/access.ts";

// Help and support (orbit-pm X16, contract/src/support.ts): Write to us on Help in the Orbit app, Event Partner and Play
// Partner. A person keeps one thread per app until staff close it (the partial unique index support_threads_one_live);
// holders of Queues read, answer, close and reopen threads in Galaxy, and each reply reaches the person as a
// supportReply notice in the app they wrote from.

const DAY = 24 * 3600_000;
const LIST_MAX = 200;
const PREVIEW = 140;
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
const newerThread = (c: Context) => fail(c, 409, "newerThread", "This person has a newer thread from that app. Answer them there.");
// A closed thread opening again while a newer live one appeared at the same moment: support_threads_one_live refuses it.
const orNewer = async <T>(run: () => Promise<T>): Promise<T | "newer"> => {
  try {
    return await run();
  } catch (e) {
    if (taken(e)) return "newer";
    throw e;
  }
};
type Thread = typeof supportThreads.$inferSelect;

// The thread's messages, oldest first; staff by first name, or "Orbit" when they have none.
const messagesOf = async (q: Db | Tx, threadId: string): Promise<SupportMessage[]> =>
  (
    await q
      .select({ m: supportMessages, staffName: users.name })
      .from(supportMessages)
      .leftJoin(users, eq(users.id, supportMessages.staffId))
      .where(eq(supportMessages.threadId, threadId))
      .orderBy(asc(supportMessages.createdAt), asc(supportMessages.id))
  ).map(({ m, staffName }) => ({
    id: m.id,
    from: m.from,
    name: m.from === "staff" ? staffName?.trim().split(/\s+/)[0] || "Orbit" : null,
    body: m.body,
    at: m.createdAt.toISOString(),
  }));

// The person's thread for this app that isn't closed, if any.
const liveThread = (q: Db | Tx, userId: string, app: SupportApp) =>
  q
    .select({ id: supportThreads.id })
    .from(supportThreads)
    .where(and(eq(supportThreads.userId, userId), eq(supportThreads.app, app), ne(supportThreads.status, "closed")));

const lastBody = sql<string | null>`(select left(m.body, ${PREVIEW}) from support_messages m where m.thread_id = ${supportThreads.id} order by m.created_at desc, m.id desc limit 1)`;
const toRow = (t: Thread, u: typeof users.$inferSelect, preview: string | null): StaffSupportRow => {
  const m = masked(u);
  return { id: t.id, app: t.app, status: t.status, updatedAt: t.updatedAt.toISOString(), preview: preview ?? "", person: { id: m.id, name: m.name, phone: m.phone, email: m.email } };
};

export function supportRoutes({ db, store, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const queues = requireFeature(db, now, "queues");
  const at = () => new Date(now());

  // POST /me/support {app, body}: {threadId}. Into the person's thread for that app that isn't closed (open again),
  // else a new one.
  app.post("/me/support", auth, async (c) => {
    const b = await parse(c, NewSupportMessage);
    if (!b) return invalid(c);
    const userId = c.var.user.id;
    if ((await store.incr(`support:${userId}`, DAY)) > SUPPORT_PER_DAY) return fail(c, 429, "tooMany", "You've sent a lot today. Try again tomorrow.");
    // Two sends at once: the index lets one insert win, and the other finds its thread. The live thread that blocked the
    // insert may be closed before it's read: then it's tried once more.
    for (let tries = 0; tries < 2; tries++) {
      const threadId = await db.transaction(async (tx) => {
        const when = at();
        await tx.insert(supportThreads).values({ userId, app: b.app, createdAt: when, updatedAt: when }).onConflictDoNothing();
        const [t] = await liveThread(tx, userId, b.app).for("update");
        if (!t) return null;
        await tx.update(supportThreads).set({ status: "open", updatedAt: when }).where(eq(supportThreads.id, t.id));
        await tx.insert(supportMessages).values({ threadId: t.id, from: "person", body: b.body, createdAt: when });
        return t.id;
      });
      if (threadId) return c.json({ threadId }, 201);
    }
    return fail(c, 409, "busy", "That didn't go through. Try again.");
  });

  // GET /me/support?app=: {thread}, the latest for that app with its messages, or null.
  app.get("/me/support", auth, async (c) => {
    const a = SupportApp.safeParse(c.req.query("app"));
    if (!a.success) return invalid(c);
    const [t] = await db
      .select()
      .from(supportThreads)
      .where(and(eq(supportThreads.userId, c.var.user.id), eq(supportThreads.app, a.data)))
      .orderBy(desc(supportThreads.createdAt), desc(supportThreads.id))
      .limit(1);
    const thread: SupportThread | null = t
      ? { id: t.id, app: t.app, status: t.status, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(), messages: await messagesOf(db, t.id) }
      : null;
    return c.json({ thread });
  });

  // ---------- Galaxy: Queues ----------
  const joined = () => db.select({ t: supportThreads, u: users, preview: lastBody }).from(supportThreads).innerJoin(users, eq(users.id, supportThreads.userId));
  const detail = async (id: string): Promise<StaffSupportThread | null> => {
    const [x] = await joined().where(eq(supportThreads.id, id));
    return x ? { ...toRow(x.t, x.u, x.preview), createdAt: x.t.createdAt.toISOString(), messages: await messagesOf(db, id) } : null;
  };

  // GET /galaxy/support?status=: the newest message first, 200 at most. Default: open.
  // ponytail: one page of 200; page it (listPage) when the inbox grows past that.
  app.get("/galaxy/support", auth, queues, async (c) => {
    const status = SupportStatus.safeParse(c.req.query("status") ?? "open");
    if (!status.success) return invalid(c);
    const rows = await joined().where(eq(supportThreads.status, status.data)).orderBy(desc(supportThreads.updatedAt), desc(supportThreads.id)).limit(LIST_MAX);
    return c.json({ threads: rows.map((x) => toRow(x.t, x.u, x.preview)) });
  });

  app.get("/galaxy/support/:id", auth, queues, async (c) => {
    const id = c.req.param("id");
    const t = isUuid(id) ? await detail(id) : null;
    return t ? c.json(t) : nothing(c);
  });

  // A reply: the thread answered (a closed one opens again as answered), logged, and the person told in the app they
  // wrote from. Refused (409 newerThread, nothing sent) on a closed thread while the person has a newer live one.
  app.post("/galaxy/support/:id/reply", auth, queues, async (c) => {
    const b = await parse(c, SupportReply);
    if (!b) return invalid(c);
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const actor = c.var.actor.id;
    const done = await orNewer(() =>
      db.transaction(async (tx) => {
        const [t] = await tx.select().from(supportThreads).where(eq(supportThreads.id, id)).for("update");
        if (!t) return "missing" as const;
        if (t.status === "closed" && (await liveThread(tx, t.userId, t.app)).length) return "newer" as const;
        const when = at();
        await tx.insert(supportMessages).values({ threadId: id, from: "staff", staffId: actor, body: b.body, createdAt: when });
        await tx.update(supportThreads).set({ status: "answered", updatedAt: when }).where(eq(supportThreads.id, id));
        await tx.insert(auditLog).values({ actorId: actor, action: "support.reply", targetUser: t.userId, data: { threadId: id, app: t.app }, at: when });
        await notify({ to: { userId: t.userId }, kind: "supportReply", data: { threadId: id, app: t.app }, key: `support:${id}:${when.getTime()}` }, tx);
        return "ok" as const;
      }),
    );
    if (done === "missing") return nothing(c);
    if (done === "newer") return newerThread(c);
    return c.json(await detail(id));
  });

  // Close, or open again: answered when staff wrote last, else open. Reopening is refused (409 newerThread) while the
  // person has a newer live thread for that app.
  app.post("/galaxy/support/:id/status", auth, queues, async (c) => {
    const b = await parse(c, SupportStatusBody);
    if (!b) return invalid(c);
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const actor = c.var.actor.id;
    const done = await orNewer(() =>
      db.transaction(async (tx) => {
        const [t] = await tx.select().from(supportThreads).where(eq(supportThreads.id, id)).for("update");
        if (!t) return "missing" as const;
        if (b.status === "closed" ? t.status === "closed" : t.status !== "closed") return "ok" as const; // already so
        let status: Thread["status"] = "closed";
        if (b.status === "open") {
          if ((await liveThread(tx, t.userId, t.app)).length) return "newer" as const;
          const [last] = await tx
            .select({ from: supportMessages.from })
            .from(supportMessages)
            .where(eq(supportMessages.threadId, id))
            .orderBy(desc(supportMessages.createdAt), desc(supportMessages.id))
            .limit(1);
          status = last?.from === "staff" ? "answered" : "open";
        }
        await tx.update(supportThreads).set({ status }).where(eq(supportThreads.id, id));
        await tx.insert(auditLog).values({ actorId: actor, action: b.status === "open" ? "support.reopen" : "support.close", targetUser: t.userId, data: { threadId: id, app: t.app }, at: at() });
        return "ok" as const;
      }),
    );
    if (done === "missing") return nothing(c);
    if (done === "newer") return newerThread(c);
    return c.json(await detail(id));
  });

  return app;
}
