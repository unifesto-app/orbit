import { and, arrayContains, asc, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { cleanLabels, type PmActivity, type PmBoard, type PmStatus, type PmTask, type PmTaskRow, type PmToken, type SaveTask, type UpsertTrack } from "@orbit/contract";
import { isSuspended } from "../auth/sessions.ts";
import { randomToken, sha256 } from "../auth/tokens.ts";
import type { Db } from "../db/index.ts";
import { auditLog, pmActivity, pmTasks, pmTokens, pmTracks, users } from "../db/schema.ts";
import { taken } from "../http.ts";

// The PM board, shared by Galaxy's routes and the MCP endpoint (routes.ts, mcp.ts), so both write the same rows and
// every change carries who made it. Ported from Unifesto's board (backend/src/pm), with its races and leaks fixed.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
// `label` is what the board shows; the ids say who it really was, whatever a token or a person is called.
export type PmActor = { label: string; userId: string; tokenId?: string };

// A refusal the caller shows as it is: an MCP tool error, or Galaxy's message. Anything else stays in the server log.
export class PmError extends Error {
  readonly status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.status = status;
  }
}

// A task without its notes: the board and list_tasks (Unifesto's list with notes ran to 90k characters).
const rowCols = {
  id: pmTasks.id,
  key: pmTasks.key,
  trackKey: pmTasks.trackKey,
  title: pmTasks.title,
  status: pmTasks.status,
  owner: pmTasks.owner,
  dueDate: pmTasks.dueDate,
  labels: pmTasks.labels,
  sortOrder: pmTasks.sortOrder,
  updatedAt: pmTasks.updatedAt,
};
type Row = { key: string; trackKey: string; title: string; status: PmStatus; owner: string | null; dueDate: string | null; labels: string[]; sortOrder: number; updatedAt: Date };
const row = (t: Row): PmTaskRow => ({
  key: t.key,
  track: t.trackKey,
  title: t.title,
  status: t.status,
  owner: t.owner,
  dueDate: t.dueDate,
  labels: t.labels,
  sortOrder: t.sortOrder,
  updatedAt: t.updatedAt.toISOString(),
});
const order = [asc(pmTasks.trackKey), asc(pmTasks.sortOrder), asc(pmTasks.key)];

// ponytail: the whole board in one answer, capped; tasks are never deleted, so leave out long-closed ones when it nears.
const BOARD_MAX = 3000;
export async function board(db: Db): Promise<PmBoard> {
  const tracks = await db.select({ key: pmTracks.key, name: pmTracks.name, sortOrder: pmTracks.sortOrder }).from(pmTracks).orderBy(asc(pmTracks.sortOrder), asc(pmTracks.key));
  const tasks = await db.select(rowCols).from(pmTasks).orderBy(...order).limit(BOARD_MAX);
  return { tracks, tasks: tasks.map(row) };
}

const LIST_MAX = 200;
export async function listTasks(db: Db, f: { track?: string; statuses?: PmStatus[]; label?: string }) {
  const where = and(
    f.track ? eq(pmTasks.trackKey, f.track) : undefined,
    f.statuses?.length ? inArray(pmTasks.status, f.statuses) : undefined,
    f.label ? arrayContains(pmTasks.labels, [f.label.trim().toLowerCase()]) : undefined,
  );
  const rows = await db.select(rowCols).from(pmTasks).where(where).orderBy(...order).limit(LIST_MAX + 1);
  if (rows.length <= LIST_MAX) return { total: rows.length, tasks: rows.map(row) };
  const [n] = await db.select({ n: count() }).from(pmTasks).where(where);
  return { total: n!.n, truncated: true, tasks: rows.slice(0, LIST_MAX).map(row) };
}

const activityCols = { id: pmActivity.id, key: pmTasks.key, actor: pmActivity.actor, message: pmActivity.message, at: pmActivity.createdAt };
const entry = (a: { id: string; key: string | null; actor: string; message: string; at: Date }): PmActivity => ({ ...a, at: a.at.toISOString() });

export async function getTask(db: Db, key: string): Promise<PmTask> {
  const [t] = await db.select().from(pmTasks).where(eq(pmTasks.key, key));
  if (!t) throw new PmError(`No task ${key}.`, 404);
  const log = await db
    .select(activityCols)
    .from(pmActivity)
    .leftJoin(pmTasks, eq(pmTasks.id, pmActivity.taskId))
    .where(eq(pmActivity.taskId, t.id))
    .orderBy(desc(pmActivity.createdAt))
    .limit(20);
  return { ...row(t), notes: t.notes, activity: log.map(entry) };
}

export async function activity(db: Db, limit = 100): Promise<PmActivity[]> {
  const log = await db
    .select(activityCols)
    .from(pmActivity)
    .leftJoin(pmTasks, eq(pmTasks.id, pmActivity.taskId))
    .orderBy(desc(pmActivity.createdAt))
    .limit(Math.min(limit, 200));
  return log.map(entry);
}

