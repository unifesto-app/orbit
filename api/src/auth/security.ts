import { and, eq, isNull, ne, gt, desc } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { ChangeContact, FreshCheck } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { sessions, teamRoles, users } from "../db/schema.ts";
import { clientIp, contactOf, type Env, fail, invalid, isUuid, type Notify, parse, signedIn, taken } from "../http.ts";
import { checkCode } from "./codes.ts";
import type { User } from "./sessions.ts";
import type { Store } from "./store.ts";

// Sign-in and security (Orbit flows: User, "Managing sign-in methods" and "Account security"): the devices signed in,
// and changing the phone or email. Every change needs a fresh code, and tells the old address.

const MIN = 60 * 1000;
export const FRESH_MS = 10 * MIN;
export const HOLD_MS = 7 * 24 * 60 * MIN;

type Session = typeof sessions.$inferSelect;

// A code (or, later, a passkey) in the last 10 minutes on this device.
export const fresh = (s: Pick<Session, "freshAt">, now: number) => !!s.freshAt && now - s.freshAt.getTime() < FRESH_MS;

// After "Is this you?" was answered yes, the account's other ways in can't be removed or replaced for 7 days, unless
// this device proved one of those ways: an email that was on the account before then. An email added since doesn't
// count. Until then it says when the hold ends. (User flow, the recycled-SIM guard.)
// ponytail: the doc also allows the change to wait out the 7 days with an undo link; here it's refused until then,
// with a notice to the other way in, which needs no job runner.
export function heldUntil(u: Pick<User, "newDevicePhoneAt" | "emailVerifiedAt">, s: Pick<Session, "freshVia">, now: number): Date | null {
  const mark = u.newDevicePhoneAt?.getTime();
  if (!mark || mark + HOLD_MS <= now) return null;
  const provedOlderWay = s.freshVia === "email" && !!u.emailVerifiedAt && u.emailVerifiedAt.getTime() < mark;
  return provedOlderWay ? null : new Date(mark + HOLD_MS);
}

type Deps = { db: Db; store: Store; notify: Notify; secret: string; now?: () => number };

