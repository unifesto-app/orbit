import { and, eq, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  ADULT,
  AboutYou,
  AddEmail,
  adultOn,
  ageOn,
  Confirm,
  type Contact,
  type Device,
  maskName,
  type Me,
  Refresh,
  SendCode,
  UpdateMe,
  VerifyCode,
} from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { legalAcceptances, users } from "../db/schema.ts";
import { clientIp, contactOf, type Env, fail, invalid, type Notify, parse, signedIn, suspended, taken } from "../http.ts";
import { clearLapsedSuspension, rolesOf } from "../roles/access.ts";
import { checkCode, OPEN, RESEND_AFTER, sendCode, type Sender, type SendPolicy } from "./codes.ts";
import { nextFor, resolve, type Pending, type Pick } from "./resolve.ts";
import { deviceKnown, endSession, isSuspended, refresh, startSession, type User } from "./sessions.ts";
import type { Store } from "./store.ts";
import { ACCESS_SECONDS, issue, read, TOKEN_MAX_MS } from "./tokens.ts";

// Sign-in, sign-up and the profile (Orbit flows: User). Every error says what to do next.

export type Deps = { db: Db; store: Store; send: Sender; notify: Notify; secret: string; now?: () => number; codes?: SendPolicy };

// ponytail: the terms version is a constant until Galaxy's Legal documents keeps them in the database. The migration
// must leave every copied Unifesto acceptance below it, so each migrated person accepts Orbit's terms at About you.
const TERMS_VERSION = 1;

const TOO_LONG = "That took too long. Start signing in again.";
const PHONE_TAKEN = "That number signs in to another Orbit account. Use a different number.";