const log = (tx: Db | Tx, actor: PmActor, message: string, taskId: string | null, at: Date) =>
  tx.insert(pmActivity).values({ actor: actor.label, userId: actor.userId, tokenId: actor.tokenId, taskId, message, createdAt: at });

export async function upsertTrack(db: Db, t: UpsertTrack, actor: PmActor, now: number) {
  const at = new Date(now);
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(pmTracks).where(eq(pmTracks.key, t.key)).for("update");
    if (cur && cur.name === t.name && (t.sortOrder === undefined || t.sortOrder === cur.sortOrder)) return cur;
    const [saved] = await tx
      .insert(pmTracks)
      .values({ key: t.key, name: t.name, sortOrder: t.sortOrder ?? 0, createdAt: at })
      .onConflictDoUpdate({ target: pmTracks.key, set: { name: t.name, ...(t.sortOrder === undefined ? {} : { sortOrder: t.sortOrder }) } })
      .returning();
    await log(tx, actor, cur ? `Track ${t.key} is now "${t.name}"` : `Created track ${t.key} "${t.name}"`, null, at);
    return saved!;
  });
}

// Create or update by key, in one transaction with its activity row. A new task needs track and title; every real
// change is logged once, and a call that changes nothing writes nothing. `ifUpdatedAt` (Galaxy's dialog) refuses a
// save over a change made since it was read.
export async function upsertTask(db: Db, input: SaveTask, actor: PmActor, now: number): Promise<PmTaskRow> {
  const at = new Date(now);
  const fields = {
    trackKey: input.track,
    title: input.title,
    notes: input.notes === undefined ? undefined : input.notes.trim() ? input.notes : null,
    status: input.status,
    owner: input.owner === undefined ? undefined : input.owner || null,
    dueDate: input.dueDate === undefined ? undefined : input.dueDate || null,
    sortOrder: input.sortOrder,
    labels: input.labels && cleanLabels(input.labels),
  };
  try {
    return await db.transaction(async (tx) => {
      if (fields.trackKey && !(await tx.select({ key: pmTracks.key }).from(pmTracks).where(eq(pmTracks.key, fields.trackKey))).length) {
        throw new PmError(`No track ${fields.trackKey}. Create it with upsert_track first.`, 404);
      }
      const [cur] = await tx.select().from(pmTasks).where(eq(pmTasks.key, input.key)).for("update");
      if (!cur) {
        if (!fields.trackKey || !fields.title) throw new PmError(`No task ${input.key}. Give track and title to create it.`, 404);
        const [t] = await tx
          .insert(pmTasks)
          .values({ ...fields, key: input.key, trackKey: fields.trackKey, title: fields.title, labels: fields.labels ?? [], createdAt: at, updatedAt: at })
          .returning();
        await log(tx, actor, `Created ${t!.key} (${t!.status})`, t!.id, at);
        return row(t!);
      }
      if (input.ifUpdatedAt && cur.updatedAt.getTime() !== Date.parse(input.ifUpdatedAt)) {
        throw new PmError(`${cur.key} changed since you opened it. Open it again to see what changed.`, 409);
      }
      const changes: string[] = [];
      if (fields.status !== undefined && fields.status !== cur.status) changes.push(`${cur.status} → ${fields.status}`);
      if (fields.trackKey !== undefined && fields.trackKey !== cur.trackKey) changes.push(`track ${cur.trackKey} → ${fields.trackKey}`);
      for (const f of ["title", "notes", "owner"] as const) if (fields[f] !== undefined && fields[f] !== cur[f]) changes.push(`${f} edited`);
      if (fields.dueDate !== undefined && fields.dueDate !== cur.dueDate) changes.push(`due ${fields.dueDate ?? "cleared"}`);
      // Item by item: ["a,b"] and ["a", "b"] are different labels.
      if (fields.labels && JSON.stringify(fields.labels) !== JSON.stringify(cur.labels)) changes.push(`labels ${fields.labels.join(", ") || "cleared"}`);
      const moved = fields.sortOrder !== undefined && fields.sortOrder !== cur.sortOrder; // reordering isn't logged
      if (!changes.length && !moved) return row(cur);
      const [t] = await tx
        .update(pmTasks)
        .set({ ...fields, updatedAt: at })
        .where(eq(pmTasks.id, cur.id))
        .returning();
      if (changes.length) await log(tx, actor, `${t!.key}: ${changes.join(", ")}`, t!.id, at);
      return row(t!);
    });
  } catch (e) {
    // Two creates of one new key at once: the second meets the first's row.
    if (taken(e)) throw new PmError(`${input.key} was just created by someone else. Try again.`, 409);
    throw e;
  }
}

export async function addNote(db: Db, actor: PmActor, message: string, key: string | undefined, now: number): Promise<PmActivity> {
  const task = key ? (await db.select({ id: pmTasks.id }).from(pmTasks).where(eq(pmTasks.key, key)))[0] : null;
  if (key && !task) throw new PmError(`No task ${key}.`, 404);
  const at = new Date(now);
  const [a] = await log(db, actor, key ? `${key}: ${message}` : message, task?.id ?? null, at).returning({ id: pmActivity.id });
  return { id: a!.id, key: key ?? null, actor: actor.label, message: key ? `${key}: ${message}` : message, at: at.toISOString() };
}

