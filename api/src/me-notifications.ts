import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { APPS, FollowNotify, INBOX_PAGE, type InboxApp, type InboxPage, type InboxPicture, InboxRead, type NoticeKind, NotificationSettingsBody, PushDevice, type InboxType } from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { events, follows, hosts, inboxItems, notificationPrefs, pushDevices } from "./db/schema.ts";
import { openable } from "./events/public.ts";
import { fail, invalid, isUuid, parse, signedIn, type Env } from "./http.ts";
import { settingsFor, switchDiffs } from "./notifications.ts";

// The person's side of notifications (build plan PR 2): this phone's push token, the inbox, the settings and each
// followed host's on/off. Only ever the signed-in person's own rows.

type Deps = { db: Db; secret: string; now?: () => number };

// The inbox cursor: the last item's time (to the microsecond, as stored) and id.
const cursorOf = (at: string, id: string) => Buffer.from(`${at}|${id}`).toString("base64url");
const readCursor = (s: string) => {
  const [at, id] = Buffer.from(s, "base64url").toString().split("|");
  // The exact shape cursorOf writes; Postgres still rejects an impossible date like Feb 30, so that's checked too.
  if (!at || !id || !isUuid(id) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(at)) return null;
  const t = Date.parse(at); // rolls Feb 30 over to Mar 2, so the round trip catches it
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === at.slice(0, 10) ? { at, id } : null;
};

// The settings write, for PUT /me/notification-settings and the unsubscribe link (email-hygiene.ts).
export const saveSettings = (db: Db, u: { id: string; city: string | null }, b: NotificationSettingsBody, at: Date) =>
  db.transaction(async (tx) => {
    // A defaults row first, so two first PUTs lock the same row instead of both seeing none (its defaults are the
    // same as no row).
    await tx.insert(notificationPrefs).values({ userId: u.id }).onConflictDoNothing();
    const [row] = await tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.id)).for("update");
    const s = settingsFor(row, u.city);
    const next = { push: b.push ?? s.push, quiet: b.quiet ?? s.quiet, switches: { ...s.switches, ...b.switches } };
    const set = { push: next.push, quiet: next.quiet, switches: switchDiffs(next.switches, u.city), updatedAt: at };
    await tx.insert(notificationPrefs).values({ userId: u.id, ...set }).onConflictDoUpdate({ target: notificationPrefs.userId, set });
    return next;
  });

// Each row's picture, from what it opens (rows don't store one): an event that still opens (as GET /public/events/:slug)
// shows its poster, or its host without one; a host or venue (a venue's id is its host's) shows while public and live.
// Anything else, or gone, is null: the orb.
async function picturesOf(db: Db, opens: unknown[]): Promise<InboxPicture[]> {
  const ids = (key: "event" | "host" | "venue") =>
    opens.flatMap((o) => {
      const id = (o as Record<string, unknown> | null)?.[key];
      return typeof id === "string" && isUuid(id) ? [id] : [];
    });
  const eventIds = ids("event");
  const hostIds = [...ids("host"), ...ids("venue")];
  const evs = eventIds.length
    ? await db
        .select({ id: events.id, title: events.title, poster: events.poster, hid: hosts.id, hname: hosts.name, hlogo: hosts.logo, hvis: hosts.visibility })
        .from(events)
        .innerJoin(hosts, eq(hosts.id, events.hostId))
        .where(and(inArray(events.id, eventIds), openable))
    : [];
  const hs = hostIds.length
    ? await db.select({ id: hosts.id, name: hosts.name, logo: hosts.logo }).from(hosts).where(and(inArray(hosts.id, hostIds), eq(hosts.visibility, "public"), eq(hosts.status, "live")))
    : [];
  return opens.map((o) => {
    const r = (o ?? {}) as Record<string, unknown>;
    const e = evs.find((x) => x.id === r.event);
    if (e) return e.poster ? { event: { id: e.id, title: e.title, poster: e.poster } } : e.hvis === "public" ? { host: { id: e.hid, name: e.hname, logo: e.hlogo } } : null;
    const h = hs.find((x) => x.id === (r.host ?? r.venue));
    return h ? { host: h } : null;
  });
}

