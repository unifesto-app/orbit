import { and, eq, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  ADULT,
  AboutYou,
  AddEmail,
  adultOn,
  AppleSignIn,
  ageOn,
  Confirm,
  type Contact,
  type Device,
  GoogleSignIn,
  maskName,
  type Me,
  PasskeySignIn,
  Refresh,
  SendCode,
  UpdateMe,
  VerifyCode,
  type Way,
} from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { identities, legalAcceptances, users } from "../db/schema.ts";
import { clientIp, contactOf, type Env, fail, invalid, type Notify, parse, signedIn, suspended, taken } from "../http.ts";
import { clearLapsedSuspension, rolesOf } from "../roles/access.ts";
import { checkCode, OPEN, RESEND_AFTER, sendCode, type Sender, type SendPolicy } from "./codes.ts";
import { nextFor, resolve, type Pending, type Pick } from "./resolve.ts";
import { deviceKnown, endSession, isSuspended, refresh, startSession, type User } from "./sessions.ts";
import type { Store } from "./store.ts";
import { HOLD_MS } from "./security.ts";
import { ACCESS_SECONDS, issue, read, TOKEN_MAX_MS } from "./tokens.ts";
import { defaultWays, type Identity, relay, ways, type WaysConfig } from "./ways.ts";

// Sign-in, sign-up and the profile (Orbit flows: User). Every error says what to do next.

export type Deps = { db: Db; store: Store; send: Sender; notify: Notify; secret: string; now?: () => number; codes?: SendPolicy; ways?: WaysConfig };

// ponytail: the terms version is a constant until Galaxy's Legal documents keeps them in the database. The migration
// must leave every copied Unifesto acceptance below it, so each migrated person accepts Orbit's terms at About you.
const TERMS_VERSION = 1;

const TOO_LONG = "That took too long. Start signing in again.";
const PHONE_TAKEN = "That number signs in to another Orbit account. Use a different number.";

