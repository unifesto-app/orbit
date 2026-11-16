import { createHmac, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Device, Way } from "@orbit/contract";
import type { Db } from "../db/index.ts";
import { sessions, users } from "../db/schema.ts";
import { ACCESS_SECONDS, issue, randomToken, sha256 } from "./tokens.ts";

// One session per device (plan section 6). Refresh tokens rotate on every use and last 180 days, never past 365 days
// from sign-in. Each is `sid.r.tag`, and the next one follows from it, so asking twice gets the same new token.
// A spent token used again (User flow, Account security):
// - the one before the live one, within 60 s of the rotation: the same new token, so tabs refreshing at once sign
//   nobody out;
// - the same, later, while no access token from the last answer has been used (`acked`): the same new token again, so
//   an answer lost to a timeout, a dropped connection or a killed app signs nobody out. Once one has been used, the app
//   holds the live token, so whoever sends the one before is someone else: every session of the account ends. A thief
//   who refreshes first is caught when either side next refreshes after using its access token, up to 15 min late;
// - any older one this API made for this session (its tag checks out): every session ends. Keeping only two hashes,
//   a thief who refreshed twice would leave the owner a token matching neither, signing the owner out of one device
//   and keeping the thief in; one more hash only moves that to three refreshes. The cost: a stale copy of any age (a
//   restored backup, a request delivered two rotations late) signs the account out everywhere, not on one device, and
//   the app must save a new refresh token before it uses the access token that came with it.

const DAY = 24 * 3600 * 1000;
const GRACE_MS = 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("base64url");
// The part after the session id. The tag shows this API made it for that session, so a spent token can be told from a
// made-up one without keeping every spent hash.
const tagged = (secret: string, sid: string, r: string) => `${r}.${mac(secret, `refresh-tag:${sid}.${r}`).slice(0, 22)}`;
// The access token names the refresh token it came with (the start of its hash), so using it acks that one only
// (signedIn, http.ts). A timestamp wouldn't do: two rotations can share one.
const access = (secret: string, sub: string, sid: string, refreshHash: string) =>
  issue(secret, "access", { sub, sid, rh: refreshHash.slice(0, 16) });

export type User = typeof users.$inferSelect;
type Session = typeof sessions.$inferSelect;

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
// `since`: when the Google, Apple or passkey it signed in with was added to the account (for the 7-day hold).
export async function startSession(db: Db, secret: string, userId: string, device: Device, now: number, via: Way, since: Date | null = null) {
  const issued =
    device.id && (await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.deviceHash, sha256(device.id))).limit(1)).length > 0;
  const deviceId = issued ? device.id! : randomToken();
  const id = randomUUID();
  const refreshPart = tagged(secret, id, randomToken());
  const at = new Date(now);
  const fields = {
    id,
    client: device.client,
    name: device.name,
    refreshHash: sha256(refreshPart),
    prevRefreshHash: null,
    rotatedAt: at,
    acked: false,
    createdAt: at,
    lastActiveAt: at,
    expiresAt: new Date(now + 180 * DAY),
    endedAt: null,
    freshAt: at, // every sign-in proves a way in, so the device starts fresh
    freshVia: via,
    freshSince: since,
  };
  await db
    .insert(sessions)
    .values({ userId, deviceHash: sha256(deviceId), ...fields })
    .onConflictDoUpdate({ target: [sessions.userId, sessions.deviceHash], set: fields });
  return {
    access: await access(secret, userId, id, fields.refreshHash),
    refresh: `${id}.${refreshPart}`,
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
  const live = (s: Session) => !s.endedAt && s.expiresAt > at;

  const [found] = await db.select({ s: sessions, user: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, sid));
  if (!found) return { ok: false };
  if (h !== found.s.refreshHash && h !== found.s.prevRefreshHash) {
    // Made here for this live session, yet older than the token before the live one: someone else holds its successors.
    // Anything else (made up, or from before tags) ends nothing, whoever sent it. Comparing hashes keeps it timing-safe.
    if (live(found.s) && h === sha256(tagged(secret, sid, presented.split(".")[0]!))) await endSessions(db, found.s.userId, now);
    return { ok: false };
  }
  // Before rotating, so a suspended person's token isn't spent and their app can keep showing why.
  if (isSuspended(found.user, now)) return { ok: false, suspended: found.user };

  // The successor follows from the token presented, so every refresh with one token, at once, within the grace or
  // after a lost answer, gets the same new token and nothing forks.
  const r = mac(secret, `refresh:${sid}.${presented}`);
  const next = tagged(secret, sid, r);
  const ok = async (n: string): Promise<Refreshed> => ({ ok: true, access: await access(secret, found.user.id, sid, sha256(n)), refresh: `${sid}.${n}` });

  let s: Session | undefined = found.s;
  if (h === s.refreshHash) {
    const [rotated] = await db
      .update(sessions)
      .set({
        prevRefreshHash: h,
        refreshHash: sha256(next),
        rotatedAt: at,
        acked: false,
        lastActiveAt: at,
        expiresAt: sql`least(${new Date(now + 180 * DAY).toISOString()}::timestamptz, ${sessions.createdAt} + interval '365 days')`,
      })
      .where(and(eq(sessions.id, sid), eq(sessions.refreshHash, h), isNull(sessions.endedAt), gt(sessions.expiresAt, at)))
      .returning();
    if (rotated) return ok(next);
    // Another refresh with this token got there first, or the session just ended.
    [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
  }
  if (!s || !live(s) || s.prevRefreshHash !== h) return { ok: false };
  // A rotation from before tags stored the bare successor: hand that back, or its next use would look like theft.
  // ponytail: drop the `: r` once sessions rotated before tags (16 Nov 2026) have expired, 180 days on.
  if (s.rotatedAt.getTime() > now - GRACE_MS || !s.acked) return ok(sha256(next) === s.refreshHash ? next : r);
  // The token before the live one, used late after the live one's answer was used: someone else holds a successor.
  await endSessions(db, s.userId, now);
  return { ok: false };
}

// The app got the answer to the last refresh: a request came with the access token from it. One write per rotation;
// matching the hash read keeps a rotation landing in between from being acked by the older token.
export const ack = (db: Db, sid: string, refreshHash: string) =>
  db.update(sessions).set({ acked: true }).where(and(eq(sessions.id, sid), eq(sessions.refreshHash, refreshHash), eq(sessions.acked, false)));

export const endSession = (db: Db, sid: string, now: number) =>
  db.update(sessions).set({ endedAt: new Date(now) }).where(and(eq(sessions.id, sid), isNull(sessions.endedAt)));

export const endSessions = (db: Db, userId: string, now: number) =>
  db.update(sessions).set({ endedAt: new Date(now) }).where(and(eq(sessions.userId, userId), isNull(sessions.endedAt)));

// The person behind an access token, and whether its session is still live. Read on every request, so a sign-out or
// suspension takes effect at once rather than when the 15-minute token runs out.
export async function sessionUser(db: Db, sid: string, userId: string, now: number) {
  const [row] = await db
    .select({ user: users, live: sessions.id, refreshHash: sessions.refreshHash, acked: sessions.acked })
    .from(users)
    .leftJoin(sessions, and(eq(sessions.id, sid), eq(sessions.userId, users.id), isNull(sessions.endedAt), gt(sessions.expiresAt, new Date(now))))
    .where(eq(users.id, userId));
  return row ? { user: row.user, live: !!row.live, refreshHash: row.refreshHash, acked: !!row.acked } : null;
}
