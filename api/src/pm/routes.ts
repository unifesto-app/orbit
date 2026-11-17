import { AddNote, CreatePmToken, GetTask, SaveTask, UpsertTrack } from "@orbit/contract";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import type { Store } from "../auth/store.ts";
import type { Db } from "../db/index.ts";
import { clientIp, fail, isUuid, signedIn } from "../http.ts";
import { requireFeature, type StaffEnv } from "../roles/access.ts";
import { activity, addNote, board, createToken, getTask, listTokens, PmError, type PmActor, resolveToken, revokeToken, upsertTask, upsertTrack } from "./board.ts";
import { handle, type Rpc } from "./mcp.ts";

// The PM board's routes (owner, 17 Nov 2026): Galaxy's /galaxy/pm/*, for holders of Platform, and Claude Code's MCP
// endpoint /pm/mcp, signed in by a token the platform owner makes in Galaxy (never a session token).

type Deps = { db: Db; store: Store; secret: string; now?: () => number };
type McpEnv = { Variables: { token: { id: string; name: string; userId: string } } };

// "Galaxy: <name>", fixed part first and control characters gone, so a profile name can't pass for "Claude (laptop)"
// or start a new line in what Claude Code reads.
const staffLabel = (name: string | null) => `Galaxy: ${(name ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Staff"}`;

const BODY_MAX = 256 * 1024;
const BAD_MAX = 20; // failed sign-ins from one address in 10 minutes before it's turned away
const CALLS_MAX = 120; // calls a minute on one token: room for a busy session, a stop for a runaway loop
const BATCH_MAX = 20;

