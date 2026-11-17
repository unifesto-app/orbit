import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, isNull } from "drizzle-orm";
import { runDeletions } from "../auth/deletion.ts";
import { testApp } from "../testkit.ts";
import { auditLog, pmActivity, pmTasks, pmTokens, staffGrants, users } from "../db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(3_000_000 + ++n * 11).padStart(9, "0")}`;
const e164 = (p: string) => `+91${p}`;
const MIN = 60_000, DAY = 24 * 3600_000;

const verify = async (to: string) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(e164(to)), device });
};
const join = async (p = phone()) => {
  const v = await verify(p);
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body } as { p: string; access: string; refresh: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const makeOwner = async (u: P) => {
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.platformOwner, true));
  await t.db.update(users).set({ platformOwner: true }).where(eq(users.id, u.me.id));
};
const give = async (u: P, ...features: string[]) => {
  for (const feature of features as any[])
    await t.db.insert(staffGrants).values({ userId: u.me.id, feature, addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
};
const audits = async (action: string) => (await t.db.select().from(auditLog)).filter((a) => a.action === action);

// A fresh platform owner with a fresh token; every older token is revoked first so the 10-token cap never bites.
const setup = async (name = "laptop") => {
  const o = await join();
  await makeOwner(o);
  await t.db.update(pmTokens).set({ revokedAt: new Date(t.now()) }).where(isNull(pmTokens.revokedAt));
  const r = await as(o)("POST", "/galaxy/pm/tokens", { name });
  assert.equal(r.status, 201);
  return { o, token: r.body.token as string, id: r.body.id as string };
};

let ipn = 0;
const raw = (token: string | null, body: string, headers: Record<string, string> = {}, method = "POST") =>
  t.app.request("/pm/mcp", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ipn}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: method === "POST" ? body : undefined,
  });
const rpc = async (token: string, msg: unknown, headers: Record<string, string> = {}) => (await raw(token, JSON.stringify(msg), headers)).json() as Promise<any>;
const tool = async (token: string, name: string, args: unknown) => {
  const r = await rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const text = r.result.content[0].text as string;
  return { isError: !!r.result.isError, text, data: r.result.isError ? null : JSON.parse(text) };
};
const mkTrack = (token: string, key = "T") => tool(token, "upsert_track", { key, name: "Test track" });
const taskId = async (key: string) => (await t.db.select().from(pmTasks).where(eq(pmTasks.key, key)))[0]!.id;
const acts = async (key: string) => (await t.db.select().from(pmActivity).where(eq(pmActivity.taskId, await taskId(key)))).length;
const PING = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });

// ---------- Protocol ----------

