import { and, asc, count, eq, isNull, ne, gt, desc } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { AddPasskey, AddWay, AppleProof, ChangeContact, FreshCheck, GoogleProof, Provider, RenamePasskey, type Way } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { identities, passkeys, sessions, teamRoles, users } from "../db/schema.ts";
import { clientIp, contactOf, type Env, fail, invalid, isUuid, type Notify, parse, signedIn, taken } from "../http.ts";
import { checkCode } from "./codes.ts";
import type { User } from "./sessions.ts";
import type { Store } from "./store.ts";
import { read, TOKEN_MAX_MS } from "./tokens.ts";
import { defaultWays, type Identity, relay, ways, type WaysConfig } from "./ways.ts";

// Sign-in and security (Orbit flows: User, "Managing sign-in methods" and "Account security"): the devices signed in,
// and every way in: the phone and email, Google and Apple, and passkeys. Every change needs a fresh check by any way
// in the account has, and is told to the account. The phone can be changed but never removed, and nothing removes the
// last way in.

const MIN = 60 * 1000;
export const FRESH_MS = 10 * MIN;
export const HOLD_MS = 7 * 24 * 60 * MIN;

type Session = typeof sessions.$inferSelect;

// A way in proved in the last 10 minutes on this device.
export const fresh = (s: Pick<Session, "freshAt">, now: number) => !!s.freshAt && now - s.freshAt.getTime() < FRESH_MS;

// After "Is this you?" was answered yes, the account's other ways in can't be removed or replaced for 7 days, unless
// this device proved one of those ways: an email, Google, Apple or passkey that was on the account before then. One
// added since doesn't count, so a recycled SIM can't add a passkey and then strip the rest. Until then it says when the
// hold ends. (User flow, the recycled-SIM guard.)
// ponytail: the doc also allows the change to wait out the 7 days with an undo link; here it's refused until then,
// with a notice to the other way in, which needs no job runner.
export function heldUntil(
  u: Pick<User, "newDevicePhoneAt" | "emailVerifiedAt">,
  s: Pick<Session, "freshVia"> & Partial<Pick<Session, "freshSince">>,
  now: number,
): Date | null {
  const mark = u.newDevicePhoneAt?.getTime();
  if (!mark || mark + HOLD_MS <= now) return null;
  const since = s.freshVia === "email" ? u.emailVerifiedAt : s.freshVia && s.freshVia !== "phone" ? s.freshSince : null;
  const provedOlderWay = !!since && since.getTime() < mark;
  return provedOlderWay ? null : new Date(mark + HOLD_MS);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const LAST = new Error("last way in"); // thrown to undo a removal that would leave no way in
// Every way in the account has, counted: the phone, the email, Google, Apple and each passkey.
export async function waysIn(db: Db | Tx, u: Pick<User, "id" | "phone" | "email">) {
  const [ids] = await db.select({ n: count() }).from(identities).where(eq(identities.userId, u.id));
  const [keys] = await db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, u.id));
  return (u.phone ? 1 : 0) + (u.email ? 1 : 0) + ids!.n + keys!.n;
}
// Where a notice about the account goes when it must reach a way other than the phone: the email, else a linked
// Google or Apple address. Null for an account with only its phone and passkeys.
export async function otherAddress(db: Db, u: Pick<User, "id" | "email">) {
  if (u.email) return u.email;
  const rows = await db.select({ email: identities.email }).from(identities).where(eq(identities.userId, u.id)).orderBy(asc(identities.createdAt));
  return rows.find((r) => r.email && !relay(r.email))?.email ?? null;
}

type Deps = { db: Db; store: Store; notify: Notify; secret: string; now?: () => number; ways?: WaysConfig };