export function securityRoutes({ db, store, notify, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());
  const sessionOf = async (sid: string) => (await db.select().from(sessions).where(eq(sessions.id, sid)))[0]!;
  const needFresh = (c: Context) =>
    fail(c, 403, "needsFresh", "For your security, confirm it's you with a code first.");
  // A number or address the person gave up no longer marks their team places, so its next owner can be invited.
  const releaseContact = (userId: string, old: string | null) =>
    old
      ? db
          .update(teamRoles)
          .set({ contact: `user:${userId}` })
          .where(and(eq(teamRoles.userId, userId), eq(teamRoles.contact, old), isNull(teamRoles.endedAt)))
      : Promise.resolve();
  // Change notices go to the email if there is one, else to WhatsApp (User flow).
  const tellOld = (before: User, data: Record<string, unknown>) =>
    notify({ to: { contact: before.email ?? before.phone! }, kind: "signInMethodChanged", data });

  // GET /me/security: the ways in, and every device signed in.
  app.get("/me/security", auth, async (c) => {
    const u = c.var.user;
    const s = await sessionOf(c.var.sid);
    const devices = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, u.id), isNull(sessions.endedAt), gt(sessions.expiresAt, at())))
      .orderBy(desc(sessions.lastActiveAt));
    return c.json({
      phone: u.phone,
      email: u.email,
      fresh: fresh(s, now()),
      heldUntil: (u.email && heldUntil(u, s, now())?.toISOString()) || null, // nothing to hold without an email yet
      devices: devices.map((d) => ({ id: d.id, name: d.name, client: d.client, lastActive: d.lastActiveAt.toISOString(), current: d.id === s.id })),
    });
  });

  // DELETE /me/devices/:id: sign out one device.
  app.delete("/me/devices/:id", auth, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "There's nothing here.");
    const [ended] = await db
      .update(sessions)
      .set({ endedAt: at() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, c.var.user.id), isNull(sessions.endedAt)))
      .returning();
    return ended ? c.body(null, 204) : fail(c, 404, "notFound", "That device is already signed out.");
  });

  // POST /me/devices/signout-others: Sign out everywhere else.
  app.post("/me/devices/signout-others", auth, async (c) => {
    const ended = await db
      .update(sessions)
      .set({ endedAt: at() })
      .where(and(eq(sessions.userId, c.var.user.id), ne(sessions.id, c.var.sid), isNull(sessions.endedAt)))
      .returning({ id: sessions.id });
    return c.json({ signedOut: ended.length });
  });

  // POST /me/fresh: a code to the account's own phone or email (sent with POST /auth/code) makes this device fresh.
  app.post("/me/fresh", auth, async (c) => {
    const b = await parse(c, FreshCheck);
    if (!b) return invalid(c);
    const u = c.var.user;
    const to = b.via === "phone" ? (u.phone && { kind: "phone" as const, e164: u.phone }) : u.email && { kind: "email" as const, email: u.email };
    if (!to) return fail(c, 400, "invalid", "Your account has no email. Use a code to your number.");
    const r = await checkCode(store, secret, to, b.code, clientIp(c));
    if (!r.ok) return codeError(c, r.error);
    await db.update(sessions).set({ freshAt: at(), freshVia: b.via }).where(eq(sessions.id, c.var.sid));
    return c.json({ fresh: true });
  });

  // PUT /me/phone: a new number, proven by the code sent to it. The phone can be changed but never removed.
  app.put("/me/phone", auth, async (c) => {
    const b = await parse(c, ChangeContact);
    if (!b) return invalid(c);
    const to = contactOf(c, b.to);
    if (to instanceof Response) return to;
    if (to.kind !== "phone") return fail(c, 400, "invalid", "Enter a 10-digit mobile number.");
    const before = c.var.user;
    if (!fresh(await sessionOf(c.var.sid), now())) return needFresh(c);
    if (to.e164 === before.phone) return fail(c, 400, "same", "That's already your number.");
    const r = await checkCode(store, secret, to, b.code, clientIp(c));
    if (!r.ok) return codeError(c, r.error);
    try {
      // Said only now that the new number is proven, so nobody learns whose number is on Orbit.
      await db.update(users).set({ phone: to.e164, phoneVerifiedAt: at(), updatedAt: at() }).where(eq(users.id, before.id));
      await releaseContact(before.id, before.phone);
    } catch (e) {
      if (taken(e)) return fail(c, 409, "phoneTaken", "That number signs in to another Orbit account.");
      throw e;
    }
    await tellOld(before, { method: "phone", change: "changed" });
    return c.json({ phone: to.e164 });
  });

  // PUT /me/email: add or change the email, proven by the code sent to it.
  app.put("/me/email", auth, async (c) => {
    const b = await parse(c, ChangeContact);
    if (!b) return invalid(c);
    const to = contactOf(c, b.to);
    if (to instanceof Response) return to;
    if (to.kind !== "email") return fail(c, 400, "invalid", "Enter an email address.");
    const before = c.var.user;
    const s = await sessionOf(c.var.sid);
    if (!fresh(s, now())) return needFresh(c);
    if (to.email === before.email) return fail(c, 400, "same", "That's already your email.");
    const held = before.email ? heldUntil(before, s, now()) : null;
    if (held) return holdError(c, before, held, "change");
    const r = await checkCode(store, secret, to, b.code, clientIp(c));
    if (!r.ok) return codeError(c, r.error);
    try {
      await db.update(users).set({ email: to.email, emailVerifiedAt: at(), updatedAt: at() }).where(eq(users.id, before.id));
      await releaseContact(before.id, before.email);
    } catch (e) {
      if (taken(e)) return fail(c, 409, "emailTaken", "That email signs in to another Orbit account.");
      throw e;
    }
    await tellOld(before, { method: "email", change: before.email ? "changed" : "added" });
    return c.json({ email: to.email });
  });

  // DELETE /me/email. Never the last way in; the phone always stays, so the email can go.
  app.delete("/me/email", auth, async (c) => {
    const before = c.var.user;
    if (!before.email) return fail(c, 404, "notFound", "Your account has no email.");
    const s = await sessionOf(c.var.sid);
    if (!fresh(s, now())) return needFresh(c);
    const held = heldUntil(before, s, now());
    if (held) return holdError(c, before, held, "remove");
    await db.update(users).set({ email: null, emailVerifiedAt: null, updatedAt: at() }).where(eq(users.id, before.id));
    await releaseContact(before.id, before.email);
    await tellOld(before, { method: "email", change: "removed" });
    return c.body(null, 204);
  });

  // The hold after "Is this you?": refused, and the other way in hears that someone tried.
  const holdError = async (c: Context, u: User, until: Date, change: string) => {
    // At most once an hour, so repeated tries don't flood the inbox.
    if ((await store.incr(`heldNotice:${u.id}`, 60 * MIN)) === 1)
      await notify({ to: { contact: u.email! }, kind: "signInMethodChangeHeld", data: { method: "email", change, until: until.toISOString() } });
    const day = until.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    return fail(c, 403, "held", `You signed in with your number on a new phone. To change your email before ${day}, confirm with a code to that email.`, {
      until: until.toISOString(),
    });
  };

  return app;
}

const codeError = (c: Parameters<typeof fail>[0], error: "tooMany" | "expired" | "wrongCode") =>
  error === "tooMany"
    ? fail(c, 429, "tooMany", "Too many tries. Wait 15 minutes, then send a new code.")
    : error === "expired"
      ? fail(c, 400, "codeExpired", "That code has expired. Send a new one.")
      : fail(c, 400, "wrongCode", "That code isn't right. Check the latest message, or send a new code.");