test("1 initialize echoes a known version, falls back for an unknown one, names orbit-pm", async () => {
  const { token } = await setup();
  const a = await rpc(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  assert.equal(a.result.protocolVersion, "2025-03-26");
  assert.equal(a.result.serverInfo.name, "orbit-pm");
  const b = await rpc(token, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(b.result.protocolVersion, "2025-06-18");
});

test("2 tools/list names the five tools and upsert_task's properties", async () => {
  const { token } = await setup();
  const r = await rpc(token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = r.result.tools.map((x: any) => x.name);
  assert.deepEqual([...names].sort(), ["add_note", "get_task", "list_tasks", "upsert_task", "upsert_track"]);
  const up = r.result.tools.find((x: any) => x.name === "upsert_task");
  assert.deepEqual(Object.keys(up.inputSchema.properties).sort(), ["dueDate", "key", "labels", "notes", "owner", "sortOrder", "status", "title", "track"]);
});

test("3 a notification returns 202 with an empty body", async () => {
  const { token } = await setup();
  const r = await raw(token, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  assert.equal(r.status, 202);
  assert.equal(await r.text(), "");
});

test("4 ping", async () => {
  const { token } = await setup();
  assert.deepEqual(await rpc(token, { jsonrpc: "2.0", id: 7, method: "ping" }), { jsonrpc: "2.0", id: 7, result: {} });
});

test("5 batches: array back without notifications, 202 if all notifications, 21 is refused", async () => {
  const { token } = await setup();
  const ping = (id: number) => ({ jsonrpc: "2.0", id, method: "ping" });
  const note = { jsonrpc: "2.0", method: "notifications/initialized" };
  const r = await rpc(token, [ping(1), note, ping(2)]);
  assert.ok(Array.isArray(r));
  assert.equal(r.length, 2);
  assert.equal((await raw(token, JSON.stringify([note, note]))).status, 202);
  const big = await rpc(token, Array.from({ length: 21 }, (_, i) => ping(i + 1)));
  assert.equal(big.error.code, -32600);
});

test("6 malformed JSON is -32700; a JSON number is -32600", async () => {
  const { token } = await setup();
  assert.equal(((await (await raw(token, "{nope")).json()) as any).error.code, -32700);
  assert.equal(((await (await raw(token, "5")).json()) as any).error.code, -32600);
});

test("7 GET and DELETE return 405 with Allow: POST", async () => {
  for (const m of ["GET", "DELETE"]) {
    const r = await raw(null, "", {}, m);
    assert.equal(r.status, 405, m);
    assert.equal(r.headers.get("allow"), "POST", m);
  }
});

test("8 a body over 256 KB returns 413", async () => {
  const { token } = await setup();
  const r = await raw(token, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(300 * 1024) }));
  assert.equal(r.status, 413);
});

test("9 a request with an Origin header returns 403", async () => {
  const { token } = await setup();
  assert.equal((await raw(token, PING, { origin: "https://evil.example" })).status, 403);
});

// ---------- Tools ----------

test("10 upsert_task DONE writes activity with the token's name and ids; a bad status is a tool error", async () => {
  const { o, token, id } = await setup("my laptop");
  await mkTrack(token);
  assert.equal((await tool(token, "upsert_task", { key: "A10", track: "T", title: "Ten" })).isError, false);
  assert.equal((await tool(token, "upsert_task", { key: "A10", status: "DONE" })).isError, false);
  const rows = await t.db.select().from(pmActivity).where(eq(pmActivity.taskId, await taskId("A10")));
  const done = rows.find((r) => r.message.includes("DONE"))!;
  assert.equal(done.actor, "Claude (my laptop)");
  assert.equal(done.tokenId, id);
  assert.equal(done.userId, o.me.id);
  assert.equal((await tool(token, "upsert_task", { key: "A10", status: "FINISHED" })).isError, true);
});

test("11 get_task on a missing key is a tool error; resources/list is -32601", async () => {
  const { token } = await setup();
  const g = await tool(token, "get_task", { key: "X1" });
  assert.equal(g.isError, true);
  assert.match(g.text, /No task X1/);
  assert.equal((await rpc(token, { jsonrpc: "2.0", id: 1, method: "resources/list" })).error.code, -32601);
});

test("12 labels are trimmed, lowercased and de-duplicated", async () => {
  const { token } = await setup();
  await mkTrack(token);
  await tool(token, "upsert_task", { key: "A12", track: "T", title: "Twelve", labels: [" Mobile ", "MOBILE", "web ", " "] });
  assert.deepEqual((await tool(token, "get_task", { key: "A12" })).data.labels, ["mobile", "web"]);
});

test("13 creating without track or title, with an unknown track, or a 501-char title is a tool error", async () => {
  const { token } = await setup();
  await mkTrack(token);
  assert.equal((await tool(token, "upsert_task", { key: "A13", title: "No track" })).isError, true);
  assert.equal((await tool(token, "upsert_task", { key: "A13", track: "T" })).isError, true);
  assert.equal((await tool(token, "upsert_task", { key: "A13", track: "NOPE", title: "x" })).isError, true);
  assert.equal((await tool(token, "upsert_task", { key: "A13", track: "T", title: "x".repeat(501) })).isError, true);
});

test("14 dueDate empty clears the date; a no-change upsert writes no activity", async () => {
  const { token } = await setup();
  await mkTrack(token);
  await tool(token, "upsert_task", { key: "A14", track: "T", title: "Fourteen", dueDate: "2026-11-17" });
  assert.equal((await tool(token, "get_task", { key: "A14" })).data.dueDate, "2026-11-17");
  await tool(token, "upsert_task", { key: "A14", dueDate: "" });
  assert.equal((await tool(token, "get_task", { key: "A14" })).data.dueDate, null);
  const before = await acts("A14");
  await tool(token, "upsert_task", { key: "A14", title: "Fourteen", dueDate: "" });
  assert.equal(await acts("A14"), before);
});

test("15 list_tasks rows have no notes; get_task has notes and at most 20 activity entries", async () => {
  const { token } = await setup();
  await mkTrack(token);
  await tool(token, "upsert_task", { key: "A15", track: "T", title: "Fifteen", notes: "some notes" });
  for (let i = 0; i < 25; i++) await tool(token, "upsert_task", { key: "A15", status: i % 2 ? "NEXT" : "DONE" });
  const l = await tool(token, "list_tasks", { track: "T" });
  assert.ok(l.data.tasks.length >= 1);
  for (const r of l.data.tasks) assert.ok(!("notes" in r));
  const g = await tool(token, "get_task", { key: "A15" });
  assert.equal(g.data.notes, "some notes");
  assert.equal(g.data.activity.length, 20);
});

// ---------- Auth isolation ----------

test("16 no header, Bearer x, a session token and a refresh token are 401 with WWW-Authenticate", async () => {
  const { o } = await setup();
  for (const tok of [null, "x", o.access, o.refresh]) {
    const r = await raw(tok, PING);
    assert.equal(r.status, 401, String(tok));
    assert.ok(r.headers.get("www-authenticate"), String(tok));
  }
});

test("17 an opm_ token on /me, the board and the token list is 401", async () => {
  const { token } = await setup();
  for (const p of ["/me", "/galaxy/pm/board", "/galaxy/pm/tokens"]) assert.equal((await t.call("GET", p, undefined, token)).status, 401, p);
});

test("18 20 failed tries from one address get 429, but a valid token from it still works", async () => {
  const { token } = await setup();
  const ip = { "x-forwarded-for": "192.0.2.99" };
  for (let i = 0; i < 20; i++) assert.equal((await raw("x", PING, ip)).status, 401);
  assert.equal((await raw("x", PING, ip)).status, 429);
  assert.equal((await raw(token, PING, ip)).status, 200);
  t.tick(10 * MIN + 1000);
  assert.equal((await raw("x", PING, ip)).status, 401);
});

// ---------- Tokens ----------

test("19 a platform holder who isn't owner can't touch tokens; no feature means no PM routes", async () => {
  const { id } = await setup();
  const h = await join();
  await give(h, "platform");
  assert.equal((await as(h)("GET", "/galaxy/pm/tokens")).status, 404);
  assert.equal((await as(h)("POST", "/galaxy/pm/tokens", { name: "x" })).status, 404);
  assert.equal((await as(h)("DELETE", `/galaxy/pm/tokens/${id}`)).status, 404);
  assert.equal((await as(h)("GET", "/galaxy/pm/board")).status, 200);
  const x = await join();
  const routes: [string, string, unknown?][] = [
    ["GET", "/galaxy/pm/board"],
    ["GET", "/galaxy/pm/activity"],
    ["GET", "/galaxy/pm/tasks/P1"],
    ["PUT", "/galaxy/pm/tracks", { key: "Z", name: "Z" }],
    ["PUT", "/galaxy/pm/tasks", { key: "Z1", track: "Z", title: "z" }],
    ["POST", "/galaxy/pm/notes", { message: "hi" }],
    ["GET", "/galaxy/pm/tokens"],
    ["POST", "/galaxy/pm/tokens", { name: "x" }],
    ["DELETE", `/galaxy/pm/tokens/${id}`],
  ];
  for (const [m, p, b] of routes) assert.equal((await as(x)(m, p, b)).status, 404, `${m} ${p}`);
});

test("20 a new token is shown once; only its 64-char hash is stored, listed or audited", async () => {
  const { o, token, id } = await setup();
  assert.match(token, /^opm_/);
  const [row] = await t.db.select().from(pmTokens).where(eq(pmTokens.id, id));
  assert.equal(row!.tokenHash.length, 64);
  assert.notEqual(row!.tokenHash, token);
  assert.ok(!JSON.stringify(row).includes(token));
  const list = await as(o)("GET", "/galaxy/pm/tokens");
  assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.body).includes(token));
  const a = (await audits("pm.token.create")).find((x) => (x.data as any).tokenId === id)!;
  assert.ok(a);
  assert.ok(!JSON.stringify(a).includes(token));
});