export function authRoutes({ db, store, send, notify, secret, now = Date.now, codes = OPEN, ways: waysConfig = defaultWays }: Deps) {
  const app = new Hono<Env>();
  const w = ways(waysConfig, store);
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

  // Google or Apple onto this account, told to the account. Null when the account already has one of that provider
  // (one each), or this one is on another account meanwhile.
  const link = async (userId: string, id: Identity) => {
    const appleRefresh = id.provider === "apple" ? await w.appleRefresh(id.subject) : null;
    const [row] = await db
      .insert(identities)
      .values({ userId, provider: id.provider, subject: id.subject, email: id.email, appleRefresh, createdAt: new Date(now()) })
      .onConflictDoNothing()
      .returning();
    if (row) await notify({ to: { userId }, kind: "signInMethodChanged", data: { method: id.provider, change: "added" } });
    return row ?? null;
  };

  // Signs in, or sends the account to the step it still needs. `since`: when the Google, Apple or passkey it signed in
  // with was added. `offer`: a way in to offer adding, the email or Google or Apple they started with.
  const finish = async (c: Context, user: User, device: Device, via: Way, offer: { email?: string; identity?: Identity } = {}, since: Date | null = null) => {
    const addEmail = offer.email;
    // A migrated or host-added person under 18 stays a guest whatever else is on file: their tickets still work, and
    // the account opens on their 18th birthday.
    if (user.dob && ageOn(user.dob, now()) < ADULT) return under18(c, adultOn(user.dob));
    const next = nextFor({ phone: user.phone, dob: user.dob, termsAccepted: await termsAccepted(user.id) });
    const carry: Pending = { userId: user.id, email: addEmail, via, identity: offer.identity };
    if (next === "phone") return c.json({ step: "phone", signup: await issue(secret, "phoneStep", carry) });
    if (next === "aboutYou") return c.json({ step: "aboutYou", signup: await issue(secret, "aboutYou", carry), name: user.name });
    user = await clearLapsedSuspension(db, user, now());
    const tokens = await startSession(db, secret, user.id, device, now(), via, since);
    const emailOffer = addEmail && !user.email ? { email: addEmail, token: await issue(secret, "addEmail", { sub: user.id, email: addEmail }) } : undefined;
    const id = offer.identity;
    const hasOne = id && (await db.select({ id: identities.id }).from(identities).where(and(eq(identities.userId, user.id), eq(identities.provider, id.provider)))).length > 0;
    const wayOffer = id && !hasOne ? { provider: id.provider, email: id.email, token: await issue(secret, "addWay", { sub: user.id, ...id }) } : undefined;
    return c.json({ step: "signedIn", ...tokens, me: await me(user), addEmail: emailOffer, addWay: wayOffer });
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
        ? c.json({ step: "aboutYou", signup: await issue(secret, "aboutYou", pick.fresh), name: pick.fresh.name ?? null })
        : c.json({ step: "phone", signup: await issue(secret, "phoneStep", pick.fresh) });
    }

    let user: User | null | undefined = await userById("confirm" in pick ? pick.confirm : pick.account);
    if (!user) return fail(c, 400, "expired", TOO_LONG);
    // Only now, after the code checked out, does anything say the account exists.
    if (isSuspended(user, now())) return suspended(c, user);

    if ("confirm" in pick) {
      const ticket = await issue(secret, "ticket", { sub: user.id, phone: user.phone, email: pending?.email, identity: pending?.identity, name: pending?.name });
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
    return finish(c, user!, device, proof.kind, { email: pick.addEmail, identity: pick.addIdentity });
  };

  // POST /auth/confirm: "Is this you?" Yes signs in; "Not me, start fresh" moves the number to a new account, made at
  // About you. The old account keeps its other ways in and is asked for a new number next time.
  // ponytail: the 7-day hold on removing other ways in after a yes here comes with Sign-in and security, as a mark on
  // the account (not the session), checked against when each way in was added.
  app.post("/auth/confirm", async (c) => {
    const b = await parse(c, Confirm);
    if (!b) return invalid(c);
    const t = await read<{ sub: string; phone: string; email?: string; identity?: Identity; name?: string }>(secret, "ticket", b.ticket);
    const user = t && (await spend(t.jti)) && (await userById(t.sub));
    if (!t || !user || user.phone !== t.phone) return fail(c, 400, "expired", TOO_LONG);
    if (isSuspended(user, now())) return suspended(c, user);
    if (b.me) {
      // Marked on the account, not the device, so signing in elsewhere doesn't shed it (Sign-in and security's 7-day hold).
      // A hold already running keeps its start: a second yes must not move the mark past a way in added after the first.
      const running = user.newDevicePhoneAt && now() - user.newDevicePhoneAt.getTime() < HOLD_MS;
      const [marked] = await db
        .update(users)
        .set({ newDevicePhoneAt: running ? user.newDevicePhoneAt : new Date(now()) })
        .where(eq(users.id, user.id))
        .returning();
      return finish(c, await markProven(marked!, { kind: "phone", e164: t.phone }), b.device, "phone", { email: t.email, identity: t.identity });
    }
    const fresh: Pending = { phone: t.phone, email: t.email, displace: user.id, identity: t.identity, name: t.name };
    return c.json({ step: "aboutYou", signup: await issue(secret, "aboutYou", fresh), name: t.name ?? null });
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
      return finish(c, done!, b.device, p.via ?? "phone", { email: p.email, identity: p.identity });
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
        // The Google or Apple they started with is a way in from the start.
        if (p.identity) {
          const appleRefresh = p.identity.provider === "apple" ? await w.appleRefresh(p.identity.subject) : null;
          await tx.insert(identities).values({ userId: made[0]!.id, ...p.identity, appleRefresh, createdAt: at });
        }
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

  // Google and Apple (User flow, "How a sign-in finds its account"): a linked one signs in to its account; otherwise its
  // email, proven by Google or Apple, finds an account as an email code would, and the provider is added to it; with no
  // account, the WhatsApp number comes next, then About you with their name. Apple's private relay address is kept on
  // the link only, never as the account's email: it matches nothing else, and mail to it needs Apple's sender setup.
  // `proves`: whether the provider's email proves the address today, so it may find an account and become its email.
  const signInWith = async (c: Context, id: Identity, device: Device, name: string | null | undefined, proves: boolean) => {
    const [row] = await db.select().from(identities).where(and(eq(identities.provider, id.provider), eq(identities.subject, id.subject)));
    if (row) {
      const user = await userById(row.userId);
      if (!user) return fail(c, 400, "expired", TOO_LONG); // a deleted account's link is gone with it
      if (isSuspended(user, now())) return suspended(c, user);
      // A link made before Apple's key was set up gets its revoke token now.
      const appleRefresh = id.provider === "apple" && !row.appleRefresh ? await w.appleRefresh(id.subject) : null;
      await db
        .update(identities)
        .set({ lastUsedAt: new Date(now()), ...(appleRefresh && { appleRefresh }) })
        .where(eq(identities.id, row.id));
      return finish(c, user, device, id.provider, {}, row.createdAt);
    }
    const email = proves && id.email && !relay(id.email) ? id.email : null;
    const [found] = email ? await db.select().from(users).where(and(eq(users.email, email), isNull(users.deletedAt))) : [];
    if (found) {
      if (isSuspended(found, now())) return suspended(c, found);
      const user = await markProven(found, { kind: "email", email: email! });
      const linked = await link(user.id, id);
      // Already has another Google (one each): the email still proved the account, as a code to it would.
      return linked ? finish(c, user, device, id.provider, {}, linked.createdAt) : finish(c, user, device, "email");
    }
    const carry: Pending = { email: email ?? undefined, identity: id, name: name?.trim() || undefined, via: id.provider };
    return c.json({ step: "phone", signup: await issue(secret, "phoneStep", carry) });
  };

  // Nonces, Google pages and passkey challenges each live in the store for minutes, so one address gets 60 a minute of
  // each: room for a venue's Wi-Fi or a carrier's shared address, not for filling the store.
  const tooManyAsks = async (c: Context, what: string) => (await store.incr(`asks:${what}:${clientIp(c)}`, 60 * 1000)) > 60;
  const slowDown = (c: Context) => fail(c, 429, "tooSoon", "Too many tries. Wait a minute and try again.", { retryIn: 60 });

  // POST /auth/nonce: for Apple's sheet, spent by the token Apple makes with it.
  app.post("/auth/nonce", async (c) => ((await tooManyAsks(c, "nonce")) ? slowDown(c) : c.json({ nonce: await w.nonce() })));

  // POST /auth/apple: Continue with Apple (iOS).
  app.post("/auth/apple", async (c) => {
    const b = await parse(c, AppleSignIn);
    if (!b) return invalid(c);
    const id = await w.apple(b);
    if (!id) return fail(c, 400, "notProven", "Apple couldn't confirm it's you. Try again, or use your phone number.");
    return signInWith(c, id, b.device, b.name, true);
  });

  // POST /auth/google/start: the Google page to open, for signing in, linking or a fresh check alike.
  app.post("/auth/google/start", async (c) => {
    if (await tooManyAsks(c, "google")) return slowDown(c);
    const started = await w.googleStart();
    return started ? c.json(started) : fail(c, 503, "notSetUp", "Google sign-in isn't set up yet. Use your phone number or email.");
  });
  // GET /auth/google/callback: Google sends the browser here; it goes back to the app.
  app.get("/auth/google/callback", async (c) => c.redirect(await w.googleCallback(c.req.query()), 302));

  // POST /auth/google: Continue with Google, with the grant the page handed back.
  app.post("/auth/google", async (c) => {
    const b = await parse(c, GoogleSignIn);
    if (!b) return invalid(c);
    const id = await w.google(b);
    if (!id) return fail(c, 400, "expired", "That took too long. Try Continue with Google again.");
    return signInWith(c, { provider: id.provider, subject: id.subject, email: id.email }, b.device, id.name, id.proves);
  });

  // POST /auth/passkey/options, then POST /auth/passkey: Use a passkey. A passkey is only ever added while signed in,
  // so it always opens an account; no "Is this you?", as it proves more than a number does.
  app.post("/auth/passkey/options", async (c) => ((await tooManyAsks(c, "passkey")) ? slowDown(c) : c.json(await w.passkeyRequest())));
  app.post("/auth/passkey", async (c) => {
    const b = await parse(c, PasskeySignIn);
    if (!b) return invalid(c);
    const key = await w.passkey(db, b, now());
    const user = key && (await userById(key.userId));
    if (!key || !user) return fail(c, 400, "notProven", "That passkey isn't on Orbit. Use your phone number or email.");
    if (isSuspended(user, now())) return suspended(c, user);
    return finish(c, user, b.device, "passkey", {}, key.createdAt);
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
  city: u.city,
  since: u.createdAt.toISOString(),
  deletionDue: u.deletionDueAt?.toISOString() ?? null,
});
