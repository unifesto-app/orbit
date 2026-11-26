import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gt, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AskAdmin, type AskReply, AskRequest, AskSwitch, type AskStatus, readContent } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { appContent, askLog, auditLog, bookings, events, ticketTypes, users } from "./db/schema.ts";
import { cards, listed } from "./events/public.ts";
import { fail, invalid, parse, signedIn } from "./http.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";

// Ask Orbit (X11): the chat's assistant, one reply per POST /ask. No tools: everything it may say is put in front of it
// (staff knowledge, Help answers, the person's bookings, what's coming up), and it's told to say it doesn't know
// rather than guess. Staff switch it off and read every ask with its cost in Galaxy's App content page.

// The model, behind one function so tests use a fake. Built in server.ts only when ANTHROPIC_API_KEY is set.
export type AskModel = (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
export const askModel = (apiKey: string): AskModel => {
  const client = new Anthropic({ apiKey, timeout: 30_000 });
  return (p) => client.messages.create(p);
};

const MODEL = "claude-opus-5-5";
// Claude Opus 5.5 in US dollars per million tokens (claude-api skill, shared/models.md and prompt-caching.md, Nov 2026):
// input 4, output 20, cache read 0.20, 5-minute cache write 1.25 × input. Per token, that's micro-dollars.
export const ASK_PRICES = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const PER_HOUR = 20;
const PER_DAY = 100;
const EVENTS_SHOWN = 40;

const OFF = "Ask Orbit is resting for now.";
const BUSY = "Orbit can't answer right now. Try again in a minute.";
const REFUSED = "I can't help with that one. Ask me about events, hosts, your bookings or Orbit itself.";
const EMPTY = "I couldn't put that together. Try asking another way.";

const RULES = `You are Orbit, the assistant inside the Orbit app. Orbit is a distribution network in India: it brings people to events and places hosted by others (meetups, comedy, music, workshops, run clubs, hackathons, fests, turf and gaming slots and more), and people find, save and book them in the app. Its line: "There's more to life beyond the usual."

Rules:
- Answer only about Orbit: its events, hosts, the person's bookings and tickets, and how the app works. Politely decline anything else.
- Use only what's written below and in the conversation. If it isn't there, say you don't know, and where in the app to look.
- Never invent events, hosts, prices, dates, times, places or policies.
- Keep replies short and plain: a few sentences, or a short list. No markdown tables, no headings.
- When you name an event, give its link as written below (/event/...).
- Never ask for or repeat passwords, codes, card or bank details.`;

const india = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const rupees = (paise: number | null) => (paise === null ? "no tickets listed" : paise === 0 ? "free" : `from ₹${(paise / 100).toLocaleString("en-IN")}`);
const usd = (micro: number) => micro / 1e6;

export function askRoutes({ db, secret, ask, now = Date.now, store }: Deps) {
  const app = new Hono<StaffEnv>();
  const cap = bodyLimit({ maxSize: 32 * 1024, onError: (c) => invalid(c) });
  const switchedOn = async () => {
    const [r] = await db.select({ value: appContent.value }).from(appContent).where(eq(appContent.key, "askOn"));
    return (r?.value as { on?: unknown } | undefined)?.on !== false;
  };

  // What stays the same for everyone between staff saves (cached by the model): who Orbit is, the rules, staff's
  // knowledge and the Help answers.
  const stable = async () => {
    const c = readContent(Object.fromEntries((await db.select().from(appContent)).map((r) => [r.key, r.value])));
    const knowledge = c.knowledge.map((k) => `## ${k.title}\n${k.body}`).join("\n\n");
    const help = c.help.map((h) => `Q: ${h.q}\nA: ${h.a}`).join("\n\n");
    return `${RULES}\n\n# What Orbit's team wrote\n\n${knowledge || "(nothing yet)"}\n\n# Help answers in the app\n\n${help || "(none)"}`;
  };

  // What's this person's and this moment's: today, their first name, their bookings for events not yet over, and the
  // soonest public events. ponytail: events only; Play slot bookings join when someone asks Orbit about them.
  const personal = async (userId: string, name: string | null) => {
    const at = new Date(now());
    const mine = await db
      .select({ title: events.title, slug: events.slug, startsAt: events.startsAt, quantity: bookings.quantity, status: bookings.status, tier: ticketTypes.name })
      .from(bookings)
      .innerJoin(events, eq(events.id, bookings.eventId))
      .innerJoin(ticketTypes, eq(ticketTypes.id, bookings.ticketTypeId))
      .where(and(eq(bookings.userId, userId), gt(events.endsAt, at)))
      .orderBy(asc(events.startsAt));
    const soon = await cards(db, { where: listed(at), order: [asc(events.startsAt), asc(events.id)], limit: EVENTS_SHOWN });
    const booked = mine.map((b) => `- ${b.title}, ${b.startsAt ? india(b.startsAt) : "date to be set"}: ${b.quantity} × ${b.tier}, ${b.status} (/event/${b.slug})`);
    const coming = soon.map((e) => {
      const where = e.place ? [e.place.venue, e.place.area, e.place.city].filter(Boolean).join(", ") : e.online ? "online" : "place to be announced";
      return `- ${e.title} (${e.category}) by ${e.host.name}, ${e.startsAt ? india(new Date(e.startsAt)) : "date to be set"}, ${where}, ${rupees(e.pricePaise)}: /event/${e.slug}`;
    });
    return [
      `Now: ${india(at)}, India time.`,
      `The person: ${name?.split(/\s+/)[0] || "unknown name"}.`,
      `# Their bookings\n\n${booked.join("\n") || "(none coming up)"}`,
      `# Coming up on Orbit (the soonest ${EVENTS_SHOWN} public events)\n\n${coming.join("\n") || "(none listed)"}`,
    ].join("\n\n");
  };

  // POST /ask {messages}: one reply. Off (switched off, or no model key) is 503 askOff; past 20 an hour or 100 a day
  // per person, 429; the model failing, 503 askBusy with none of its error. Every ask is logged.
  app.post("/ask", cap, signedIn(db, secret, now), async (c) => {
    const b = await parse(c, AskRequest);
    if (!b) return invalid(c);
    if (!ask || !(await switchedOn())) return fail(c, 503, "askOff", OFF);
    const u = c.var.user;
    const hour = await store.incr(`ask:h:${u.id}`, HOUR);
    const day = await store.incr(`ask:d:${u.id}`, DAY);
    if (hour > PER_HOUR || day > PER_DAY) return fail(c, 429, "tooMany", "That's a lot of questions. Ask again in a little while.");

    const question = b.messages.at(-1)!.text;
    // The model's turns start with the person's, so a welcome bubble from Orbit before their first goes.
    const first = b.messages.findIndex((m) => m.from === "you");
    const messages = b.messages.slice(first).map((m): Anthropic.MessageParam => ({ role: m.from === "you" ? "user" : "assistant", content: m.text }));
    const log = (v: { reply?: string; status: AskStatus; usage?: Anthropic.Usage }) => {
      const t = { input: v.usage?.input_tokens ?? 0, output: v.usage?.output_tokens ?? 0, read: v.usage?.cache_read_input_tokens ?? 0, write: v.usage?.cache_creation_input_tokens ?? 0 };
      const p = ASK_PRICES;
      return db.insert(askLog).values({
        userId: u.id, at: new Date(now()), question, reply: v.reply ?? null, status: v.status,
        inputTokens: t.input, outputTokens: t.output, cacheReadTokens: t.read, cacheWriteTokens: t.write,
        costMicroUsd: Math.round(t.input * p.input + t.output * p.output + t.read * p.cacheRead + t.write * p.cacheWrite),
      });
    };

    let m: Anthropic.Message;
    try {
      m = await ask({
        model: MODEL,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: [
          { type: "text", text: await stable(), cache_control: { type: "ephemeral" } },
          { type: "text", text: await personal(u.id, u.name) },
        ],
        messages,
      });
    } catch (e) {
      console.error("[ask]", e); // to Sentry; never to the person
      await log({ status: "error" });
      return fail(c, 503, "askBusy", BUSY);
    }
    const refused = m.stop_reason === "refusal";
    const text = m.content.flatMap((x) => (x.type === "text" ? [x.text] : [])).join("").trim();
    const reply = refused ? REFUSED : text || EMPTY;
    await log({ reply, status: refused ? "refused" : "ok", usage: m.usage });
    const body: AskReply = { reply };
    return c.json(body);
  });

  const platform = [signedIn(db, secret, now), requireFeature(db, now, "platform")] as const;

  // GET /galaxy/ask: the switch, whether a model key is set (never the key), cost per India day for 30 days, and the
  // latest 50 asks. Reading people's questions is logged.
  app.get("/galaxy/ask", ...platform, async (c) => {
    const day = sql<string>`to_char(${askLog.at} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
    const days = await db
      .select({ day, asks: sql<number>`count(*)::int`, micro: sql<number>`sum(${askLog.costMicroUsd})::float8` })
      .from(askLog)
      .where(gte(askLog.at, new Date(now() - 30 * DAY)))
      .groupBy(day)
      .orderBy(desc(day));
    const log = await db
      .select({ a: askLog, who: users.name })
      .from(askLog)
      .leftJoin(users, eq(users.id, askLog.userId))
      .orderBy(desc(askLog.at))
      .limit(50);
    await db.insert(auditLog).values({ actorId: c.var.actor.id, action: "ask.read", at: new Date(now()) });
    const body: AskAdmin = {
      on: await switchedOn(),
      keySet: !!ask,
      days: days.map((d) => ({ day: d.day, asks: d.asks, costUsd: usd(d.micro) })),
      log: log.map(({ a, who }) => ({
        at: a.at.toISOString(), who, question: a.question, reply: a.reply, status: a.status,
        tokens: a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheWriteTokens, costUsd: usd(a.costMicroUsd),
      })),
    };
    return c.json(body);
  });

  // PUT /galaxy/ask/switch {on}: Ask Orbit on or off for everyone, at once. Logged.
  app.put("/galaxy/ask/switch", cap, ...platform, async (c) => {
    const b = await parse(c, AskSwitch);
    if (!b) return invalid(c);
    const actorId = c.var.actor.id;
    const stamp = new Date(now());
    await db.transaction(async (tx) => {
      const values = { value: { on: b.on }, updatedAt: stamp, updatedBy: actorId };
      await tx.insert(appContent).values({ key: "askOn", ...values }).onConflictDoUpdate({ target: appContent.key, set: values });
      await tx.insert(auditLog).values({ actorId, action: "ask.switch", data: { on: b.on }, at: stamp });
    });
    return c.json({ on: b.on });
  });

  return app;
}