test("21 a revoked token is 401, audited once, and a second revoke is 404", async () => {
  const { o, token, id } = await setup();
  assert.equal((await as(o)("DELETE", `/galaxy/pm/tokens/${id}`)).status, 204);
  assert.equal((await raw(token, PING)).status, 401);
  assert.ok((await audits("pm.token.revoke")).some((x) => (x.data as any).tokenId === id));
  assert.equal((await as(o)("DELETE", `/galaxy/pm/tokens/${id}`)).status, 404);
});

test("22 a token dies when its maker stops being owner, and stays dead if ownership returns", async () => {
  const { o, token } = await setup();
  assert.equal((await raw(token, PING)).status, 200);
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.id, o.me.id));
  assert.equal((await raw(token, PING)).status, 401);
  await t.db.update(users).set({ platformOwner: true }).where(eq(users.id, o.me.id));
  assert.equal((await raw(token, PING)).status, 401);
});

test("23 a token whose maker is deleted is 401", async () => {
  const { o, token } = await setup();
  await t.db.update(users).set({ deletedAt: new Date(t.now()) }).where(eq(users.id, o.me.id));
  assert.equal((await raw(token, PING)).status, 401);
});

test("24 last_used_at is set on first use, steady within 5 minutes, updated after 6", async () => {
  const { token, id } = await setup();
  const used = async () => (await t.db.select().from(pmTokens).where(eq(pmTokens.id, id)))[0]!.lastUsedAt;
  assert.equal(await used(), null);
  await raw(token, PING);
  const first = (await used())!;
  assert.ok(first);
  t.tick(1 * MIN);
  await raw(token, PING);
  assert.equal((await used())!.getTime(), first.getTime());
  t.tick(6 * MIN);
  await raw(token, PING);
  assert.ok((await used())!.getTime() > first.getTime());
});

