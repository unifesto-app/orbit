import { randomBytes, randomInt } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { CODE_ALPHABET, CODE_LENGTH, type MyTickets, NewBooking, type Ticket } from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { bookings, events, hosts, ticketTypes } from "./db/schema.ts";
import { cards, openable } from "./events/public.ts";
import { fail, invalid, isUuid, parse, signedIn, taken, type Env } from "./http.ts";
import { mine } from "./saves.ts";

// Free registration and the ticket it gives (Orbit flows: Booking and tickets; P10.1, P12.1, P12.2). Signed in, and a
// person only ever reads or cancels their own (anyone else's is a 404). Paid tiers are paid for (payments/routes.ts).
// Tokens (qr, code, link) are never logged.

type Deps = { db: Db; secret: string; now?: () => number };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Row = typeof bookings.$inferSelect;

const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");
// 32 characters (24 random bytes, URL-safe): fits the app's QR encoder and a link. Slot tickets use both (slots/hold.ts).
export const token = () => randomBytes(24).toString("base64url");
export const code = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
const india = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Confirmed seats per ticket type, for `left` and the oversell check.
export async function seatsTaken(db: Db | Tx, tierIds: string[]): Promise<Map<string, number>> {
  if (!tierIds.length) return new Map();
  const rows = await db
    .select({ id: bookings.ticketTypeId, n: sql<number>`sum(${bookings.quantity})::int` })
    .from(bookings)
    .where(and(inArray(bookings.ticketTypeId, tierIds), eq(bookings.status, "confirmed")))
    .groupBy(bookings.ticketTypeId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

// What book() and paying check, under book()'s locks: the caller holds the person (mine), and this takes the event
// shared (so a host's cancel or ticket edit waits for it, and it for them), then the ticket type, under which the
// confirmed seats are counted: never oversold. `paid`: the caller is paying, so the tier must have a price (book() is
// for free ones). Settling a payment runs it again, so a seat taken while someone paid is caught there.
export type Refusal = { error: string; status: 400 | 404 | 409; message: string; extra?: object };
export async function seatCheck(
  tx: Tx,
  i: { userId: string; eventId: string; ticketTypeId: string; quantity: number; paid: boolean },
  now: number,
): Promise<Refusal | { e: { id: string; hostId: string }; tier: typeof ticketTypes.$inferSelect }> {
  const no = (status: Refusal["status"], error: string, message: string, extra?: object): Refusal => ({ status, error, message, extra });
  const [e] = await tx
    .select({ id: events.id, hostId: events.hostId, status: events.status, endsAt: events.endsAt })
    .from(events)
    .innerJoin(hosts, eq(hosts.id, events.hostId))
    .where(and(eq(events.id, i.eventId), openable))
    .for("share", { of: events });
  if (!e) return no(404, "notFound", "There's nothing here.");
  if (e.status === "cancelled") return no(409, "cancelled", "This event has been cancelled.");
  if (!e.endsAt || e.endsAt.getTime() <= now) return no(409, "ended", "This event has ended.");
  const [tier] = await tx.select().from(ticketTypes).where(and(eq(ticketTypes.id, i.ticketTypeId), eq(ticketTypes.eventId, e.id))).for("update");
  if (!tier) return no(404, "notFound", "There's nothing here.");
  if (!i.paid && tier.pricePaise > 0) return no(409, "paidLater", "Paying in the app is coming soon."); // the code builds before X3 read
  if (i.paid && tier.pricePaise === 0) return no(400, "free", "This ticket is free. Book it instead.");
  if (tier.salesStartAt && tier.salesStartAt.getTime() > now) return no(409, "notOpen", `Booking opens ${india(tier.salesStartAt)}`);
  if (tier.salesEndAt && tier.salesEndAt.getTime() <= now) return no(409, "closed", "Booking has closed");
  // ponytail: no age on events yet (P19.2); once there is, an 18+ or 21+ event books exactly 1 (Booking d14).
  if (i.quantity > tier.perPersonLimit) return no(409, "tooMany", `You can book up to ${tier.perPersonLimit} of these at a time.`);
  const [have] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.userId, i.userId), eq(bookings.ticketTypeId, tier.id), eq(bookings.status, "confirmed")));
  if (have) return no(409, "booked", "You already have a ticket for this.");
  if (tier.quantity !== null) {
    const left = tier.quantity - ((await seatsTaken(tx, [tier.id])).get(tier.id) ?? 0);
    if (left < i.quantity) return no(409, "fewLeft", left <= 0 ? "Sold out" : `Only ${left} left`, { left: Math.max(left, 0) });
  }
  return { e: { id: e.id, hostId: e.hostId }, tier };
}

// A confirmed booking's random tokens: a QR, the 8-character code and the link.
export const tokens = () => ({ qr: token(), code: code(), link: token() });

