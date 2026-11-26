import { and, desc, eq, or, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  type Channel,
  CHANNELS,
  DELIVERY_LOG_MAX,
  type DeliveryLog,
  type GalaxyKinds,
  type GalaxyWording,
  inboxApp,
  isMust,
  type KillSwitch,
  KINDS,
  type KindDef,
  type NoticeKind,
  PUSH_BODY_MAX,
  readPhone,
  SwitchBody,
  unknownVars,
  type Wording,
  WordingBody,
  WordingDraft,
} from "@orbit/contract";
import type { z } from "zod";
import type { Deps } from "./auth/routes.ts";
import { auditLog, deliveries, inboxItems, notificationSwitches, notificationTemplates, pushDevices, users } from "./db/schema.ts";
import { fail, invalid, isUuid, parse, signedIn } from "./http.ts";
import { branches, clearWording, fill, inboxFor, pushFor, samplesOf, SUBJECT_OFF, varsOf, words } from "./notification-emails.ts";
import { killedFor, liveDevices } from "./notifications.ts";
import { holdersOf, requireFeature, type StaffEnv, tell } from "./roles/access.ts";
import { holds } from "./roles/rules.ts";

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
    // Already as asked: nothing changes, nothing is logged or emailed, and the first switch-off's who and why stay.
    const changed = await db.transaction(async (tx) => {
      const [hit] = b.off
        ? await tx.insert(notificationSwitches).values({ kind, channel: ch, offBy: actorId, offAt: at, reason: b.reason }).onConflictDoNothing().returning()
        : await tx.delete(notificationSwitches).where(and(eq(notificationSwitches.kind, kind), eq(notificationSwitches.channel, ch))).returning();
      if (hit) await tx.insert(auditLog).values({ actorId, action: "notifications.switch", reason: b.reason, data: { kind, channel: ch, off: b.off }, at });
      return !!hit;
    });
    if (!changed) return c.json({ kind, channel: ch, off: b.off });
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
    // By account (indexed) and by the contact typed, apart, so each can use its own plan; merged newest first.
    // ponytail: the contact query scans deliveries (no index on contact); add one if the log grows large.
    const by = (where: SQL) =>
      db
        .select({ d: deliveries, platform: pushDevices.platform, app: pushDevices.app })
        .from(deliveries)
        .leftJoin(pushDevices, sql`${deliveries.channel} = 'push' and ${pushDevices.sessionId}::text = ${deliveries.target}`)
        .where(where)
        .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
        .limit(DELIVERY_LOG_MAX);
    const found = [...(person ? await by(eq(deliveries.userId, person.id)) : []), ...(contact ? await by(eq(deliveries.contact, contact)) : [])];
    const rows = [...new Map(found.map((r) => [r.d.id, r])).values()]
      .sort((x, y) => y.d.createdAt.getTime() - x.d.createdAt.getTime() || (y.d.id > x.d.id ? 1 : -1))
      .slice(0, DELIVERY_LOG_MAX);
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
      // The name is People's to see; Platform alone gets the id, to match rows up.
      person: person ? { id: person.id, name: holds(c.var.actor, "people") ? person.name : null } : null,
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

  // ---------- Wording (PR 8): Platform only; every write in the audit log ----------

  // The kind and channel in the path, when the kind uses that channel; else null (404).
  const target = (kind: string, channel?: string) => {
    const def = Object.hasOwn(KINDS, kind) ? KINDS[kind as NoticeKind] : null;
    if (!def || (channel !== undefined && !channelsOf(def).includes(channel as Channel))) return null;
    return { kind: kind as NoticeKind, def, channel: channel as Channel };
  };
  // A draft as the channel has it (email: subject + body, push: title + body, inbox: body), or why not.
  const draftOf = (kind: NoticeKind, channel: Channel, b: z.infer<typeof WordingDraft>): Wording | { error: string; message: string } => {
    const no = (message: string, error = "invalid") => ({ error, message });
    if (branches(kind, channel)) return no("This wording changes with the situation, so it's edited in code.", "branches");
    if (channel === "email" && !b.subject) return no("An email needs a subject.");
    if (channel === "push" && !b.title) return no("A push needs a title.");
    if (channel === "push" && b.body.length > PUSH_BODY_MAX) return no(`A push's words are ${PUSH_BODY_MAX} characters at most.`);
    const w = { subject: channel === "email" ? b.subject! : null, title: channel === "push" ? b.title! : null, body: b.body };
    const names = Object.keys(varsOf(kind));
    const off = SUBJECT_OFF[kind] ?? [];
    const bad = [
      ...unknownVars(w.subject ?? "", names.filter((n) => !off.includes(n))),
      ...unknownVars([w.title, w.body].join("\n"), names),
    ];
    if (bad.length) return no(`Not a variable for this message${off.length ? " (or not in its subject)" : ""}: ${[...new Set(bad)].map((n) => `{${n}}`).join(", ")}.`);
    return w;
  };

  // GET /galaxy/notifications/templates/:kind: per channel the kind uses, Galaxy's wording or null, the code's rendered
  // with the samples, and the variables with their samples as shown.
  app.get("/galaxy/notifications/templates/:kind", auth, platform, async (c) => {
    const t = target(c.req.param("kind"));
    if (!t) return fail(c, 404, "notFound", "There's nothing here.");
    const rows = await db
      .select({ row: notificationTemplates, by: users.name })
      .from(notificationTemplates)
      .leftJoin(users, eq(users.id, notificationTemplates.updatedBy))
      .where(eq(notificationTemplates.kind, t.kind));
    const data = samplesOf(t.kind);
    const email = words(t.kind, data);
    const push = pushFor(t.kind, data);
    const code: Record<Channel, Wording> = {
      email: { subject: email.subject, body: email.line ?? "" },
      push: { title: push.title, body: push.body },
      inbox: { body: inboxFor(t.kind, data).text },
    };
    const body: GalaxyWording = {
      kind: t.kind,
      vars: Object.fromEntries(Object.entries(varsOf(t.kind)).map(([n, v]) => [n, fill(`{${n}}`, { [n]: v }, data)])),
      subjectOff: [...(SUBJECT_OFF[t.kind] ?? [])],
      channels: channelsOf(t.def).map((channel) => {
        const r = rows.find((x) => x.row.channel === channel);
        const saved = r && { subject: r.row.subject, title: r.row.title, body: r.row.body, updatedAt: r.row.updatedAt.toISOString(), by: r.by };
        return { channel, editable: !branches(t.kind, channel), saved: saved ?? null, code: code[channel] };
      }),
    };
    return c.json(body);
  });

  // PUT /galaxy/notifications/templates/:kind/:channel: Galaxy's wording for one channel. A save over someone else's
  // since `readAt` is refused with 409, as App content.
  app.put("/galaxy/notifications/templates/:kind/:channel", auth, platform, async (c) => {
    const t = target(c.req.param("kind"), c.req.param("channel"));
    if (!t) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, WordingBody);
    if (!b) return invalid(c);
    const w = draftOf(t.kind, t.channel, b);
    if ("error" in w) return fail(c, 400, w.error, w.message);
    const actorId = c.var.actor.id;
    const at = new Date(now());
    const done = await db.transaction(async (tx) => {
      const values = { subject: w.subject, title: w.title, body: w.body, updatedBy: actorId, updatedAt: at };
      const [row] =
        b.readAt === null
          ? await tx.insert(notificationTemplates).values({ kind: t.kind, channel: t.channel, ...values }).onConflictDoNothing().returning()
          : await tx
              .update(notificationTemplates)
              .set(values)
              .where(and(eq(notificationTemplates.kind, t.kind), eq(notificationTemplates.channel, t.channel), eq(notificationTemplates.updatedAt, new Date(b.readAt))))
              .returning();
      if (row) await tx.insert(auditLog).values({ actorId, action: "notifications.wording", data: { kind: t.kind, channel: t.channel, ...w }, at });
      return !!row;
    });
    if (!done) return fail(c, 409, "changed", "Someone saved this wording since you opened the page. Open it again to see their change.");
    clearWording();
    return c.json({ updatedAt: at.toISOString() });
  });

  // DELETE /galaxy/notifications/templates/:kind/:channel: back to the wording in code.
  app.delete("/galaxy/notifications/templates/:kind/:channel", auth, platform, async (c) => {
    const t = target(c.req.param("kind"), c.req.param("channel"));
    if (!t) return fail(c, 404, "notFound", "There's nothing here.");
    const actorId = c.var.actor.id;
    await db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(notificationTemplates)
        .where(and(eq(notificationTemplates.kind, t.kind), eq(notificationTemplates.channel, t.channel)))
        .returning();
      if (gone) await tx.insert(auditLog).values({ actorId, action: "notifications.wordingReset", data: { kind: t.kind, channel: t.channel }, at: new Date(now()) });
    });
    clearWording();
    return c.body(null, 204);
  });

  // POST /galaxy/notifications/templates/:kind/:channel/test: the draft, filled with the samples, to the caller alone:
  // email to their proved email, push to their live devices on the kind's app, an inbox item there. Through the queue
  // (dedupe key test:…, which carries the draft to the worker), past switches and caps: it's to themselves.
  app.post("/galaxy/notifications/templates/:kind/:channel/test", auth, platform, async (c) => {
    const t = target(c.req.param("kind"), c.req.param("channel"));
    if (!t) return fail(c, 404, "notFound", "There's nothing here.");
    const b = await parse(c, WordingDraft);
    if (!b) return invalid(c);
    const w = draftOf(t.kind, t.channel, b);
    if ("error" in w) return fail(c, 400, w.error, w.message);
    // The worker would skip it: say so rather than "sent".
    if ((await killedFor(db, t.kind)).has(t.channel)) return fail(c, 409, "killSwitch", "This channel is switched off for this message. Switch it on to test.");
    const me = c.var.user;
    const at = new Date(now());
    const payload = { ...samplesOf(t.kind), _draft: w };
    const dedupeKey = `test:${t.kind}:${crypto.randomUUID()}`;
    const row = { userId: me.id, contact: null, kind: t.kind, dedupeKey, payload, runAt: at, createdAt: at, status: "queued" as const };
    const app = inboxApp(t.kind, payload) ?? "orbit";
    let sent = 0;
    if (t.channel === "email") {
      if (!me.email || !me.emailVerifiedAt) return fail(c, 409, "noEmail", "Your account has no proved email to send it to.");
      sent = (await db.insert(deliveries).values({ ...row, channel: "email", target: me.email }).returning()).length;
    } else if (t.channel === "push") {
      const devices = await liveDevices(db, me.id, app, at);
      if (!devices.length) return fail(c, 409, "noDevice", "You have no phone signed in to that app to send it to.");
      sent = (await db.insert(deliveries).values(devices.map((d) => ({ ...row, channel: "push" as const, target: d.sessionId }))).returning()).length;
    } else {
      const i = inboxFor(t.kind, payload, w);
      await db.insert(inboxItems).values({ userId: me.id, app, kind: t.kind, type: t.def.type, fromName: i.fromName, text: i.text, opens: i.opens, dedupeKey, createdAt: at });
      sent = 1;
    }
    await db.insert(auditLog).values({ actorId: me.id, action: "notifications.wordingTest", data: { kind: t.kind, channel: t.channel }, at });
    return c.json({ sent });
  });

  return app;
}