export function meNotificationsRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());
  const appOf = (s: string | undefined) => (APPS as readonly string[]).includes(s ?? "orbit") ? ((s ?? "orbit") as InboxApp) : null;

  // PUT /me/push-device: this sign-in's token. A token on any other row (another session, another account) moves here.
  app.put("/me/push-device", auth, async (c) => {
    const b = await parse(c, PushDevice);
    if (!b) return invalid(c);
    const sid = c.var.sid;
    await db.transaction(async (tx) => {
      // One writer per token: two sessions sending the same token at once would otherwise trip its unique index.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${b.token}))`);
      await tx.delete(pushDevices).where(and(eq(pushDevices.token, b.token), ne(pushDevices.sessionId, sid)));
      const row = { userId: c.var.user.id, ...b, seenAt: at() };
      await tx.insert(pushDevices).values({ sessionId: sid, ...row }).onConflictDoUpdate({ target: pushDevices.sessionId, set: row });
    });
    return c.body(null, 204);
  });

  app.delete("/me/push-device", auth, async (c) => {
    await db.delete(pushDevices).where(eq(pushDevices.sessionId, c.var.sid));
    return c.body(null, 204);
  });

  // GET /me/inbox?app=orbit&before=<cursor>: 30 a page, newest first, with that app's unread count.
  app.get("/me/inbox", auth, async (c) => {
    const box = appOf(c.req.query("app"));
    const before = c.req.query("before");
    const cur = before ? readCursor(before) : null;
    if (!box || (before && !cur)) return invalid(c);
    const mine = and(eq(inboxItems.userId, c.var.user.id), eq(inboxItems.app, box));
    const rows = await db
      .select({ item: inboxItems, stamp: sql<string>`to_char(${inboxItems.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` })
      .from(inboxItems)
      .where(cur ? and(mine, sql`(${inboxItems.createdAt}, ${inboxItems.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`) : mine)
      .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id))
      .limit(INBOX_PAGE + 1);
    const page = rows.slice(0, INBOX_PAGE);
    const [unread] = await db.select({ n: count() }).from(inboxItems).where(and(mine, isNull(inboxItems.readAt)));
    const last = page.at(-1);
    const pictures = await picturesOf(db, page.map((r) => r.item.opens));
    const body: InboxPage = {
      items: page.map(({ item: i }, n) => ({
        id: i.id,
        at: i.createdAt.toISOString(),
        from: i.fromName,
        kind: i.kind as NoticeKind,
        type: i.type as InboxType,
        text: i.text,
        picture: pictures[n]!,
        opens: i.opens,
        read: !!i.readAt,
      })),
      unread: unread!.n,
      next: rows.length > INBOX_PAGE && last ? cursorOf(last.stamp, last.item.id) : null,
    };
    return c.json(body);
  });

  // POST /me/inbox/read {app, ids?}: those of the caller's items, or with no ids the whole app's inbox.
  app.post("/me/inbox/read", auth, async (c) => {
    const b = await parse(c, InboxRead);
    if (!b) return invalid(c);
    const mine = and(eq(inboxItems.userId, c.var.user.id), eq(inboxItems.app, b.app), isNull(inboxItems.readAt));
    if (b.ids?.length !== 0) await db.update(inboxItems).set({ readAt: at() }).where(b.ids ? and(mine, inArray(inboxItems.id, b.ids)) : mine);
    return c.body(null, 204);
  });

  app.get("/me/notification-settings", auth, async (c) => {
    const u = c.var.user;
    const [row] = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.id));
    return c.json(settingsFor(row, u.city));
  });

  // PUT /me/notification-settings {push?, quiet?, switches?}: keys from the contract's lists only; stores what differs
  // from the defaults.
  app.put("/me/notification-settings", auth, async (c) => {
    const b = await parse(c, NotificationSettingsBody);
    if (!b) return invalid(c);
    return c.json(await saveSettings(db, c.var.user, b, at()));
  });

  // PUT /me/follows/:hostId/notify {notify}: a followed host's new events, told or not.
  app.put("/me/follows/:hostId/notify", auth, async (c) => {
    const hostId = c.req.param("hostId");
    const b = await parse(c, FollowNotify);
    if (!b) return invalid(c);
    const done = isUuid(hostId)
      ? await db.update(follows).set({ notify: b.notify }).where(and(eq(follows.userId, c.var.user.id), eq(follows.hostId, hostId))).returning({ h: follows.hostId })
      : [];
    return done.length ? c.body(null, 204) : fail(c, 404, "notFound", "You don't follow this host.");
  });

  return app;
}
