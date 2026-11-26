import { and, countDistinct, eq, gt, gte, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { inboxApp, type InboxApp, isMust, KINDS, type NoticeKind, type NotificationSettings, SWITCH_KEYS, type SwitchKey } from "@orbit/contract";
import { type Mail, NotSent } from "./auth/senders.ts";
import type { Db } from "./db/index.ts";
import { deliveries, events, inboxItems, notificationPrefs, pushDevices, sessions, users } from "./db/schema.ts";
import { isUuid, type Notice, type Notify, type Tx } from "./http.ts";
import { emailFor, inboxFor } from "./notification-emails.ts";

// Notifications (build plan PR 1 and 2; contract/src/notifications.ts). notify() writes the inbox item and one deliveries
// row per channel (per device for push), inside the caller's transaction when given one; the worker sends queued email
// rows and releases held pushes. The queue is the deliveries table: no Redis, no queue service. WhatsApp is never a
// channel. Email "fallback" kinds write nothing until the push sender lands.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const IST = 330 * MIN; // India time, fixed UTC+5:30
const PUSH_CAP = 5; // Low pushes a day per person
const LOW_KINDS = (Object.keys(KINDS) as NoticeKind[]).filter((k) => KINDS[k].level === "low");
// Kinds about something still to come: dropped at release once their event was cancelled or has started.
const AHEAD: readonly string[] = ["reminder", "follow", "near"];

// The start of t's India calendar day.
const istDay = (t: number) => Math.floor((t + IST) / DAY) * DAY - IST;
// Quiet hours, 22:00 to 07:00 India time: the next 07:00 when t is inside them, else null.
export const quietUntil = (t: number) => {
  const h = (t - istDay(t)) / HOUR;
  return h >= 7 && h < 22 ? null : new Date(istDay(t) + 7 * HOUR + (h >= 22 ? DAY : 0));
};

// A switch's default: on, but new events near you only with a city set.
const switchDefault = (key: SwitchKey, city: string | null) => (key === "push.near" ? !!city : true);
// The person's settings with every key filled in from the defaults.
export const settingsFor = (row: typeof notificationPrefs.$inferSelect | undefined, city: string | null): NotificationSettings => ({
  push: row?.push ?? true,
  quiet: row?.quiet ?? true,
  switches: Object.fromEntries(SWITCH_KEYS.map((k) => [k, row?.switches[k] ?? switchDefault(k, city)])) as Record<SwitchKey, boolean>,
});
// Only the switches that differ from their defaults, as stored.
export const switchDiffs = (switches: Record<SwitchKey, boolean>, city: string | null) =>
  Object.fromEntries(Object.entries(switches).filter(([k, v]) => v !== switchDefault(k as SwitchKey, city)));
const settingsOf = async (q: Tx | Db, userId: string, city: string | null) =>
  settingsFor((await q.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)))[0], city);
// Off for this kind on this channel: the master push switch, or the kind's own. Must kinds have no switch.
const switchedOff = (s: NotificationSettings, kind: NoticeKind, channel: "push" | "email") => {
  const sw = KINDS[kind].switch;
  if (!sw) return false;
  if (channel === "push" && !s.push) return true;
  return s.switches[`${channel}.${sw}` as SwitchKey] === false; // no email switch (tickets, near, inRoom): never off
};

// A person's devices on one app whose sign-in is still live.
// A device is live while its session is (not ended, not expired). One device when sessionId is given.
const liveDevices = (q: Tx | Db, userId: string, app: InboxApp, at: Date, sessionId?: string) =>
  q
    .select({ sessionId: pushDevices.sessionId })
    .from(pushDevices)
    .innerJoin(sessions, eq(sessions.id, pushDevices.sessionId))
    .where(
      and(
        eq(pushDevices.userId, userId),
        eq(pushDevices.app, app),
        isNull(sessions.endedAt),
        gt(sessions.expiresAt, at),
        sessionId ? eq(pushDevices.sessionId, sessionId) : undefined,
      ),
    );