// The holder's view of bookings: each with its event card (cancelled and off-the-air events too: it's their ticket) and,
// only while confirmed, the tokens and the event's online link.
async function tickets(db: Db, rows: Row[]): Promise<Ticket[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.eventId))];
  const byId = new Map((await cards(db, { where: inArray(events.id, ids), order: [] })).map((e) => [e.id, e]));
  const links = new Map((await db.select({ id: events.id, link: events.onlineLink }).from(events).where(inArray(events.id, ids))).map((e) => [e.id, e.link]));
  const tiers = new Map(
    (await db.select({ id: ticketTypes.id, name: ticketTypes.name, pricePaise: ticketTypes.pricePaise }).from(ticketTypes).where(inArray(ticketTypes.id, rows.map((r) => r.ticketTypeId)))).map((t) => [t.id, t]),
  );
  return rows.map((r) => {
    const live = r.status === "confirmed";
    return {
      id: r.id, status: r.status, quantity: r.quantity, admitted: r.admitted, checkedInAt: r.checkedInAt?.toISOString() ?? null,
      qr: live ? r.qr : null, code: live ? r.code : null, link: live ? r.link : null,
      createdAt: r.createdAt.toISOString(), cancelledAt: r.cancelledAt?.toISOString() ?? null,
      ticketType: tiers.get(r.ticketTypeId)!, event: byId.get(r.eventId)!, onlineLink: live ? (links.get(r.eventId) ?? null) : null,
    };
  });
}

export function bookingsRoutes({ db, secret, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const at = () => new Date(now());

  // POST /events/:id/book {ticketTypeId, quantity}: booked in Orbit's app, so `source` is "orbit" (d16: a client can't
  // set its own attribution; host and other sources come with their own routes). A free seat is taken at once, no hold
  // (holds are for paid checkout). Locks, in this order everywhere: the person (mine), then seatCheck's event and ticket
  // type.
  app.post("/events/:id/book", auth, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const b = await parse(c, NewBooking);
    if (!b) return invalid(c);
    const userId = c.var.user.id;
    for (let tries = 0; ; tries++) {
      try {
        const done = await mine(db, c, userId, async (tx) => {
          const ok = await seatCheck(tx, { userId, eventId: id, ticketTypeId: b.ticketTypeId, quantity: b.quantity, paid: false }, now());
          if ("error" in ok) return fail(c, ok.status, ok.error, ok.message, ok.extra);
          const { e, tier } = ok;
          const [row] = await tx
            .insert(bookings)
            .values({ userId, eventId: e.id, ticketTypeId: tier.id, quantity: b.quantity, source: "orbit", ...tokens(), createdAt: at() })
            .returning();
          return row!;
        });
        if (done instanceof Response) return done;
        return c.json((await tickets(db, [done]))[0]!, 201);
      } catch (e) {
        // A random token met another booking's: again with fresh ones. (The one-live-per-type index can't be what
        // fired: the person's row is locked and checked above.)
        if (taken(e) && tries < 2) continue;
        throw e;
      }
    }
  });

  // GET /me/tickets: upcoming until the event ends, soonest first; past (ended, or cancelled at any time) newest first.
  // ponytail: no paging; a page when someone has hundreds.
  app.get("/me/tickets", auth, async (c) => {
    const rows = await db
      .select({ b: bookings, startsAt: events.startsAt, endsAt: events.endsAt })
      .from(bookings)
      .innerJoin(events, eq(events.id, bookings.eventId))
      .where(eq(bookings.userId, c.var.user.id))
      .orderBy(asc(events.startsAt), asc(bookings.createdAt));
    const upcoming = rows.filter((r) => r.b.status === "confirmed" && r.endsAt!.getTime() > now());
    const past = rows.filter((r) => !upcoming.includes(r)).reverse();
    const out: MyTickets = { upcoming: await tickets(db, upcoming.map((r) => r.b)), past: await tickets(db, past.map((r) => r.b)) };
    return c.json(out);
  });

  const own = async (c: Context<Env>) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return null;
    const [row] = await db.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.userId, c.var.user.id)));
    return row ?? null;
  };

  // GET /me/tickets/:id: one of yours.
  app.get("/me/tickets/:id", auth, async (c) => {
    const row = await own(c);
    return row ? c.json((await tickets(db, [row]))[0]!) : nothing(c);
  });

  // POST /me/tickets/:id/cancel: a free booking, by its holder, before the event starts. The seats free at once and they
  // can book again; the link changes (here: goes).
  app.post("/me/tickets/:id/cancel", auth, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return nothing(c);
    const done = await mine(db, c, c.var.user.id, async (tx) => {
      const [row] = await tx.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.userId, c.var.user.id))).for("update");
      if (!row) return nothing(c);
      if (row.status !== "confirmed") return fail(c, 409, "notNow", "This ticket is already cancelled.");
      if (row.admitted > 0) return fail(c, 409, "checkedIn", "You've checked in, so this ticket can't be cancelled.");
      const [e] = await tx.select({ startsAt: events.startsAt }).from(events).where(eq(events.id, row.eventId));
      if (!e!.startsAt || e!.startsAt.getTime() <= now()) return fail(c, 409, "started", "The event has started, so this ticket can't be cancelled.");
      const [tier] = await tx.select({ pricePaise: ticketTypes.pricePaise }).from(ticketTypes).where(eq(ticketTypes.id, row.ticketTypeId));
      // ponytail: a paid ticket isn't cancelled by its holder here; asking for a refund comes with the refund requests queue.
      if (tier!.pricePaise > 0) return fail(c, 409, "notFree", "A paid ticket is refunded, not cancelled.");
      // ponytail: qr and code stay on the row (unique, so never reused); the scan slice must check status, not just find
      // the token, so a cancelled ticket's QR is refused at the gate.
      const [out] = await tx.update(bookings).set({ status: "cancelled", cancelledAt: at(), link: null }).where(eq(bookings.id, row.id)).returning();
      return out!;
    });
    if (done instanceof Response) return done;
    return c.json((await tickets(db, [done]))[0]!);
  });

  return app;
}