// ---------- Galaxy routes ----------

test("25 a platform holder reads the board and writes tracks, tasks and notes as 'Galaxy: <name>'", async () => {
  const h = await join();
  await give(h, "platform");
  const g = as(h);
  assert.equal((await g("GET", "/galaxy/pm/board")).status, 200);
  assert.equal((await g("PUT", "/galaxy/pm/tracks", { key: "G", name: "Galaxy track" })).status, 200);
  assert.equal((await g("PUT", "/galaxy/pm/tasks", { key: "G25", track: "G", title: "Twenty five" })).status, 200);
  assert.equal((await g("POST", "/galaxy/pm/notes", { message: "hello", key: "G25" })).status, 201);
  const board = (await g("GET", "/galaxy/pm/board")).body;
  assert.ok(board.tracks.some((x: any) => x.key === "G"));
  assert.ok(board.tasks.some((x: any) => x.key === "G25"));
  const rows = await t.db.select().from(pmActivity).where(eq(pmActivity.taskId, await taskId("G25")));
  assert.ok(rows.length >= 2);
  for (const r of rows) assert.equal(r.actor, "Galaxy: Riya Kapoor");
});

test("26 a stale ifUpdatedAt is 409", async () => {
  const h = await join();
  await give(h, "platform");
  const g = as(h);
  await g("PUT", "/galaxy/pm/tracks", { key: "G", name: "Galaxy track" });
  const made = await g("PUT", "/galaxy/pm/tasks", { key: "G26", track: "G", title: "Old" });
  t.tick(1000);
  assert.equal((await g("PUT", "/galaxy/pm/tasks", { key: "G26", title: "Newer" })).status, 200);
  const stale = await g("PUT", "/galaxy/pm/tasks", { key: "G26", title: "Stale", ifUpdatedAt: made.body.updatedAt });
  assert.equal(stale.status, 409);
});