export function authRoutes({ db, store, send, notify, secret, now = Date.now, codes = OPEN }: Deps) {
  const app = new Hono<Env>();
  const me = async (u: User): Promise<Me> => ({ ...profile(u), ...(await rolesOf(db, u, now())) });
  const userById = async (id: string) => (await db.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))))[0] ?? null;
  // A code just proved this account's phone or email. A host-added or migrated row may not have it marked yet.
  const markProven = async (user: User, proof: Contact) => {
    const column = proof.kind === "phone" ? "phoneVerifiedAt" : "emailVerifiedAt";
    if (user[column]) return user;
    const at = new Date(now());
    return (await db.update(users).set({ [column]: at, updatedAt: at }).where(eq(users.id, user.id)).returning())[0]!;
  };
  // A step token that makes an account or a session works once.
  const spend = async (jti: string) => (await store.incr(`spent:${jti}`, TOKEN_MAX_MS)) === 1;
  const termsAccepted = async (userId: string) =>
    (
      await db
        .select({ id: legalAcceptances.id })
        .from(legalAcceptances)
        .where(and(eq(legalAcceptances.userId, userId), eq(legalAcceptances.document, "terms"), eq(legalAcceptances.version, TERMS_VERSION)))
        .limit(1)
    ).length > 0;

  const under18 = (c: Context, opensOn?: string) =>
    fail(c, 403, "under18", "Orbit is for people 18 and over. A host can still add you to their event as a guest.", opensOn ? { opensOn } : {});

  // Signs in, or sends the account to the step it still needs.
  const finish = async (c: Context, user: User, device: Device, via: "phone" | "email", addEmail?: string) => {
    // A migrated or host-added person under 18 stays a guest whatever else is on file: their tickets still work, and
    // the account opens on their 18th birthday.
    if (user.dob && ageOn(user.dob, now()) < ADULT) return under18(c, adultOn(user.dob));
    const next = nextFor({ phone: user.phone, dob: user.dob, termsAccepted: await termsAccepted(user.id) });
    const carry: Pending = { userId: user.id, email: addEmail, via };
    if (next === "phone") return c.json({ step: "phone", signup: await issue(secret, "phoneStep", carry) });
    if (next === "aboutYou") return c.json({ step: "aboutYou", signup: await issue(secret, "aboutYou", carry), name: user.name });
    user = await clearLapsedSuspension(db, user, now());
    const tokens = await startSession(db, secret, user.id, device, now(), via);
    const offer = addEmail && !user.email ? { email: addEmail, token: await issue(secret, "addEmail", { sub: user.id, email: addEmail }) } : undefined;
    return c.json({ step: "signedIn", ...tokens, me: await me(user), addEmail: offer });
  };

  // POST /auth/code: the same answer whether or not an account exists.
  app.post("/auth/code", async (c) => {
    const b = await parse(c, SendCode);
    if (!b) return invalid(c);
    const to = contactOf(c, b.to);
    if (to instanceof Response) return to;
    const r = await sendCode(store, send, secret, to, clientIp(c), codes);
    if (r.ok) return c.json({ retryIn: RESEND_AFTER }); // also when the outcome is unsure: the code is kept, and they can ask again
    const byPhone = to.kind === "phone";
    switch (r.error) {
      case "notOpen":
        return fail(c, 403, "notOpen", "Orbit isn't open yet. We'll let you know as soon as it is.");
      case "tooSoon":
        return fail(c, 429, "tooSoon", `Wait ${RESEND_AFTER} seconds, then send a new code.`, { retryIn: RESEND_AFTER });
      case "tooMany":
        return fail(c, 429, "tooMany", "Too many codes sent. Try again tomorrow, or sign in another way.");
      case "notSent":
        if (r.reason === "throttled")
          return fail(c, 503, "tryLater", "A lot of codes are going out right now. Try again in a minute.", { retryIn: 60 });
        if (r.reason === "notSetUp")
          return fail(c, 503, "notSent", byPhone ? "Codes by WhatsApp aren't working right now. Use your email instead." : "Codes by email aren't working right now. Use your phone number instead.");
        return fail(
          c,
          400,
          "notSent",
          byPhone
            ? "We couldn't send a WhatsApp message to that number. Check it's on WhatsApp, or use your email instead."
            : "We couldn't send an email to that address. Check it, or use your phone number instead.",
        );
    }
  });

  // POST /auth/code/verify: the code proves the phone or email, then the account decides the next step.
  app.post("/auth/code/verify", async (c) => {
    const b = await parse(c, VerifyCode);
    if (!b) return invalid(c);
    const to = contactOf(c, b.to);
    if (to instanceof Response) return to;
    const pending = b.signup ? await read<Pending>(secret, "phoneStep", b.signup) : null;
    if (b.signup && !pending) return fail(c, 400, "expired", TOO_LONG);

    const check = await checkCode(store, secret, to, b.code, clientIp(c));
    if (!check.ok) {
      if (check.error === "tooMany") return fail(c, 429, "tooMany", "Too many tries. Wait 15 minutes, then send a new code.");
      if (check.error === "expired") return fail(c, 400, "codeExpired", "That code has expired. Send a new one.");
      return fail(c, 400, "wrongCode", "That code isn't right. Check the latest message, or send a new code.");
    }

    const [found] = await db
      .select()
      .from(users)
      .where(to.kind === "phone" ? eq(users.phone, to.e164) : eq(users.email, to.email));
    const pick = resolve(to, found ? { id: found.id, email: found.email, deviceKnown: await deviceKnown(db, found.id, b.device.id) } : null, pending);
    return proceed(c, pick, to, b.device, pending);
  });

  const proceed = async (c: Context, pick: Pick, proof: Contact, device: Device, pending: Pending | null) => {
    if ("refuse" in pick) return fail(c, 409, "phoneTaken", PHONE_TAKEN);
    if ("fresh" in pick) {
      return pick.fresh.phone
        ? c.json({ step: "aboutYou", signup: await issue(secret, "aboutYou", pick.fresh), name: null })
        : c.json({ step: "phone", signup: await issue(secret, "phoneStep", pick.fresh) });
    }

    let user: User | null | undefined = await userById("confirm" in pick ? pick.confirm : pick.account);
    if (!user) return fail(c, 400, "expired", TOO_LONG);
    // Only now, after the code checked out, does anything say the account exists.
    if (isSuspended(user, now())) return suspended(c, user);

    if ("confirm" in pick) {
      const ticket = await issue(secret, "ticket", { sub: user.id, phone: user.phone, email: pending?.email });
      return c.json({ step: "confirm", ticket, name: user.name?.trim() ? maskName(user.name) : "An account", since: user.createdAt.getFullYear() });
    }

    const at = new Date(now());
    // An invite placeholder is claimed only once a code proves its email or phone. With `setPhone` the proof was the
    // number going onto the account, not one it holds.
    if (!pick.setPhone) user = await markProven(user, proof);
    else {
      try {
        // Only onto an account with no phone: changing a phone is Sign-in and security's, with its own checks.
        [user] = await db
          .update(users)
          .set({ phone: pick.setPhone, phoneVerifiedAt: at, updatedAt: at })
          .where(and(eq(users.id, user!.id), isNull(users.phone)))
          .returning();
      } catch (e) {
        if (taken(e)) return fail(c, 409, "phoneTaken", PHONE_TAKEN);
        throw e;
      }
      // Nothing changed: fine if this number is already on it (a retry whose first answer was lost).
      user ??= await userById(pick.account);
      if (user?.phone !== pick.setPhone) return fail(c, 400, "expired", TOO_LONG);
    }
    return finish(c, user!, device, proof.kind, pick.addEmail);
  };

  // POST /auth/confirm: "Is this you?" Yes signs in; "Not me, start fresh" moves the number to a new account, made at
  // About you. The old account keeps its other ways in and is asked for a new number next time.
  // ponytail: the 7-day hold on removing other ways in after a yes here comes with Sign-in and security, as a mark on
  // the account (not the session), checked against when each way in was added.
  app.post("/auth/confirm", async (c) => {
    const b = await parse(c, Confirm);
    if (!b) return invalid(c);
    const t = await read<{ sub: string; phone: string; email?: string }>(secret, "ticket", b.ticket);
    const user = t && (await spend(t.jti)) && (await userById(t.sub));
    if (!t || !user || user.phone !== t.phone) return fail(c, 400, "expired", TOO_LONG);
    if (isSuspended(user, now())) return suspended(c, user);
    if (b.me) {
      // Marked on the account, not the device, so signing in elsewhere doesn't shed it (Sign-in and security's 7-day hold).
      const [marked] = await db.update(users).set({ newDevicePhoneAt: new Date(now()) }).where(eq(users.id, user.id)).returning();
      return finish(c, await markProven(marked!, { kind: "phone", e164: t.phone }), b.device, "phone", t.email);
    }
    const fresh: Pending = { phone: t.phone, email: t.email, displace: user.id };
    return c.json({ step: "aboutYou", signup: await issue(secret, "aboutYou", fresh), name: null });
  });

  // POST /auth/signup: About you. Continue makes the account, or finishes an existing one, with the terms accepted.
  app.post("/auth/signup", async (c) => {
    const b = await parse(c, AboutYou);
    if (!b) return invalid(c);
    const p = await read<Pending>(secret, "aboutYou", b.signup);
    if (!p) return fail(c, 400, "expired", TOO_LONG);
    const at = new Date(now());

    if (p.userId) {
      if (!(await spend(p.jti))) return fail(c, 400, "expired", TOO_LONG);
      const user = await userById(p.userId);
      if (!user?.phone) return fail(c, 400, "expired", TOO_LONG);
      if (isSuspended(user, now())) return suspended(c, user);
      const dob = user.dob ?? b.dob; // only support changes a date already on file
      if (ageOn(dob, now()) < ADULT) {
        // Kept, so it can't be typed again differently; `finish` holds them off until their 18th birthday.
        if (!user.dob) await db.update(users).set({ dob, updatedAt: at }).where(eq(users.id, user.id));
        return under18(c, adultOn(dob));
      }
      const [done] = await db.transaction(async (tx) => {
        await tx.insert(legalAcceptances).values({ userId: user.id, document: "terms", version: TERMS_VERSION, client: b.device.client, acceptedAt: at }).onConflictDoNothing();
        return tx.update(users).set({ name: b.name, dob, updatedAt: at }).where(eq(users.id, user.id)).returning();
      });
      return finish(c, done!, b.device, p.via ?? "phone", p.email);
    }

    if (!p.phone) return fail(c, 400, "expired", TOO_LONG);
    // No account, and nothing saved. The token stays good, so a mistyped year can be fixed on the same screen.
    if (ageOn(b.dob, now()) < ADULT) return under18(c);
    if (!(await spend(p.jti))) return fail(c, 400, "expired", TOO_LONG);
    const displaced = p.displace ? await userById(p.displace) : null;
    let moved = false;
    try {
      const [user] = await db.transaction(async (tx) => {
        // Only if it still holds the number; it may have changed it meanwhile.
        if (p.displace)
          moved = (await tx.update(users).set({ phone: null, phoneVerifiedAt: null, updatedAt: at }).where(and(eq(users.id, p.displace), eq(users.phone, p.phone!))).returning({ id: users.id })).length > 0;
        const made = await tx
          .insert(users)
          .values({ name: b.name, dob: b.dob, phone: p.phone, phoneVerifiedAt: at, email: p.email, emailVerifiedAt: p.email ? at : null, createdAt: at, updatedAt: at })
          .returning();
        await tx.insert(legalAcceptances).values({ userId: made[0]!.id, document: "terms", version: TERMS_VERSION, client: b.device.client, acceptedAt: at });
        return made;
      });
      // The account the number left hears of it at its email, its other way in (a recycled SIM's old owner).
      if (moved && displaced?.email) await notify({ to: { contact: displaced.email }, kind: "phoneMovedAway", data: { phone: p.phone } });
      return finish(c, user!, b.device, "phone");
    } catch (e) {
      if (taken(e)) return fail(c, 409, "taken", "That number or email was just used for another account. Start signing in again.");
      throw e;
    }
  });

  // POST /auth/refresh
  app.post("/auth/refresh", async (c) => {
    const b = await parse(c, Refresh);
    if (!b) return invalid(c);
    const r = await refresh(db, secret, b.refresh, now());
    if (r.ok) return c.json({ access: r.access, refresh: r.refresh, expiresIn: ACCESS_SECONDS });
    return r.suspended ? suspended(c, r.suspended) : fail(c, 401, "signedOut", "You're signed out. Sign in again.");
  });

  const auth = signedIn(db, secret, now);

  app.post("/auth/signout", auth, async (c) => {
    await endSession(db, c.var.sid, now());
    return c.body(null, 204);
  });

  app.get("/me", auth, async (c) => c.json(await me(c.var.user)));

  app.patch("/me", auth, async (c) => {
    const b = await parse(c, UpdateMe);
    if (!b) return invalid(c);
    const [user] = await db.update(users).set({ ...b, updatedAt: new Date(now()) }).where(eq(users.id, c.var.user.id)).returning();
    return c.json(await me(user!));
  });

  // POST /me/email: "Add this email to your account?", answered yes.
  app.post("/me/email", auth, async (c) => {
    const b = await parse(c, AddEmail);
    const t = b && (await read<{ sub: string; email: string }>(secret, "addEmail", b.token));
    if (!t || t.sub !== c.var.user.id) return fail(c, 400, "expired", "That took too long. Add the email from Sign-in and security.");
    const at = new Date(now());
    try {
      const [user] = await db
        .update(users)
        .set({ email: t.email, emailVerifiedAt: at, updatedAt: at })
        .where(and(eq(users.id, c.var.user.id), isNull(users.email)))
        .returning();
      if (!user) return fail(c, 409, "hasEmail", "Your account already has an email. Change it from Sign-in and security.");
      // Every way in that's added is told to the account, as in Sign-in and security.
      await notify({ to: { contact: user.phone! }, kind: "signInMethodChanged", data: { method: "email", change: "added" } });
      return c.json(await me(user));
    } catch (e) {
      if (taken(e)) return fail(c, 409, "emailTaken", "That email signs in to another Orbit account.");
      throw e;
    }
  });

  return app;
}

export const profile = (u: User): Omit<Me, "teams" | "staff"> => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email,
  dob: u.dob,
  gender: u.gender,
  photo: u.photo,
  since: u.createdAt.toISOString(),
  deletionDue: u.deletionDueAt?.toISOString() ?? null,
});