export function securityRoutes({ db, store, notify, secret, now = Date.now, ways: waysConfig = defaultWays }: Deps) {
  const app = new Hono<Env>();
  const w = ways(waysConfig, store);
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());
  const sessionOf = async (sid: string) => (await db.select().from(sessions).where(eq(sessions.id, sid)))[0]!;
  const needFresh = (c: Context) =>
    fail(c, 403, "needsFresh", "For your security, confirm it's you first.");
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
    notify({ to: before.email || before.phone ? { contact: (before.email ?? before.phone)! } : { userId: before.id }, kind: "signInMethodChanged", data });
  const NAMES = { google: "Google", apple: "Apple" } as const;

  // GET /me/security: the ways in, and every device signed in.
  app.get("/me/security", auth, async (c) => {
    const u = c.var.user;
    const s = await sessionOf(c.var.sid);
    const devices = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, u.id), isNull(sessions.endedAt), gt(sessions.expiresAt, at())))
      .orderBy(desc(sessions.lastActiveAt));
    const linked = await db.select().from(identities).where(eq(identities.userId, u.id));
    const keys = await db.select().from(passkeys).where(eq(passkeys.userId, u.id)).orderBy(asc(passkeys.createdAt));
    const one = (p: "google" | "apple") => {
      const row = linked.find((x) => x.provider === p);
      return row ? { email: row.email } : null;
    };
    // Nothing to hold while the phone is the only way in.
    const others = (await waysIn(db, u)) > (u.phone ? 1 : 0);
    return c.json({
      phone: u.phone,
      email: u.email,
      google: one("google"),
      apple: one("apple"),
      passkeys: keys.map((k) => ({ id: k.id, name: k.name, added: k.createdAt.toISOString(), lastUsed: k.lastUsedAt?.toISOString() ?? null })),
      fresh: fresh(s, now()),
      heldUntil: (others && heldUntil(u, s, now())?.toISOString()) || null,
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

  // POST /me/fresh: any way in this account has makes this device fresh: a code to its own phone or email (sent with
  // POST /auth/code), its Google or Apple, or one of its passkeys. A Google, Apple or passkey on another account, or on
  // none, proves nothing here.
  app.post("/me/fresh", auth, async (c) => {
    const b = await parse(c, FreshCheck);
    if (!b) return invalid(c);
    const u = c.var.user;
    const mark = (via: Way, since: Date | null) =>
      db.update(sessions).set({ freshAt: at(), freshVia: via, freshSince: since }).where(eq(sessions.id, c.var.sid));
    if (b.via === "phone" || b.via === "email") {
      const to = b.via === "phone" ? (u.phone && { kind: "phone" as const, e164: u.phone }) : u.email && { kind: "email" as const, email: u.email };
      if (!to) return fail(c, 400, "invalid", b.via === "email" ? "Your account has no email. Use a code to your number." : "Your account has no number. Use another way in.");
      const r = await checkCode(store, secret, to, b.code, clientIp(c));
      if (!r.ok) return codeError(c, r.error);
      await mark(b.via, null);
      return c.json({ fresh: true });
    }
    if (b.via === "passkey") {
      const key = await w.passkey(db, b, now());
      if (!key || key.userId !== u.id) return fail(c, 400, "notProven", "That passkey isn't on your Orbit account. Try another way.");
      await mark("passkey", key.createdAt);
      return c.json({ fresh: true });
    }
    const id = b.via === "google" ? await w.google(b) : await w.apple(b);
    if (!id) return fail(c, 400, "notProven", `${NAMES[b.via]} couldn't confirm it's you. Try again, or use a code.`);
    const [row] = await db
      .select()
      .from(identities)
      .where(and(eq(identities.userId, u.id), eq(identities.provider, id.provider), eq(identities.subject, id.subject)));
    if (!row) return fail(c, 400, "notProven", `That ${NAMES[b.via]} account isn't on your Orbit account. Try another way.`);
    await mark(b.via, row.createdAt);
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
    if (held) return holdError(c, before, held, "email", "change");
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

  // DELETE /me/email. Never the last way in (an account whose number moved away may have only this).
  app.delete("/me/email", auth, async (c) => {
    const before = c.var.user;
    if (!before.email) return fail(c, 404, "notFound", "Your account has no email.");
    const s = await sessionOf(c.var.sid);
    if (!fresh(s, now())) return needFresh(c);
    const held = heldUntil(before, s, now());
    if (held) return holdError(c, before, held, "email", "remove");
    const gone = await lastWayGuard(before.id, (tx) => tx.update(users).set({ email: null, emailVerifiedAt: null, updatedAt: at() }).where(eq(users.id, before.id)).returning());
    if (gone === "last") return lastWay(c);
    await releaseContact(before.id, before.email);
    await tellOld(before, { method: "email", change: "removed" });
    return c.body(null, 204);
  });

  // The hold after "Is this you?": refused, and the other way in hears that someone tried.
  const holdError = async (c: Context, u: User, until: Date, method: "email" | "passkey" | Provider, change: string) => {
    // At most once an hour, so repeated tries don't flood the inbox.
    const to = await otherAddress(db, u);
    if (to && (await store.incr(`heldNotice:${u.id}`, 60 * MIN)) === 1)
      await notify({ to: { contact: to }, kind: "signInMethodChangeHeld", data: { method, change, until: until.toISOString() } });
    const day = until.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    const what = method === "email" ? `${change} your email` : method === "passkey" ? "remove a passkey" : `remove ${NAMES[method]}`;
    const how = method === "email" && u.email ? "with a code to that email" : "with a way in you had before then";
    return fail(c, 403, "held", `You signed in with your number on a new phone. To ${what} before ${day}, confirm it's you ${how}.`, {
      until: until.toISOString(),
    });
  };

  // Removes a way in only while another stays: the account's row is locked first, so two removals at once can't both
  // see the other and leave none, and a removal that would leave none is undone. `remove` answers the rows it removed;
  // none removed is "notFound", whatever else the account has.
  const lastWayGuard = async (userId: string, remove: (tx: Tx) => Promise<unknown[]>) => {
    try {
      return await db.transaction(async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
        if (!(await remove(tx)).length) return "notFound" as const;
        const [u] = await tx.select().from(users).where(eq(users.id, userId));
        if ((await waysIn(tx, u!)) < 1) throw LAST;
        return "done" as const;
      });
    } catch (e) {
      if (e === LAST) return "last" as const;
      throw e;
    }
  };
  const lastWay = (c: Context) => fail(c, 409, "lastWay", "That's your only way to sign in. Add another before removing it.");

  // Ready for a change: fresh, and not held. Answers the refusal, or null.
  const changeCheck = async (c: Context, u: User, method: "passkey" | Provider) => {
    const s = await sessionOf(c.var.sid);
    if (!fresh(s, now())) return needFresh(c);
    const held = heldUntil(u, s, now());
    return held ? holdError(c, u, held, method, "remove") : null;
  };

  // Passkeys. POST /me/passkeys/options, then POST /me/passkeys: Add a passkey, named after this device. Both steps
  // need the fresh check, so a stolen session can't slip a passkey in.
  app.post("/me/passkeys/options", auth, async (c) => {
    const u = c.var.user;
    if (!fresh(await sessionOf(c.var.sid), now())) return needFresh(c);
    const have = await db.select({ credentialId: passkeys.credentialId, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, u.id));
    if (have.length >= 20) return fail(c, 409, "tooMany", "You have 20 passkeys. Remove one before adding another.");
    return c.json(await w.passkeyCreation(u, have));
  });
  app.post("/me/passkeys", auth, async (c) => {
    const b = await parse(c, AddPasskey);
    if (!b) return invalid(c);
    const u = c.var.user;
    const s = await sessionOf(c.var.sid);
    if (!fresh(s, now())) return needFresh(c);
    const made = await w.passkeyMade(u.id, b);
    if (!made) return fail(c, 400, "notProven", "That passkey couldn't be added. Try again.");
    try {
      const [row] = await db.insert(passkeys).values({ userId: u.id, ...made, name: s.name.slice(0, 50), createdAt: at() }).returning();
      await tellOld(u, { method: "passkey", change: "added", name: row!.name });
      return c.json({ id: row!.id, name: row!.name, added: row!.createdAt.toISOString(), lastUsed: null }, 201);
    } catch (e) {
      if (taken(e)) return fail(c, 409, "passkeyTaken", "That passkey is already on Orbit.");
      throw e;
    }
  });
  // PATCH /me/passkeys/:id: Rename. Only a name, so no fresh check.
  app.patch("/me/passkeys/:id", auth, async (c) => {
    const id = c.req.param("id");
    const b = await parse(c, RenamePasskey);
    if (!b) return invalid(c);
    const [row] = isUuid(id)
      ? await db.update(passkeys).set({ name: b.name }).where(and(eq(passkeys.id, id), eq(passkeys.userId, c.var.user.id))).returning()
      : [];
    return row ? c.json({ id: row.id, name: row.name }) : fail(c, 404, "notFound", "That passkey is already gone.");
  });
  app.delete("/me/passkeys/:id", auth, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "That passkey is already gone.");
    const u = c.var.user;
    const refused = await changeCheck(c, u, "passkey");
    if (refused) return refused;
    const gone = await lastWayGuard(u.id, (tx) => tx.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, u.id))).returning());
    if (gone === "last") return lastWay(c);
    if (gone === "notFound") return fail(c, 404, "notFound", "That passkey is already gone.");
    await tellOld(u, { method: "passkey", change: "removed" });
    return c.body(null, 204);
  });

  // Google and Apple. POST /me/google, POST /me/apple: Link, refused when it signs in to another account (no merging
  // in v1). The app gets the proof as it does to sign in.
  // Fresh first, so a refused link doesn't spend the Google grant or Apple nonce.
  const linkTo = async (c: Context, u: User, prove: () => Promise<Identity | null>, p: Provider) => {
    if (!fresh(await sessionOf(c.var.sid), now())) return needFresh(c);
    const id = await prove();
    if (!id) return fail(c, 400, "notProven", `${NAMES[p]} couldn't confirm it's you. Try again.`);
    const appleRefresh = id.provider === "apple" ? await w.appleRefresh(id.subject) : null;
    try {
      const [row] = await db
        .insert(identities)
        .values({ userId: u.id, provider: id.provider, subject: id.subject, email: id.email, appleRefresh, createdAt: at() })
        .returning();
      await tellOld(u, { method: p, change: "added" });
      return c.json({ email: row!.email }, 201);
    } catch (e) {
      if (!taken(e)) throw e;
      const [mine] = await db.select().from(identities).where(and(eq(identities.userId, u.id), eq(identities.provider, p)));
      if (mine?.subject === id.subject) return c.json({ email: mine.email }); // linked already: a retry
      return mine
        ? fail(c, 409, "linked", `Your account already has ${NAMES[p]}. Remove it first to link another.`)
        : fail(c, 409, `${p}Taken`, `That ${NAMES[p]} account signs in to another Orbit account.`);
    }
  };
  app.post("/me/google", auth, async (c) => {
    const b = await parse(c, GoogleProof);
    if (!b) return invalid(c);
    return linkTo(c, c.var.user, () => w.google(b), "google");
  });
  app.post("/me/apple", auth, async (c) => {
    const b = await parse(c, AppleProof);
    if (!b) return invalid(c);
    return linkTo(c, c.var.user, () => w.apple(b), "apple");
  });
  // DELETE /me/google, DELETE /me/apple. Apple's token is revoked with it.
  app.delete("/me/:provider{google|apple}", auth, async (c) => {
    const p = c.req.param("provider") as Provider;
    const u = c.var.user;
    const refused = await changeCheck(c, u, p);
    if (refused) return refused;
    let removed: (typeof identities.$inferSelect)[] = [];
    const gone = await lastWayGuard(u.id, async (tx) => (removed = await tx.delete(identities).where(and(eq(identities.userId, u.id), eq(identities.provider, p))).returning()));
    if (gone === "last") return lastWay(c);
    if (gone === "notFound") return fail(c, 404, "notFound", `${NAMES[p]} isn't linked.`);
    const token = removed[0]?.appleRefresh;
    if (token) await w.revokeApple(token).catch((e) => console.warn("[apple] revoke", e));
    await tellOld(u, { method: p, change: "removed" });
    return c.body(null, 204);
  });

  // POST /me/ways: "Add Google to your account?", answered yes. The sign-in that offered it proved the Google or Apple
  // and made this device fresh; the offer works once.
  app.post("/me/ways", auth, async (c) => {
    const b = await parse(c, AddWay);
    const t = b && (await read<Identity & { sub: string; jti: string }>(secret, "addWay", b.token));
    if (!t || t.sub !== c.var.user.id) return fail(c, 400, "expired", "That took too long. Link it from Sign-in and security.");
    if (!fresh(await sessionOf(c.var.sid), now())) return needFresh(c);
    if ((await store.incr(`spent:${t.jti}`, TOKEN_MAX_MS)) !== 1) return fail(c, 400, "expired", "That took too long. Link it from Sign-in and security.");
    const id: Identity = { provider: t.provider, subject: t.subject, email: t.email };
    const appleRefresh = id.provider === "apple" ? await w.appleRefresh(id.subject) : null;
    try {
      const [row] = await db.insert(identities).values({ userId: t.sub, ...id, appleRefresh, createdAt: at() }).onConflictDoNothing().returning();
      if (!row) return fail(c, 409, "linked", `That ${NAMES[id.provider]} account is already linked, or your account has one.`);
      await tellOld(c.var.user, { method: id.provider, change: "added" });
      return c.json({ email: row.email }, 201);
    } catch (e) {
      if (taken(e)) return fail(c, 409, "linked", `That ${NAMES[id.provider]} account is already linked.`);
      throw e;
    }
  });

  return app;
}

const codeError = (c: Parameters<typeof fail>[0], error: "tooMany" | "expired" | "wrongCode") =>
  error === "tooMany"
    ? fail(c, 429, "tooMany", "Too many tries. Wait 15 minutes, then send a new code.")
    : error === "expired"
      ? fail(c, 400, "codeExpired", "That code has expired. Send a new one.")
      : fail(c, 400, "wrongCode", "That code isn't right. Check the latest message, or send a new code.");
