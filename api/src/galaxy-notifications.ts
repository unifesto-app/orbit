import { and, desc, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  type Channel,
  CHANNELS,
  DELIVERY_LOG_MAX,
  type DeliveryLog,
  type GalaxyKinds,
  isMust,
  type KillSwitch,
  KINDS,
  type KindDef,
  type NoticeKind,
  readPhone,
  SwitchBody,
} from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { auditLog, deliveries, notificationSwitches, pushDevices, users } from "./db/schema.ts";
import { fail, invalid, isUuid, parse, signedIn } from "./http.ts";
import { holdersOf, requireFeature, type StaffEnv, tell } from "./roles/access.ts";

// Galaxy's Notifications (build plan PR 7): the catalog with Galaxy's kill switches, and the delivery log by person.
// Changing a switch needs Platform; reading is open to People too, since support looks people up here. Every change and
// every search is written to the audit log; a change emails everyone with Platform, as the Act form promises.

const channelsOf = (d: KindDef): Channel[] => [...(d.email ? ["email" as const] : []), ...(d.push ? ["push" as const] : []), ...(d.inbox ? ["inbox" as const] : [])];
// "riya@example.com" as "r***@example.com".
const maskEmail = (a: string) => `${a[0]}***@${a.split("@")[1]}`;

export function galaxyNotificationsRoutes({ db, secret, notify, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const readers = requireFeature(db, now, "platform", "people");
  const platform = requireFeature(db, now, "platform");

  // GET /galaxy/notifications/kinds: every kind in the catalog with its channels and which of them are switched off.
  app.get("/galaxy/notifications/kinds", auth, readers, async (c) => {
    const rows = await db
      .select({ kind: notificationSwitches.kind, channel: notificationSwitches.channel, at: notificationSwitches.offAt, reason: notificationSwitches.reason, by: users.name })
      .from(notificationSwitches)
      .leftJoin(users, eq(users.id, notificationSwitches.offBy));
    const offOf = (kind: string) =>
      Object.fromEntries(rows.filter((r) => r.kind === kind).map((r) => [r.channel, { by: r.by, at: r.at.toISOString(), reason: r.reason } satisfies KillSwitch]));
    const body: GalaxyKinds = {
      kinds: (Object.entries(KINDS) as [NoticeKind, KindDef][]).map(([kind, d]) => ({ kind, group: d.group, level: d.level, app: d.app, channels: channelsOf(d), off: offOf(kind) })),
      all: offOf("*"),
    };
    return c.json(body);
  });

  // PUT /galaxy/notifications/switches/:kind/:channel: a kill switch off or back on, with a reason. Kind * is the whole
  // channel (every kind, Must too: the tool when a provider is broken); a Must kind has no switch of its own.
  app.put("/galaxy/notifications/switches/:kind/:channel", auth, platform, async (c) => {
    const { kind, channel } = c.req.param();
    const all = kind === "*";
    const def = Object.hasOwn(KINDS, kind) ? KINDS[kind as NoticeKind] : null;
    if (!(CHANNELS as readonly string[]).includes(channel) || (!all && (!def || !channelsOf(def).includes(channel as Channel))))
      return fail(c, 404, "notFound", "There's nothing here.");
    if (!all && isMust(kind as NoticeKind)) return fail(c, 409, "alwaysOn", "This message always goes. Switch the whole channel off if its provider is broken.");
    const b = await parse(c, SwitchBody);
    if (!b) return invalid(c);
    const actorId = c.var.actor.id;
    const at = new Date(now());
    const ch = channel as Channel;
    await db.transaction(async (tx) => {
      if (b.off) {
        const row = { offBy: actorId, offAt: at, reason: b.reason };
        await tx.insert(notificationSwitches).values({ kind, channel: ch, ...row }).onConflictDoUpdate({ target: [notificationSwitches.kind, notificationSwitches.channel], set: row });
      } else await tx.delete(notificationSwitches).where(and(eq(notificationSwitches.kind, kind), eq(notificationSwitches.channel, ch)));
      await tx.insert(auditLog).values({ actorId, action: "notifications.switch", reason: b.reason, data: { kind, channel: ch, off: b.off }, at });
    });
    const action = `notifications ${all ? "all" : kind} ${ch} ${b.off ? "off" : "on"}`;
    await tell(notify, await holdersOf(db, "platform", at), "staffRiskyAction", { action, reason: b.reason, by: actorId });
    return c.json({ kind, channel: ch, off: b.off });
  });

  // GET /galaxy/notifications/deliveries?q=: one person's last 100 sends, by phone, email or account id, newest first.
  // Also sends to that phone or email with no account. Emails are masked, a device is its platform and app; a token
  // never leaves the API. Logged by account id and kind of search, never what was typed.
  app.get("/galaxy/notifications/deliveries", auth, readers, async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const phone = readPhone(q);
    const contact = typeof phone === "string" && phone !== "abroad" ? phone : q.includes("@") ? q.toLowerCase() : null;
    if (!contact && !isUuid(q)) return fail(c, 400, "invalid", "Search by their phone number, email or account id.");
    const [person] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(contact ? or(eq(users.phone, contact), eq(users.email, contact)) : eq(users.id, q))
      .limit(1);
    const rows =
      person || contact
        ? await db
            .select({ d: deliveries, platform: pushDevices.platform, app: pushDevices.app })
            .from(deliveries)
            .leftJoin(pushDevices, sql`${deliveries.channel} = 'push' and ${pushDevices.sessionId}::text = ${deliveries.target}`)
            .where(or(person ? eq(deliveries.userId, person.id) : undefined, contact ? eq(deliveries.contact, contact) : undefined))
            .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
            .limit(DELIVERY_LOG_MAX)
        : [];
    await db.insert(auditLog).values({
      actorId: c.var.actor.id,
      action: "notifications.search",
      targetUser: person?.id ?? null,
      data: { by: contact ? (contact.includes("@") ? "email" : "phone") : "id", results: rows.length },
      at: new Date(now()),
    });
    const to = (r: (typeof rows)[number]) =>
      r.d.channel === "email" ? (r.d.target.includes("@") ? maskEmail(r.d.target) : null) : r.d.channel === "push" && r.d.target ? (r.platform ? `${r.platform} · ${r.app}` : "a removed device") : null;
    const body: DeliveryLog = {
      person: person ?? null,
      deliveries: rows.map((r) => ({
        id: r.d.id,
        kind: r.d.kind,
        channel: r.d.channel as Channel,
        status: r.d.status,
        reason: r.d.reason,
        to: to(r),
        tries: r.d.tries,
        createdAt: r.d.createdAt.toISOString(),
        sentAt: r.d.sentAt?.toISOString() ?? null,
      })),
    };
    return c.json(body);
  });

  return app;
}