test("27 a Galaxy write and an MCP write to one key leave one task", async () => {
  const { token } = await setup();
  const h = await join();
  await give(h, "platform");
  await as(h)("PUT", "/galaxy/pm/tracks", { key: "G", name: "Galaxy track" });
  assert.equal((await as(h)("PUT", "/galaxy/pm/tasks", { key: "G27", track: "G", title: "From Galaxy" })).status, 200);
  assert.equal((await tool(token, "upsert_task", { key: "G27", title: "From Claude" })).isError, false);
  const rows = await t.db.select().from(pmTasks).where(eq(pmTasks.key, "G27"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, "From Claude");
});

// ---------- Audit follow-ups ----------

const galaxyTrack = async (g: ReturnType<typeof as>) => g("PUT", "/galaxy/pm/tracks", { key: "G", name: "Galaxy track" });

test("28 staff actor strips control characters and collapses whitespace", async () => {
  const h = await join();
  await give(h, "platform");
  await t.db.update(users).set({ name: "Ann\n\u0007  Lee\t X" }).where(eq(users.id, h.me.id));
  const g = as(h);
  await galaxyTrack(g);
  await g("PUT", "/galaxy/pm/tasks", { key: "G28", track: "G", title: "Twenty eight" });
  const rows = await t.db.select().from(pmActivity).where(eq(pmActivity.taskId, await taskId("G28")));
  assert.ok(rows.length);
  for (const r of rows) assert.equal(r.actor, "Galaxy: Ann Lee X");
});

test("29 /pm/mcp 121st call on one token in a minute is 429", async () => {
  const { token } = await setup();
  for (let i = 0; i < 120; i++) assert.equal((await raw(token, PING)).status, 200, String(i));
  assert.equal((await raw(token, PING)).status, 429);
});

test("30 /pm/mcp a batch counts each message toward the 120 a minute", async () => {
  const { token } = await setup();
  const batch = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ jsonrpc: "2.0", id: i + 1, method: "ping" })));
  for (let i = 0; i < 6; i++) assert.equal((await raw(token, batch)).status, 200, String(i));
  assert.equal((await raw(token, PING)).status, 429);
});

test("31 /pm/mcp over 256 KB with no token is 401, with a token 413", async () => {
  const { token } = await setup();
  const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(300 * 1024) });
  assert.equal((await raw(null, big)).status, 401);
  assert.equal((await raw(token, big)).status, 413);
});

test("32 /pm/mcp tool names are own keys only: __proto__ and toString are Unknown tool", async () => {
  const { token } = await setup();
  for (const name of ["__proto__", "toString"]) {
    const r = await tool(token, name, {});
    assert.equal(r.isError, true, name);
    assert.match(r.text, /Unknown tool/, name);
  }
});

test("33 /pm/mcp a non-string method or an object id is -32600, not a 500", async () => {
  const { token } = await setup();
  const a = await raw(token, JSON.stringify({ jsonrpc: "2.0", id: 1, method: 5 }));
  assert.equal(a.status, 200);
  assert.equal(((await a.json()) as any).error.code, -32600);
  const b = await raw(token, JSON.stringify({ jsonrpc: "2.0", id: { x: 1 }, method: "ping" }));
  assert.equal(b.status, 200);
  assert.equal(((await b.json()) as any).error.code, -32600);
});

test("34 a NUL title via MCP is a tool error with no database text; via Galaxy PUT it is 400", async () => {
  const { token } = await setup();
  await mkTrack(token);
  const r = await tool(token, "upsert_task", { key: "A34", track: "T", title: "a\u0000b" });
  assert.equal(r.isError, true);
  assert.doesNotMatch(r.text, /postgres|invalid byte|insert into|pg_|drizzle|syntax/i);
  const h = await join();
  await give(h, "platform");
  await galaxyTrack(as(h));
  assert.equal((await as(h)("PUT", "/galaxy/pm/tasks", { key: "G34", track: "G", title: "a\u0000b" })).status, 400);
});

