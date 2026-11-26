import { desc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { AskPayout, bankName, type HostMoney, type PayoutAccount, SetPayoutAccount } from "@orbit/contract";
import type { Deps } from "../auth/routes.ts";
import { auditLog, events, payoutAccounts, payouts, venues } from "../db/schema.ts";
import { type Env, fail, invalid, parse, signedIn } from "../http.ts";
import { adminsOf, changeable, holdersOf, teamOf, tell } from "../roles/access.ts";
import { askPayout, earningsOf, venueEarningsOf, WAIT } from "./galaxy.ts";

// A host's own money (Money flow: Your earnings, Bank account and payouts; X4), for its Admins in Event Partner and Play
// Partner: the numbers worked out on the server (earningsOf, venueEarningsOf), asking for a payout, and where Orbit
// pays. Anyone else gets the same 404 as PATCH /hosts/:id. A bank account goes back masked (the bank's name and the
// last 4): the number and the UPI ID are for Galaxy's Money holders alone, and never logged.

const DAY = 24 * 3600_000;
const CHECK = 72 * 3600_000; // how long a check takes, as the apps say it
const nothing = (c: Context) => fail(c, 404, "notFound", "There's nothing here.");

const masked = (a: typeof payoutAccounts.$inferSelect): PayoutAccount => ({
  kind: a.kind, bankName: a.bankName, last4: a.last4, holder: a.holder, state: a.state, reason: a.reason,
  until: a.state === "checking" ? new Date(a.updatedAt.getTime() + CHECK).toISOString() : null,
});

export function hostMoneyRoutes({ db, store, secret, notify, now = Date.now }: Deps) {
  const app = new Hono<Env>();
  const auth = signedIn(db, secret, now);
  const cap = bodyLimit({ maxSize: 4 * 1024, onError: (c) => invalid(c) });
  const at = () => new Date(now());
  const adminOf = async (c: Context<Env>) => {
    const t = await teamOf(db, c.req.param("id")!, c.var.user.id);
    return t?.mine.role === "admin" ? t.host : null;
  };
  const tellMoney = async (action: string, reason: string, by: string) =>
    tell(notify, await holdersOf(db, "money", at()), "staffRiskyAction", { action, reason, by });

  // GET /hosts/:id/money: the fee plan, the account (masked), each event's earnings, a Venue's slot money, and the
  // last 100 payouts.
  app.get("/hosts/:id/money", auth, async (c) => {
    const host = await adminOf(c);
    if (!host) return nothing(c);
    const [a] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.hostId, host.id));
    const mine = await db.select({ id: events.id, endsAt: events.endsAt }).from(events).where(eq(events.hostId, host.id));
    const ends = new Map(mine.map((e) => [e.id, e.endsAt]));
    const [venue] = await db.select({ id: venues.hostId }).from(venues).where(eq(venues.hostId, host.id));
    const rows = await db
      .select({ o: payouts, eventTitle: events.title })
      .from(payouts)
      .leftJoin(events, eq(events.id, payouts.eventId))
      .where(eq(payouts.hostId, host.id))
      .orderBy(desc(payouts.createdAt))
      .limit(100);
    const out: HostMoney = {
      plan: host.feePlan,
      feeIncluded: host.feeIncluded,
      account: a ? masked(a) : null,
      events: (await earningsOf(db, { eventIds: mine.map((e) => e.id) }, new Date(now()))).map((e) => {
        const end = ends.get(e.eventId!); // an eventIds scope gives events only, each with its title
        // Below 0 when refunds came after an ask; the host sees nothing to ask for, not a debt.
        return { ...e, eventId: e.eventId!, eventTitle: e.eventTitle!, availablePaise: Math.max(0, e.availablePaise), endsAt: end?.toISOString() ?? null, opensAt: end ? new Date(end.getTime() + WAIT).toISOString() : null };
      }),
      venue: venue ? await venueEarningsOf(db, host.id, now()).then((v) => ({ ...v, availablePaise: Math.max(0, v.availablePaise) })) : null,
      payouts: rows.map(({ o, eventTitle }) => ({
        // A cancel's reason is written for the host; any other is staff's note.
        id: o.id, eventId: o.eventId, eventTitle, amountPaise: o.amountPaise, status: o.status, utr: o.utr, reason: o.status === "cancelled" ? o.reason : null,
        askedAt: o.createdAt.toISOString(), at: o.at.toISOString(),
      })),
    };
    return c.json(out);
  });

  // POST /hosts/:id/payouts {eventId?, amountPaise}: an Admin asks; askPayout says when it can't. Orbit pays it by bank
  // transfer and marks it paid with the UTR in Galaxy.
  app.post("/hosts/:id/payouts", cap, auth, async (c) => {
    const b = await parse(c, AskPayout);
    if (!b) return invalid(c);
    const host = await adminOf(c);
    if (!host) return nothing(c);
    if (!changeable(host)) return fail(c, 409, "hostClosed", "This host can't ask for payouts right now.");
    const userId = c.var.user.id;
    const done = await db.transaction(async (tx) => {
      const o = await askPayout(tx, { ...b, hostId: host.id }, { id: userId, fromHost: true }, now());
      if ("no" in o) return fail(c, ...o.no);
      await tx.insert(auditLog).values({ actorId: userId, action: "payouts.request", targetHost: host.id, data: { payoutId: o.id, eventId: o.eventId, amountPaise: o.amountPaise }, at: at() });
      return o;
    });
    if (done instanceof Response) return done;
    await tellMoney("payouts.request", `${host.name} asked for ₹${(done.amountPaise / 100).toFixed(2)}`, userId);
    return c.json({ id: done.id }, 201);
  });

  // GET /hosts/:id/payout-account: masked, or null.
  app.get("/hosts/:id/payout-account", auth, async (c) => {
    const host = await adminOf(c);
    if (!host) return nothing(c);
    const [a] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.hostId, host.id));
    return c.json(a ? masked(a) : null);
  });

  // PUT /hosts/:id/payout-account {holder, account, ifsc} | {holder?, upi}: added, or replaced; either way it's checked
  // again before Orbit pays to it. Every Admin hears (a replacement they didn't make is the thing to catch), and staff
  // with Money, who check it.
  // ponytail: no "confirm it's you" (passkey or code) before a replacement yet; it comes with step-up in the host apps.
  app.put("/hosts/:id/payout-account", cap, auth, async (c) => {
    const b = await parse(c, SetPayoutAccount);
    if (!b) return fail(c, 400, "invalid", "Add the holder’s name, an account number of 9 to 18 digits and an 11-character IFSC, or a UPI ID.");
    const host = await adminOf(c);
    if (!host) return nothing(c);
    if (!changeable(host)) return fail(c, 409, "hostClosed", "This host can't be edited right now.");
    // Each change sends every Admin an email and staff a check to do: a few a day is plenty.
    if ((await store.incr(`payacct:${host.id}`, DAY)) > 5) return fail(c, 429, "tooMany", "You've changed this account 5 times today. Try again tomorrow.");
    const [handle, name] = "upi" in b ? [b.upi.split("@")[1]!, b.upi.split("@")[0]!] : ["", ""];
    const v =
      "upi" in b
        ? { kind: "upi" as const, holder: b.holder ?? host.name, upi: b.upi, accountNumber: null, ifsc: null, bankName: `UPI · ${handle}`, last4: name.slice(name.length > 4 ? -4 : -1) }
        : { kind: "bank" as const, holder: b.holder, upi: null, accountNumber: b.account, ifsc: b.ifsc, bankName: bankName(b.ifsc), last4: b.account.slice(-4) };
    const userId = c.var.user.id;
    const a = await db.transaction(async (tx) => {
      const [had] = await tx.select({ id: payoutAccounts.hostId }).from(payoutAccounts).where(eq(payoutAccounts.hostId, host.id)).for("update");
      const fresh = { ...v, state: "checking" as const, reason: null, checkedBy: null, checkedAt: null, updatedAt: at() };
      const [a] = await tx
        .insert(payoutAccounts)
        .values({ hostId: host.id, ...fresh, createdAt: at() })
        .onConflictDoUpdate({ target: payoutAccounts.hostId, set: fresh })
        .returning();
      // The kind only: never the number, the UPI ID or its last 4.
      await tx.insert(auditLog).values({ actorId: userId, action: "payouts.account", targetHost: host.id, data: { kind: v.kind, replaced: !!had }, at: at() });
      return a!;
    });
    await tell(notify, await adminsOf(db, host.id), "bankChanged", { hostId: host.id, hostName: host.name });
    await tellMoney("payouts.account", `${host.name}'s account is waiting to be checked`, userId);
    return c.json(masked(a));
  });

  return app;
}
