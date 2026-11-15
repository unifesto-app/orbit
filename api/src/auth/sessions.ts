import { createHmac, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Device } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { sessions, users } from "../db/schema.ts";
import { ACCESS_SECONDS, issue, randomToken, sha256 } from "./tokens.ts";

// One session per device (plan section 6). Refresh tokens rotate on every use and last 180 days, never past 365 days
// from sign-in. A spent one used again within 60 seconds still works, so tabs refreshing at once sign nobody out;
// later than that, it signs out every session of the account (User flow, Account security).

const DAY = 24 * 3600 * 1000;
const GRACE_MS = 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type User = typeof users.$inferSelect;

export const isSuspended = (u: Pick<User, "suspendedAt" | "suspendedUntil">, now: number) =>
  !!u.suspendedAt && (!u.suspendedUntil || u.suspendedUntil.getTime() > now);

// Whether this account has signed in on this device before, even if it signed out since.
export async function deviceKnown(db: Db, userId: string, deviceId: string | undefined) {
  if (!deviceId) return false;
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.deviceHash, sha256(deviceId))))
    .limit(1);
  return !!row;
}

// Signs the account in on this device, replacing the device's earlier session. The device id is the API's: one the
// device sends is kept only if some account has signed in with it (two accounts can share a phone), otherwise the
// device gets a new one.
export async function startSession(db: Db, secret: string, userId: string, device: Device, now: number, via: "phone" | "email") {
  const issued =
    device.id && (await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.deviceHash, sha256(device.id))).limit(1)).length > 0;
  const deviceId = issued ? device.id! : randomToken();
  const refreshSecret = randomToken();
  const at = new Date(now);
  const fields = {
    id: randomUUID(),
    client: device.client,
    name: device.name,
    refreshHash: sha256(refreshSecret),
    prevRefreshHash: null,
    rotatedAt: at,
    createdAt: at,
    lastActiveAt: at,
    expiresAt: new Date(now + 180 * DAY),
    endedAt: null,
    freshAt: at, // every sign-in here is by a code, so the device starts fresh
    freshVia: via,
  };
  await db
    .insert(sessions)
    .values({ userId, deviceHash: sha256(deviceId), ...fields })
    .onConflictDoUpdate({ target: [sessions.userId, sessions.deviceHash], set: fields });
  return {
    access: await issue(secret, "access", { sub: userId, sid: fields.id }),
    refresh: `${fields.id}.${refreshSecret}`,
    device: deviceId,
    expiresIn: ACCESS_SECONDS,
  };
}

export type Refreshed = { ok: true; access: string; refresh: string } | { ok: false; suspended?: User };

export async function refresh(db: Db, secret: string, token: string, now: number): Promise<Refreshed> {
  const dot = token.indexOf(".");
  const sid = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  if (!UUID.test(sid) || !presented) return { ok: false };
  const h = sha256(presented);
  const at = new Date(now);

  const [found] = await db.select({ s: sessions, user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, sid));
  // Never this session's token: nothing to end, whoever sent it.
  if (!found || (h !== found.s.refreshHash && h !== found.s.prevRefreshHash)) return { ok: false };
  // Before rotating, so a suspended person's token isn't spent and their app can keep showing why.
  if (isSuspended(found.user, now)) return { ok: false, suspended: found.user };

  // The successor follows from the token presented, so every refresh with one token, at once or within the grace,
  // gets the same new token and nothing forks.
  const next = createHmac("sha256", secret).update(`refresh:${sid}.${presented}`).digest("base64url");
  const ok = async (): Promise<Refreshed> => ({ ok: true, access: await issue(secret, "access", { sub: found.user.id, sid }), refresh: `${sid}.${next}` });

  let s: typeof found.s | undefined = found.s;
  if (h === s.refreshHash) {
    const [rotated] = await db
      .update(sessions)
      .set({
        prevRefreshHash: h,
        refreshHash: sha256(next),
        rotatedAt: at,
        lastActiveAt: at,
        expiresAt: sql`least(${new Date(now + 180 * DAY).toISOString()}::timestamptz, ${sessions.createdAt} + interval '365 days')`,
      })
      .where(and(eq(sessions.id, sid), eq(sessions.refreshHash, h), isNull(sessions.endedAt), gt(sessions.expiresAt, at)))
      .returning();
    if (rotated) return ok();
    // Another refresh with this token got there first, or the session just ended.
    [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
  }
  if (!s || s.endedAt || s.expiresAt <= at || s.prevRefreshHash !== h) return { ok: false };
  if (s.rotatedAt.getTime() > now - GRACE_MS) return ok();
  // The token before the live one, used late: someone else may hold its successor.
  await endSessions(db, s.userId, now);
  return { ok: false };
}

export const endSession = (db: Db, sid: string, now: number) =>
  db.update(sessions).set({ endedAt: new Date(now) }).where(and(eq(sessions.id, sid), isNull(sessions.endedAt)));

export const endSessions = (db: Db, userId: string, now: number) =>
  db.update(sessions).set({ endedAt: new Date(now) }).where(and(eq(sessions.userId, userId), isNull(sessions.endedAt)));

// The person behind an access token, and whether its session is still live. Read on every request, so a sign-out or
// suspension takes effect at once rather than when the 15-minute token runs out.
export async function sessionUser(db: Db, sid: string, userId: string, now: number) {
  const [row] = await db
    .select({ user: users, live: sessions.id })
    .from(users)
    .leftJoin(sessions, and(eq(sessions.id, sid), eq(sessions.userId, users.id), isNull(sessions.endedAt), gt(sessions.expiresAt, new Date(now))))
    .where(eq(users.id, userId));
  return row ? { user: row.user, live: !!row.live } : null;
}
