import { isIPv6 } from "node:net";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { CLIENT_HEADER, type Contact, type NoticeKind, readClient, readContact } from "@orbit/contract";
import { markActive } from "./activity.ts";
import type { Db } from "./db/index.ts";
import { ack, isSuspended, sessionUser, type User } from "./auth/sessions.ts";
import { read } from "./auth/tokens.ts";

// What every route file shares: the error shape, body parsing and the signed-in check.

export type Env = { Variables: { user: User; sid: string } };

// Every error: a code the client can branch on and a message that says what to do.
export const fail = (c: Context, status: ContentfulStatusCode, error: string, message: string, extra: object = {}) =>
  c.json({ error, message, ...extra }, status);

export const parse = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | null> => {
  const r = schema.safeParse(await c.req.json().catch(() => null));
  return r.success ? r.data : null;
};

export const invalid = (c: Context) => fail(c, 400, "invalid", "Check what you typed and try again.");

// Ids in paths are checked before they reach a uuid column, which would otherwise throw.
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

// Galaxy's lists, 50 a page: `?page=` from 1, and 1 for anything that isn't a sane page number, so a huge one can't
// overflow the offset. ponytail: offset paging; keyset on (created, id) when a list is long enough for the offset to drag.
export const PAGE_SIZE = 50;
export const listPage = (c: Context) => {
  const raw = c.req.query("page") ?? "";
  const page = /^\d{1,6}$/.test(raw) && Number(raw) > 0 ? Number(raw) : 1;
  return { page, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
};

// One field takes a phone number or an email, as on the sign-in screen.
export const contactOf = (c: Context, text: string): Contact | Response => {
  const to = readContact(text);
  if (to === "abroad") return fail(c, 400, "abroad", "Orbit takes Indian (+91) mobile numbers only. Use an email address instead.");
  return to ?? fail(c, 400, "invalid", "Enter a 10-digit mobile number or an email address.");
};

export const suspended = (c: Context, u: User) => {
  const until = u.suspendedUntil;
  const day = until?.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const why = u.suspensionReason ? `: ${u.suspensionReason}` : ".";
  return fail(c, 403, "suspended", until ? `Your account is suspended until ${day}${why}` : `Your account is closed${why}`, {
    until: until?.toISOString() ?? null,
  });
};

// The signed-in person, read on every request. A suspended one is told so, even once their sessions have ended.
export const signedIn = (db: Db, secret: string, now: () => number) =>
  createMiddleware<Env>(async (c, next) => {
    const h = c.req.header("authorization");
    const claims = h?.startsWith("Bearer ") ? await read<{ sub: string; sid: string; rh?: string }>(secret, "access", h.slice(7)) : null;
    const found = claims && (await sessionUser(db, claims.sid, claims.sub, now()));
    if (found && isSuspended(found.user, now())) return suspended(c, found.user);
    if (!claims || !found?.live || !found.refreshHash) return fail(c, 401, "signedOut", "You're signed out. Sign in again.");
    // An access token from the last refresh: the app has its refresh token, so a late reuse of the one before is theft.
    if (!found.acked && claims.rh && found.refreshHash.startsWith(claims.rh)) await ack(db, claims.sid, found.refreshHash);
    c.set("user", found.user);
    c.set("sid", claims.sid);
    // Counted as active today, once (activity.ts): never waits, never fails the request.
    markActive(db, found.user.id, readClient(c.req.header(CLIENT_HEADER)), now());
    await next();
  });

// Postgres's error code, on the error or (through Drizzle) on its cause.
const pgCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
};
// A unique value someone else got to first.
export const taken = (e: unknown) => pgCode(e) === "23505";
// A row another still points at, or one pointing at a row that's gone (a foreign key).
export const unlinked = (e: unknown) => pgCode(e) === "23503";

// The visitor's address as Caddy sets it: Caddy trusts Cf-Connecting-Ip only from Cloudflare's ranges and always
// overwrites X-Forwarded-For with the result (deploy/Caddyfile, api block). Cf-Connecting-Ip itself is passed
// through untouched, so a request that skips Cloudflare could forge it; it's never read here.
// ponytail: the web's server calls the API for browsers, so it must forward the browser's address before the web
// signs anyone in, or every web user shares one IP's limits.
export function clientIp(c: Context) {
  const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // in tests, which call the app directly
  }
}

// An IPv6 address as its eight groups, so the first four name its /64.
const expand = (ip: string) => {
  const [head, tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  return [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
};
// One address's bucket: one IPv6 network (a /64, what one home or phone gets) counts as one address.
export const bucketOf = (ip: string) => (isIPv6(ip) ? expand(ip).slice(0, 4).join(":") : ip);
export const ipOf = (c: Context) => clientIp(c).replace(/^::ffff:(?=\d+\.)/i, ""); // an IPv4 address as Node may show it

// Messages to people: inbox, email and push, by kind (contract/src/notifications.ts), sent by notifications.ts. `key`
// names the occurrence: the same notice with the same key is written and sent once. `tx`: written with the caller's
// transaction, so a rollback takes the message with it.
export type Notice = { to: { userId: string } | { contact: string }; kind: NoticeKind; data?: Record<string, unknown>; key?: string };
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Notify = (n: Notice, tx?: Tx) => Promise<void>;
