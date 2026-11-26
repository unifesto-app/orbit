import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { createApp } from "./app.ts";
import { memoryStore } from "./auth/store.ts";
import { ASK_PRICES, type AskModel } from "./ask.ts";
import { appContent, askLog, auditLog, staffGrants } from "./db/schema.ts";

// Ask Orbit (X11), with a fake model: what it was sent is kept in `sent`, and `answer` says how it answers.

const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
let answer: () => Promise<Partial<Anthropic.Message>> = async () => reply("Try the open mic.");
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 };
const reply = (text: string, stop_reason: Anthropic.StopReason = "end_turn"): Partial<Anthropic.Message> => ({
  type: "message", role: "assistant", content: [{ type: "text", text, citations: null }], stop_reason, usage: usage as Anthropic.Usage,
});
const fake: AskModel = async (p) => {
  sent.push(p);
  return (await answer()) as Anthropic.Message;
};

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp({ ask: fake })));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(7_000_000 + ++n * 17).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR;
const join = async () => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return s.body as { access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const staff = async () => {
  const u = await join();
  await t.db.insert(staffGrants).values({ userId: u.me.id, feature: "platform", addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return as(u);
};
const q = (text = "What's on tonight?") => ({ messages: [{ from: "you", text }] });
const systemOf = (p: Anthropic.MessageCreateParamsNonStreaming) => p.system as Anthropic.TextBlockParam[];

test("1 off without a model key, and when staff switch it off", async () => {
  const u = await join();
  const bare = createApp({ db: t.db, store: memoryStore(t.now), secret: t.secret, now: t.now, send: async () => {}, notify: t.notify });
  const r = await bare.request("/ask", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${u.access}` }, body: JSON.stringify(q()) });
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as any).error, "askOff");

  const s = await staff();
  assert.equal((await s("PUT", "/galaxy/ask/switch", { on: false })).status, 200);
  const off = await as(u)("POST", "/ask", q());
  assert.equal(off.status, 503);
  assert.deepEqual(off.body, { error: "askOff", message: "Ask Orbit is resting for now." });
  assert.equal((await s("GET", "/galaxy/ask")).body.on, false);
  assert.ok((await t.db.select().from(auditLog)).some((a) => a.action === "ask.switch" && (a.data as any).on === false));
  assert.equal((await s("PUT", "/galaxy/ask/switch", { on: true })).status, 200);
  assert.equal((await as(u)("POST", "/ask", q())).status, 200);
});

test("2 bad bodies are 400 and signed out is 401", async () => {
  const a = as(await join());
  for (const body of [
    {},
    { messages: [] },
    { messages: [{ from: "orbit", text: "Hi" }] },
    { messages: [{ from: "you", text: "x".repeat(1001) }] },
    { messages: [{ from: "you", text: "  " }] },
    { messages: Array.from({ length: 21 }, () => ({ from: "you", text: "Hi" })) },
    { messages: [{ from: "them", text: "Hi" }] },
  ])
    assert.equal((await a("POST", "/ask", body)).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal((await t.call("POST", "/ask", q())).status, 401);
});

test("3 twenty an hour, a hundred a day", async () => {
  const u = await join();
  const a = as(u);
  for (let i = 0; i < 20; i++) assert.equal((await a("POST", "/ask", q())).status, 200);
  const r = await a("POST", "/ask", q());
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "tooMany");
  t.tick(HOUR);
  assert.equal((await a("POST", "/ask", q())).status, 200);
  await t.store.incr(`ask:d:${u.me.id}`, DAY, 100);
  assert.equal((await a("POST", "/ask", q())).status, 429);
});

test("4 a reply is logged with its tokens and cost; Orbit's welcome before the first question is left out", async () => {
  const u = await join();
  sent.length = 0;
  answer = async () => reply("  Try the open mic.  ");
  const r = await as(u)("POST", "/ask", {
    messages: [
      { from: "orbit", text: "Hi! Ask me anything." },
      { from: "you", text: "Comedy?" },
      { from: "orbit", text: "Which day?" },
      { from: "you", text: "Tonight" },
    ],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { reply: "Try the open mic." });
  const p = sent[0]!;
  assert.equal(p.model, "claude-opus-5-5");
  assert.deepEqual(p.output_config, { effort: "low" });
  assert.deepEqual(p.messages, [
    { role: "user", content: "Comedy?" },
    { role: "assistant", content: "Which day?" },
    { role: "user", content: "Tonight" },
  ]);
  const [row] = (await t.db.select().from(askLog)).filter((x) => x.userId === u.me.id);
  assert.equal(row!.question, "Tonight");
  assert.equal(row!.reply, "Try the open mic.");
  assert.equal(row!.status, "ok");
  assert.equal(row!.inputTokens, 1000);
  assert.equal(row!.cacheReadTokens, 3000);
  const P = ASK_PRICES;
  assert.equal(row!.costMicroUsd, 1000 * P.input + 200 * P.output + 3000 * P.cacheRead + 500 * P.cacheWrite); // 4000 + 4000 + 600 + 2500
  assert.equal(row!.costMicroUsd, 11_100);
});

test("5 a refusal gets the fixed line; a model error is 503 askBusy with none of its words", async () => {
  const u = await join();
  answer = async () => reply("", "refusal");
  const r = await as(u)("POST", "/ask", q());
  assert.equal(r.status, 200);
  assert.match(r.body.reply, /^I can't help with that one/);
  answer = async () => {
    throw new Error("secret upstream detail");
  };
  const e = await as(u)("POST", "/ask", q());
  assert.equal(e.status, 503);
  assert.deepEqual(e.body, { error: "askBusy", message: "Orbit can't answer right now. Try again in a minute." });
  const rows = (await t.db.select().from(askLog)).filter((x) => x.userId === u.me.id).map((x) => [x.status, x.costMicroUsd, x.reply]);
  assert.deepEqual(rows.find((x) => x[0] === "error"), ["error", 0, null]);
  assert.ok(rows.some((x) => x[0] === "refused"));
  answer = async () => reply("Try the open mic.");
});

test("6 grounding: staff knowledge and Help answers in the cached block; their booking and public events after it", async () => {
  const s = await staff();
  await t.db.delete(appContent);
  const k = { title: "Refund window", body: "Hosts set a cut-off; after it Orbit decides." };
  assert.equal((await s("PUT", "/galaxy/app-content/knowledge", { value: [k], at: null })).status, 200);
  // Staff's words never reach phones.
  assert.equal("knowledge" in (await t.call("GET", "/public/app-content")).body, false);

  const host = await join();
  const h = (await as(host)("POST", "/hosts", { name: "Laugh Lab", kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
  const e = (await as(host)("POST", `/hosts/${h.id}/events`, { title: "Late Night Laughs" })).body as { id: string; slug: string };
  const iso = (ms: number) => new Date(t.now() + ms).toISOString();
  const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
  const form = new FormData();
  form.set("image", new File([(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer()) as BlobPart], "p.png", { type: "image/png" }));
  assert.equal((await t.app.request(`/events/${e.id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${host.access}` }, body: form })).status, 200);
  assert.equal((await as(host)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(DAY), endsAt: iso(DAY + 2 * HOUR), place })).status, 200);
  const tier = (await as(host)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 })).body.id as string;
  const pub = await as(host)("POST", `/events/${e.id}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));

  const u = await join();
  assert.equal((await as(u)("POST", `/events/${e.id}/book`, { ticketTypeId: tier, quantity: 2 })).status, 201);
  sent.length = 0;
  assert.equal((await as(u)("POST", "/ask", q("When is my show?"))).status, 200);
  const [stable, personal] = systemOf(sent[0]!);
  assert.deepEqual(stable!.cache_control, { type: "ephemeral" });
  assert.match(stable!.text, /## Refund window\nHosts set a cut-off/);
  assert.match(stable!.text, /Q: Where’s my ticket\?/); // the default Help answers
  assert.equal(personal!.cache_control, undefined);
  assert.match(personal!.text, /The person: Riya\./);
  assert.match(personal!.text, new RegExp(`# Their bookings\\n\\n- Late Night Laughs, .*: 2 × General, confirmed \\(/event/${e.slug}\\)`));
  assert.match(personal!.text, new RegExp(`- Late Night Laughs \\(comedy\\) by Laugh Lab, .*Hall, Jubilee Hills, Hyderabad, free: /event/${e.slug}`));
});

test("7 Galaxy's Ask Orbit needs Platform; it shows the switch, key, cost per day and the log, and the read is logged", async () => {
  assert.equal((await t.call("GET", "/galaxy/ask")).status, 401);
  const plain = as(await join());
  assert.equal((await plain("GET", "/galaxy/ask")).status, 404);
  assert.equal((await plain("PUT", "/galaxy/ask/switch", { on: false })).status, 404);
  const s = await staff();
  assert.equal((await s("PUT", "/galaxy/ask/switch", { on: "no" })).status, 400);
  const g = await s("GET", "/galaxy/ask");
  assert.equal(g.status, 200);
  assert.equal(g.body.on, true);
  assert.equal(g.body.keySet, true);
  const all = await t.db.select().from(askLog);
  assert.equal(g.body.days.reduce((x: number, d: { asks: number }) => x + d.asks, 0), all.length);
  assert.ok(Math.abs(g.body.days.reduce((x: number, d: { costUsd: number }) => x + d.costUsd, 0) - all.reduce((x, r) => x + r.costMicroUsd, 0) / 1e6) < 1e-9);
  assert.match(g.body.days[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(g.body.log.length, Math.min(50, all.length));
  const top = g.body.log[0];
  assert.equal(top.who, "Riya Kapoor");
  assert.equal(top.tokens, 4700);
  assert.equal(top.costUsd, 0.0111);
  assert.ok((await t.db.select().from(auditLog)).some((a) => a.action === "ask.read"));
});