// Pushes counted against a day's caps: those delivering (run_at) that India day, so a push held overnight counts toward
// the morning it goes. Any that wasn't skipped or dropped counts, and the ones skipped only because sending isn't built
// yet. Counted from deliveries, never stored; one notice on two devices counts once. Without a host: Low kinds (the 5 a
// day); with one: that host's followedHostEvent.
// ponytail: two notices at the same instant can both pass a cap; a per-person lock if that ever matters.
const pushesOn = async (q: Tx | Db, userId: string, day: Date, hostId?: string) => {
  const from = istDay(day.getTime());
  const [r] = await q
    .select({ n: countDistinct(deliveries.dedupeKey) })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.userId, userId),
        eq(deliveries.channel, "push"),
        gte(deliveries.runAt, new Date(from)),
        lt(deliveries.runAt, new Date(from + DAY)),
        or(notInArray(deliveries.status, ["skipped", "dropped"]), and(eq(deliveries.status, "skipped"), eq(deliveries.reason, "notSetUp"))),
        hostId ? and(eq(deliveries.kind, "followedHostEvent"), sql`${deliveries.payload}->>'hostId' = ${hostId}`) : inArray(deliveries.kind, LOW_KINDS),
      ),
    );
  return r!.n;
};

// Strings Postgres's jsonb refuses (a lone surrogate, a NUL) are mended once, so a notice never fails its caller's write.
const clean = (data: Record<string, unknown> | undefined): Record<string, unknown> =>
  JSON.parse(JSON.stringify(data ?? {}, (_, v) => (typeof v === "string" ? v.toWellFormed().replaceAll("\u0000", "") : v)));

