import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { inboxApp, isMust, KINDS } from "@orbit/contract";
import { type Mail, NotSent } from "./auth/senders.ts";
import type { Db } from "./db/index.ts";
import { deliveries, inboxItems, users } from "./db/schema.ts";
import type { Notice, Notify, Tx } from "./http.ts";
import { emailFor, inboxFor } from "./notification-emails.ts";

// Notifications (build plan PR 1; contract/src/notifications.ts). notify() writes the inbox item and one deliveries row
// per channel, inside the caller's transaction when given one; the worker sends queued email rows. The queue is the
// deliveries table: no Redis, no queue service. WhatsApp is never a channel. Push has no devices yet, so it's logged
// as skipped (D2); email "fallback" kinds write nothing until the push sender lands.

const DAY = 86_400_000;
const MIN = 60_000;

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
    const log = (v: Pick<typeof deliveries.$inferInsert, "channel" | "status" | "reason" | "target" | "inboxItemId">) =>
      q.insert(deliveries).values({ ...row, ...v }).onConflictDoNothing({ target: [deliveries.dedupeKey, deliveries.channel, deliveries.target] });

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

    // Here: the person's switches, caps and quiet hours, from the settings slice. Until it lands (PR 6), email goes for
    // Must kinds and the one-off welcome only; the optional kinds' email is held (spec section 11).
    if (def.email === "always" && !isMust(n.kind) && n.kind !== "welcome") await log({ channel: "email", status: "skipped", reason: "optionalHeld", target: "", inboxItemId });
    else if (def.email === "always") {
      await log(address ? { channel: "email", status: "queued", target: address, inboxItemId } : { channel: "email", status: "skipped", reason: "noEmail", target: "", inboxItemId });
    }
    // ponytail: "fallback" email waits for the push sender, which knows whether the push landed.
    if (def.push && person) await log({ channel: "push", status: "skipped", reason: "noDevice", target: "", inboxItemId });
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

// One pass of the worker: claims due rows (queued, or stuck in sending past their lock) in one statement, so the claim
// commits before any send, then sends each. Retries after 1, 5 and 30 minutes, then failed. Returns rows handled.
export async function runDeliveries({ db, mail, now, limit = 20 }: { db: Db; mail: Mail | undefined; now: () => number; limit?: number }) {
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
    if (!mail) {
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

// Inbox items and deliveries go after 180 days.
export async function pruneNotifications(db: Db, now: number) {
  const before = new Date(now - 180 * DAY);
  await db.delete(deliveries).where(lt(deliveries.createdAt, before));
  await db.delete(inboxItems).where(lt(inboxItems.createdAt, before));
}