test("35 15 concurrent POST /galaxy/pm/tokens leave at most 10 live tokens", async () => {
  const { o } = await setup();
  await t.db.update(pmTokens).set({ revokedAt: new Date(t.now()) }).where(isNull(pmTokens.revokedAt));
  const rs = await Promise.all(Array.from({ length: 15 }, (_, i) => as(o)("POST", "/galaxy/pm/tokens", { name: `c${i}` })));
  assert.ok(rs.every((r) => r.status === 201 || r.status === 400 || r.status === 409), rs.map((r) => r.status).join());
  const live = await t.db.select().from(pmTokens).where(isNull(pmTokens.revokedAt));
  assert.ok(live.length <= 10, String(live.length));
  assert.ok(live.length >= 1);
});

test("36 labels compare item by item: [\"a,b\"] over [\"a\",\"b\"] changes them", async () => {
  const { token } = await setup();
  await mkTrack(token);
  await tool(token, "upsert_task", { key: "A36", track: "T", title: "Thirty six", labels: ["a", "b"] });
  await tool(token, "upsert_task", { key: "A36", labels: ["a,b"] });
  assert.deepEqual((await tool(token, "get_task", { key: "A36" })).data.labels, ["a,b"]);
});

test("37 a token auto-revoked because its maker is not owner writes pm.token.revoke why makerNotOwner", async () => {
  const { o, token, id } = await setup();
  await t.db.update(users).set({ platformOwner: false }).where(eq(users.id, o.me.id));
  assert.equal((await raw(token, PING)).status, 401);
  const a = (await audits("pm.token.revoke")).find((x) => (x.data as any).tokenId === id)!;
  assert.ok(a);
  assert.equal((a.data as any).why, "makerNotOwner");
});

test("38 a token auto-revoked because its maker is deleted writes pm.token.revoke why makerDeleted", async () => {
  const { o, token, id } = await setup();
  await t.db.update(users).set({ deletedAt: new Date(t.now()) }).where(eq(users.id, o.me.id));
  assert.equal((await raw(token, PING)).status, 401);
  const a = (await audits("pm.token.revoke")).find((x) => (x.data as any).tokenId === id)!;
  assert.ok(a);
  assert.equal((a.data as any).why, "makerDeleted");
});

test("39 listTokens puts unrevoked tokens first", async () => {
  const { o, id } = await setup("first");
  t.tick(1000);
  const second = await as(o)("POST", "/galaxy/pm/tokens", { name: "second" });
  assert.equal(second.status, 201);
  assert.equal((await as(o)("DELETE", `/galaxy/pm/tokens/${id}`)).status, 204);
  const list = (await as(o)("GET", "/galaxy/pm/tokens")).body as { id: string; revokedAt: string | null }[];
  const firstRevoked = list.findIndex((x) => x.revokedAt);
  assert.ok(firstRevoked > 0);
  assert.ok(list.slice(firstRevoked).every((x) => x.revokedAt));
  assert.ok(list.slice(0, firstRevoked).every((x) => !x.revokedAt));
});

test("40 GET /galaxy/pm/tasks/:key with a key failing the pattern is 404", async () => {
  const h = await join();
  await give(h, "platform");
  for (const k of ["%00", "-x", "a%20b"]) assert.equal((await as(h)("GET", `/galaxy/pm/tasks/${k}`)).status, 404, k);
});

test("41 deleting an account renames its Galaxy-written activity to 'Galaxy: Deleted account'", async () => {
  const h = await join();
  await give(h, "platform");
  const g = as(h);
  await galaxyTrack(g);
  await g("PUT", "/galaxy/pm/tasks", { key: "G41", track: "G", title: "Forty one" });
  const id = await taskId("G41");
  const mine = async () => (await t.db.select().from(pmActivity).where(eq(pmActivity.taskId, id))).filter((r) => r.userId === h.me.id);
  assert.ok((await mine()).length);
  await t.db.update(users).set({ deletionRequestedAt: new Date(t.now()), deletionDueAt: new Date(t.now() - 1000) }).where(eq(users.id, h.me.id));
  assert.ok((await runDeletions(t.db, async () => {}, t.now())) >= 1);
  const rows = await mine();
  assert.ok(rows.length);
  for (const r of rows) assert.equal(r.actor, "Galaxy: Deleted account");
});