export function createNotifier({ db, now }: { db: Db; now: () => number }): Notify {
  const write = async (n: Notice, q: Tx) => {
    const def = KINDS[n.kind];
    const at = new Date(now());

    // Who it's for. A {contact} notice goes to that contact itself, never the matched account's other email (D7); its
    // inbox item goes to the account it names, else the one holding the contact.
    let person: typeof users.$inferSelect | undefined;
    let address: string | null = null;
    if ("contact" in n.to) {
      const c = n.to.contact;
      [person] = await q
        .select()
        .from(users)
        .where(and(isNull(users.deletedAt), n.to.userId ? eq(users.id, n.to.userId) : or(eq(users.phone, c), eq(users.email, c))));
      address = c.includes("@") ? c : null;
    } else {
      [person] = await q.select().from(users).where(eq(users.id, n.to.userId));
      if (!person || person.deletedAt) return void console.log(`[notify] ${n.kind} dropped: no account`);
      address = person.emailVerifiedAt ? person.email : null;
    }
    const userId = person?.id ?? null;
    const contact = "contact" in n.to ? n.to.contact : null;
    const dedupeKey = n.key ? `${n.kind}:${contact ?? userId}:${n.key}` : crypto.randomUUID(); // no key: no dedupe (D3)
    const payload = clean(n.data);
    const row = { userId, contact, kind: n.kind, dedupeKey, payload, runAt: at, createdAt: at };
    const log = (v: Pick<typeof deliveries.$inferInsert, "channel" | "status" | "reason" | "target" | "inboxItemId"> & { runAt?: Date }) =>
      q.insert(deliveries).values({ ...row, ...v }).onConflictDoNothing({ target: [deliveries.dedupeKey, deliveries.channel, deliveries.target] });
    // Written before: nothing again. (The caps would count the first and log a second row otherwise.)
    if (n.key) {
      const [seen] = await q.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.dedupeKey, dedupeKey)).limit(1);
      const [item] = userId && !seen ? await q.select({ id: inboxItems.id }).from(inboxItems).where(and(eq(inboxItems.userId, userId), eq(inboxItems.dedupeKey, dedupeKey))) : [];
      if (seen || item) return;
    }

    // Suspended, or waiting for deletion: Must messages only.
    const held = person && ((person.suspendedAt && (!person.suspendedUntil || person.suspendedUntil > at)) || person.deletionRequestedAt);
    if (held && !isMust(n.kind)) return void (await log({ channel: "email", status: "skipped", reason: "accountState", target: "" }));

    // Here: staff's kill switch (notification_switches), from Galaxy's slice.
    let inboxItemId: string | null = null;
    const app = inboxApp(n.kind, payload);
    if (def.inbox && person && app) {
      const words = inboxFor(n.kind, payload);
      const [made] = await q
        .insert(inboxItems)
        .values({ userId: person.id, app, kind: n.kind, type: def.type, fromName: words.fromName, text: words.text, opens: words.opens, dedupeKey, createdAt: at })
        .onConflictDoNothing({ target: [inboxItems.userId, inboxItems.dedupeKey] })
        .returning({ id: inboxItems.id });
      inboxItemId = made?.id ?? null;
    }

    // The person's switches, caps and quiet hours. Must kinds skip all three. Whatever happens here, the inbox item landed.
    const must = isMust(n.kind);
    const s = person && !must ? await settingsOf(q, person.id, person.city) : null;
    if (def.email === "always") {
      if (s && switchedOff(s, n.kind, "email")) await log({ channel: "email", status: "skipped", reason: "switchOff", target: "", inboxItemId });
      // ponytail: optional email (not Must, not the one-off welcome) waits for unsubscribe links; lifts in PR 6.
      else if (!must && n.kind !== "welcome") await log({ channel: "email", status: "skipped", reason: "optionalHeld", target: "", inboxItemId });
      else await log(address ? { channel: "email", status: "queued", target: address, inboxItemId } : { channel: "email", status: "skipped", reason: "noEmail", target: "", inboxItemId });
    }
    // ponytail: "fallback" email waits for the push sender, which knows whether the push landed.
    if (!def.push || !person) return;
    const skip = (reason: string) => log({ channel: "push", status: "skipped", reason, target: "", inboxItemId });
    if (s && switchedOff(s, n.kind, "push")) return void (await skip("switchOff"));
    // Low pushes are held in quiet hours and capped at 5 a day (by the day they deliver); followedHostEvent at 1 a day per
    // host. Normal pushes are neither held nor counted toward the 5.
    // ponytail: the 3-a-day per-event announcement cap comes with announcements (PR 10).
    const low = def.level === "low";
    const quiet = low && s?.quiet ? quietUntil(at.getTime()) : null;
    const day = quiet ?? at;
    if (s && low && (await pushesOn(q, person.id, day)) >= PUSH_CAP) return void (await skip("capReached"));
    if (s && n.kind === "followedHostEvent" && (await pushesOn(q, person.id, day, String(payload.hostId))) >= 1) return void (await skip("capReached"));
    // A row per live device on the kind's app, its target the device's session (the token never goes in the log).
    const devices = await liveDevices(q, person.id, app ?? "orbit", at);
    if (!devices.length) return void (await skip("noDevice"));
    for (const d of devices) await log({ channel: "push", status: quiet ? "held" : "queued", runAt: quiet ?? at, target: d.sessionId, inboxItemId });
  };
  return async (n, tx) => {
    if (tx) return write(n, tx);
    // On its own: all rows or none. Its caller's action has already committed, so a failure here is logged, not a 500.
    try {
      await db.transaction((q) => write(n, q));
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      console.error(`[notify] ${n.kind} not written (${err.cause?.code ?? err.code ?? "error"})`); // the code only: no addresses
    }
  };
}