// ---------- Claude Code tokens ----------

// "opm_" and 32 random bytes; only the SHA-256 is kept, and the token is shown once. The prefix lets secret scanners
// spot one, and lets the endpoint refuse anything else (a session token, a refresh token) without a lookup.
export const TOKEN_SHAPE = /^opm_[A-Za-z0-9_-]{43}$/;
const LIVE_MAX = 10;

const audit = (tx: Tx, actorId: string, action: string, data: Record<string, unknown>, at: Date) =>
  tx.insert(auditLog).values({ actorId, action, data, at });

export async function createToken(db: Db, ownerId: string, name: string, now: number) {
  const at = new Date(now);
  const token = `opm_${randomToken()}`;
  const id = await db.transaction(async (tx) => {
    // One maker at a time, so tokens made at the same moment can't each see room under the cap.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pm_tokens'))`);
    const [live] = await tx.select({ n: count() }).from(pmTokens).where(isNull(pmTokens.revokedAt));
    if (live!.n >= LIVE_MAX) throw new PmError(`There are already ${LIVE_MAX} tokens. Revoke one you no longer use first.`, 409);
    const [t] = await tx.insert(pmTokens).values({ name, tokenHash: sha256(token), userId: ownerId, createdAt: at }).returning({ id: pmTokens.id });
    // The token's id and name only, never the token.
    await audit(tx, ownerId, "pm.token.create", { tokenId: t!.id, name }, at);
    return t!.id;
  });
  return { id, name, token };
}

// Every token ever made, so an owner sees a predecessor's too. Active: not revoked, and its maker is still the owner.
export async function listTokens(db: Db, now: number): Promise<PmToken[]> {
  const rows = await db
    .select({ t: pmTokens, owner: users.platformOwner, deletedAt: users.deletedAt, suspendedAt: users.suspendedAt, suspendedUntil: users.suspendedUntil })
    .from(pmTokens)
    .innerJoin(users, eq(users.id, pmTokens.userId))
    // Unrevoked first, so a token that still works is always listed and can be revoked.
    .orderBy(sql`${pmTokens.revokedAt} is not null`, desc(pmTokens.createdAt))
    .limit(100);
  return rows.map(({ t, ...u }) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    active: !t.revokedAt && u.owner && !u.deletedAt && !isSuspended(u, now),
  }));
}

export async function revokeToken(db: Db, ownerId: string, id: string, now: number) {
  const at = new Date(now);
  const done = await db.transaction(async (tx) => {
    const [t] = await tx
      .update(pmTokens)
      .set({ revokedAt: at, revokedBy: ownerId })
      .where(and(eq(pmTokens.id, id), isNull(pmTokens.revokedAt)))
      .returning({ id: pmTokens.id, name: pmTokens.name });
    if (t) await audit(tx, ownerId, "pm.token.revoke", { tokenId: t.id, name: t.name }, at);
    return t;
  });
  if (!done) throw new PmError("No such token, or it's already revoked.", 404);
}

// The token's id, name and maker, or null. It works only while its maker is the platform owner and not suspended or
// deleted; a token whose maker stopped being owner is revoked when it's next shown, so it can't come back to life if
// ownership returns. (A token never shown in between would: handing ownership over revokes every token, see README.)
export async function resolveToken(db: Db, raw: string, now: number) {
  if (!TOKEN_SHAPE.test(raw)) return null;
  const [found] = await db
    .select({ t: pmTokens, u: users })
    .from(pmTokens)
    .innerJoin(users, eq(users.id, pmTokens.userId))
    .where(eq(pmTokens.tokenHash, sha256(raw)));
  if (!found || found.t.revokedAt) return null;
  const { t, u } = found;
  if (!u.platformOwner || u.deletedAt) {
    const at = new Date(now);
    await db.transaction(async (tx) => {
      const [gone] = await tx
        .update(pmTokens)
        .set({ revokedAt: at })
        .where(and(eq(pmTokens.id, t.id), isNull(pmTokens.revokedAt)))
        .returning({ id: pmTokens.id });
      // Logged under its maker, the account it belonged to, with why.
      if (gone) await audit(tx, u.id, "pm.token.revoke", { tokenId: t.id, name: t.name, why: u.deletedAt ? "makerDeleted" : "makerNotOwner" }, at);
    });
    return null;
  }
  if (isSuspended(u, now)) return null;
  // At most one write every 5 minutes per token, not one per call.
  await db
    .update(pmTokens)
    .set({ lastUsedAt: new Date(now) })
    .where(and(eq(pmTokens.id, t.id), or(isNull(pmTokens.lastUsedAt), lt(pmTokens.lastUsedAt, new Date(now - 5 * 60_000)))));
  return { id: t.id, name: t.name, userId: u.id };
}