export function pmRoutes({ db, store, secret, now = Date.now }: Deps) {
  const app = new Hono<StaffEnv>();
  const auth = signedIn(db, secret, now);
  const platform = requireFeature(db, now, "platform");
  const sized = bodyLimit({ maxSize: BODY_MAX, onError: (c) => fail(c, 413, "tooLarge", "That's too much at once.") });
  // Tokens are the platform owner's alone; to anyone else these routes don't exist.
  const owner = createMiddleware<StaffEnv>(async (c, next) => (c.var.actor.owner ? next() : fail(c, 404, "notFound", "There's nothing here.")));
  const staff = (c: Context<StaffEnv>): PmActor => ({ label: staffLabel(c.var.user.name), userId: c.var.user.id });

  // The body as the schema reads it, or the first thing wrong with it, in words staff can act on.
  const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | Response> => {
    const r = schema.safeParse(await c.req.json().catch(() => null));
    if (r.success) return r.data;
    const i = r.error.issues[0]!;
    return fail(c, 400, "invalid", `${i.path.join(".") || "That"}: ${i.message}`);
  };
  const refused = (c: Context, e: unknown) => {
    if (e instanceof PmError) return fail(c, e.status, e.status === 409 ? "changed" : e.status === 404 ? "notFound" : "invalid", e.message);
    throw e;
  };

  // ---------- Galaxy ----------
  app.get("/galaxy/pm/board", auth, platform, async (c) => c.json(await board(db)));
  app.get("/galaxy/pm/activity", auth, platform, async (c) => c.json(await activity(db, 200)));
  app.get("/galaxy/pm/tasks/:key", auth, platform, async (c) => {
    const key = GetTask.safeParse({ key: c.req.param("key") });
    if (!key.success) return fail(c, 404, "notFound", "No such task.");
    try {
      return c.json(await getTask(db, key.data.key));
    } catch (e) {
      return refused(c, e);
    }
  });
  app.put("/galaxy/pm/tracks", sized, auth, platform, async (c) => {
    const b = await body(c, UpsertTrack);
    if (b instanceof Response) return b;
    return c.json(await upsertTrack(db, b, staff(c), now()));
  });
  app.put("/galaxy/pm/tasks", sized, auth, platform, async (c) => {
    const b = await body(c, SaveTask);
    if (b instanceof Response) return b;
    try {
      return c.json(await upsertTask(db, b, staff(c), now()));
    } catch (e) {
      return refused(c, e);
    }
  });
  app.post("/galaxy/pm/notes", sized, auth, platform, async (c) => {
    const b = await body(c, AddNote);
    if (b instanceof Response) return b;
    try {
      return c.json(await addNote(db, staff(c), b.message, b.key, now()), 201);
    } catch (e) {
      return refused(c, e);
    }
  });

  app.get("/galaxy/pm/tokens", auth, platform, owner, async (c) => c.json(await listTokens(db, now())));
  // The token is in this answer only; it's never stored, logged or shown again.
  app.post("/galaxy/pm/tokens", sized, auth, platform, owner, async (c) => {
    const b = await body(c, CreatePmToken);
    if (b instanceof Response) return b;
    try {
      return c.json(await createToken(db, c.var.user.id, b.name, now()), 201);
    } catch (e) {
      return refused(c, e);
    }
  });
  app.delete("/galaxy/pm/tokens/:id", auth, platform, owner, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return fail(c, 404, "notFound", "No such token, or it's already revoked.");
    try {
      await revokeToken(db, c.var.user.id, id, now());
      return c.body(null, 204);
    } catch (e) {
      return refused(c, e);
    }
  });

  // ---------- Claude Code: POST /pm/mcp ----------
  const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", id: null, error: { code, message } });
  const mcp = new Hono<McpEnv>();
  // Signed in before any of the body is read, so a stranger can't make the server buffer one. Only an opm_ token's
  // shape gets a lookup, so a session token never works here.
  const gate = createMiddleware<McpEnv>(async (c, next) => {
    if (c.req.method !== "POST") return c.body(null, 405, { Allow: "POST" });
    // Claude Code sends no Origin; a browser always does. No CORS either, so no web page can reach this.
    if (c.req.header("origin")) return fail(c, 403, "forbidden", "Not from a browser.");
    const raw = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "")?.[1];
    const token = raw ? await resolveToken(db, raw, now()) : null;
    if (!token) {
      // Only failures are counted and turned away; a good token from the same address still works (the 256-bit token,
      // not this count, is what stops guessing).
      const ip = clientIp(c);
      if (Number(await store.get(`pm:bad:${ip}`)) >= BAD_MAX) return fail(c, 429, "tooMany", "Too many tries. Wait 10 minutes.");
      await store.incr(`pm:bad:${ip}`, 10 * 60_000);
      c.header("WWW-Authenticate", 'Bearer realm="orbit-pm"');
      return fail(c, 401, "unauthorized", "A Claude Code token from Galaxy's PM board, Connect Claude, is needed.");
    }
    if ((await store.incr(`pm:use:${token.id}`, 60_000)) > CALLS_MAX) {
      c.header("Retry-After", "60");
      return fail(c, 429, "tooMany", "Too many calls on this token. Wait a minute.");
    }
    c.set("token", token);
    await next();
  });

  mcp.all("/pm/mcp", gate, sized, async (c) => {
    const token = c.var.token;
    let msg: unknown;
    try {
      msg = JSON.parse(await c.req.text());
    } catch {
      return c.json(rpcError(-32700, "Parse error"));
    }
    const actor: PmActor = { label: `Claude (${token.name})`, userId: token.userId, tokenId: token.id };
    const one = (m: unknown) => (m && typeof m === "object" && !Array.isArray(m) ? handle(db, m as Rpc, actor, now()) : Promise.resolve(rpcError(-32600, "Invalid Request")));

    if (Array.isArray(msg)) {
      if (!msg.length || msg.length > BATCH_MAX) return c.json(rpcError(-32600, `A batch holds 1 to ${BATCH_MAX} messages.`));
      // Each message counts toward the token's calls a minute, not the batch as one (the gate counted one already).
      if ((await store.incr(`pm:use:${token.id}`, 60_000, msg.length - 1)) > CALLS_MAX) {
        c.header("Retry-After", "60");
        return fail(c, 429, "tooMany", "Too many calls on this token. Wait a minute.");
      }
      const out: object[] = [];
      for (const m of msg) {
        const r = await one(m); // one at a time: a batch can't fan out into parallel writes
        if (r) out.push(r);
      }
      return out.length ? c.json(out) : c.body(null, 202);
    }
    const r = await one(msg);
    return r ? c.json(r) : c.body(null, 202);
  });
  app.route("/", mcp);

  return app;
}