// Held pushes whose quiet hours are over: queued again, or dropped when the device is no longer live, the switch went
// off, or (for kinds about something still ahead) the event was cancelled or has started. Each row moves only from
// held, so two workers can't both move it. A row that throws is dropped as "error" and logged; the rest carry on.
export async function releaseHeld({ db, now, limit = 100 }: { db: Db; now: () => number; limit?: number }) {
  const at = new Date(now());
  const due = await db.select().from(deliveries).where(and(eq(deliveries.status, "held"), lte(deliveries.runAt, at))).orderBy(deliveries.runAt).limit(limit);
  for (const d of due) {
    const move = (v: Partial<typeof deliveries.$inferInsert>) => db.update(deliveries).set(v).where(and(eq(deliveries.id, d.id), eq(deliveries.status, "held")));
    try {
      const def = KINDS[d.kind as NoticeKind];
      if (!def || !d.userId) {
        await move({ status: "dropped", reason: "error" });
        continue;
      }
      const kind = d.kind as NoticeKind;
      const [person] = await db.select({ city: users.city }).from(users).where(eq(users.id, d.userId));
      const [device] = person ? await liveDevices(db, d.userId, inboxApp(kind, d.payload) ?? "orbit", at, d.target) : [];
      if (!device) await move({ status: "dropped", reason: "noDevice" });
      else if (switchedOff(await settingsOf(db, d.userId, person!.city), kind, "push")) await move({ status: "dropped", reason: "switchOff" });
      else if (AHEAD.includes(def.type) && (await stale(db, d.payload.eventId, at))) await move({ status: "dropped", reason: "stale" });
      else await move({ status: "queued", runAt: at });
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      console.error(`[release] ${d.id} dropped (${err.cause?.code ?? err.code ?? "error"})`);
      await move({ status: "dropped", reason: "error" }).catch(() => {});
    }
  }
  return due.length;
}
const stale = async (db: Db, eventId: unknown, at: Date) => {
  if (typeof eventId !== "string" || !isUuid(eventId)) return false;
  const [e] = await db.select({ status: events.status, startsAt: events.startsAt }).from(events).where(eq(events.id, eventId));
  return !!e && (e.status === "cancelled" || (!!e.startsAt && e.startsAt <= at));
};

// One pass of the worker: releases due held pushes, then claims due rows (queued, or stuck in sending past their lock) in
// one statement, so the claim commits before any send, then sends each. Retries after 1, 5 and 30 minutes, then failed.
// Returns rows handled.
export async function runDeliveries({ db, mail, now, limit = 20 }: { db: Db; mail: Mail | undefined; now: () => number; limit?: number }) {
  await releaseHeld({ db, now });
  const at = new Date(now());
  const due = db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(or(and(eq(deliveries.status, "queued"), lte(deliveries.runAt, at)), and(eq(deliveries.status, "sending"), lt(deliveries.lockedUntil, at))))
    .orderBy(deliveries.runAt)
    .limit(limit)
    .for("update", { skipLocked: true });
  const claimed = await db
    .update(deliveries)
    .set({ status: "sending", lockedUntil: new Date(at.getTime() + 2 * MIN), tries: sql`${deliveries.tries} + 1` })
    .where(inArray(deliveries.id, due))
    .returning();

  for (const d of claimed) {
    // Only while the row is still this pass's: a slow pass whose lock lapsed has lost it to another worker's claim.
    const ours = and(eq(deliveries.id, d.id), eq(deliveries.status, "sending"), eq(deliveries.tries, d.tries));
    const done = (v: Partial<typeof deliveries.$inferInsert>) => db.update(deliveries).set({ lockedUntil: null, ...v }).where(ours);
    const relet = await db.update(deliveries).set({ lockedUntil: new Date(now() + 2 * MIN) }).where(ours).returning({ id: deliveries.id });
    if (!relet.length) continue;
    // ponytail: no push sender until APNs and FCM land (PR 4); a claimed push is recorded as not set up.
    if (d.channel === "push" || !mail) {
      await done({ status: "skipped", reason: "notSetUp" });
      continue;
    }
    try {
      await mail(d.target, emailFor(d.kind, d.payload));
      await done({ status: "sent", sentAt: new Date(now()) });
    } catch (e) {
      const reason = e instanceof NotSent ? e.reason : "unknown";
      // Only the reason word: the provider's text can hold the address.
      console.error(`[deliveries] ${d.kind} ${d.id} not sent (${reason}), try ${d.tries}`);
      if (reason === "notSetUp") await done({ status: "skipped", reason });
      else if (reason === "refused" || d.tries >= 4) await done({ status: "failed", reason });
      else await done({ status: "queued", reason, runAt: new Date(now() + [1, 5, 30][d.tries - 1]! * MIN) });
    }
  }
  return claimed.length;
}

// Inbox items and deliveries go after 180 days; push devices unseen for 270.
export async function pruneNotifications(db: Db, now: number) {
  const before = new Date(now - 180 * DAY);
  await db.delete(deliveries).where(lt(deliveries.createdAt, before));
  await db.delete(inboxItems).where(lt(inboxItems.createdAt, before));
  await db.delete(pushDevices).where(lt(pushDevices.seenAt, new Date(now - 270 * DAY)));
}
