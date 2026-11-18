import { isIP, isIPv6 } from "node:net";
import { count, desc } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ADULT, ageOn, type Feature, Interest, InterestCode, type InterestList, type InterestMeta, proofOf, readPhone } from "@orbit/contract";
import type { Deps } from "./auth/routes.ts";
import { checkCode, OPEN, RESEND_AFTER, sendCode } from "./auth/codes.ts";
import { proofs } from "./auth/proof.ts";
import { welcomeEmail } from "./prelaunch-email.ts";
import { auditLog, interest } from "./db/schema.ts";
import { clientIp, fail, invalid, listPage, parse, signedIn } from "./http.ts";
import { requireFeature, type StaffEnv } from "./roles/access.ts";

// Prelaunch interest: the landing page's waitlist (a name, a WhatsApp number a code proves, a date of birth and the
// features wanted), its count, and Galaxy's list (contract/src/prelaunch.ts). Codes go out as sign-in's do
// (auth/codes.ts), with its send and try limits, daily WhatsApp cap and proof check (Turnstile from the page), but in
// their own scope: a waitlist code never signs anyone in.
// ponytail: the daily cap is shared with sign-in, so a flood of waitlist sends can pause WhatsApp sign-in codes until
// midnight, as a flood of sign-in sends already can; a separate counter if the owner wants the bill ceiling doubled.
const WAITLIST = "waitlist:";

const PER_MINUTE = 10; // sign-ups from one address a minute: room for a shared Wi-Fi, not for filling the table

// An IPv6 address as its eight groups, so the first four name its /64.
const expand = (ip: string) => {
  const [head, tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = tail ? tail.split(":") : [];
  return [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
};

export function prelaunchRoutes({ db, store, send, secret, now = Date.now, codes = OPEN, proof, mail }: Deps) {
  const app = new Hono<StaffEnv>();
  const total = async () => (await db.select({ n: count() }).from(interest))[0]!.n;
  // The waitlist comes only from the web page, which carries a Turnstile token. Once Turnstile is set up
  // (TURNSTILE_SECRET), a waitlist send without a good token is refused, whatever PROOF says: PROOF=enforce also governs
  // the app's iPhone and Android proofs, and the waitlist shouldn't wait for those (owner, 18 Nov 2026: "set it up").
  const proven = proof ? proofs(proof.turnstile ? { ...proof, enforce: true } : proof, store) : null;
  // One address's bucket: one IPv6 network (a /64, what one home or phone gets) counts as one address.
  const bucketOf = (ip: string) => (isIPv6(ip) ? expand(ip).slice(0, 4).join(":") : ip);
  const ipOf = (c: Context) => clientIp(c).replace(/^::ffff:(?=\d+\.)/i, ""); // an IPv4 address as Node may show it
  const cap = bodyLimit({ maxSize: 8 * 1024, onError: (c) => invalid(c) });
  const phoneOf = (c: Context, text: string) => {
    const p = readPhone(text);
    if (p === "abroad") return fail(c, 400, "abroad", "Orbit takes Indian (+91) WhatsApp numbers only.");
    return p ?? fail(c, 400, "invalid", "Enter your 10-digit WhatsApp number.");
  };

  // GET /public/interest: how many have joined, for the landing page.
  app.get("/public/interest", async (c) => c.json({ count: await total() }));

  // POST /public/interest/code: a 6-digit code on WhatsApp, as sign-in sends it.
  app.post("/public/interest/code", cap, async (c) => {
    const b = await parse(c, InterestCode);
    if (!b) return invalid(c);
    const phone = phoneOf(c, b.phone);
    if (phone instanceof Response) return phone;
    const r = proven && (await proven.check(b.proof, proofOf.code));
    if (r === "tooMany") return fail(c, 429, "tooMany", "Too many tries today. Try again tomorrow.");
    // Most often a content blocker stopped Cloudflare's check from loading on the page.
    if (r) return fail(c, 403, "unproven", "We couldn't check you’re a person. If a content blocker is on, allow this page, then try again.");
    // The opening gate is sign-in's (who may sign in yet); the waitlist is for everyone. The daily cap still holds.
    const sent = await sendCode(store, send, secret, { kind: "phone", e164: phone }, ipOf(c), { ...codes, openTo: null }, now(), WAITLIST);
    if (sent.ok) return c.json({ retryIn: RESEND_AFTER });
    switch (sent.error) {
      case "tooSoon":
        return fail(c, 429, "tooSoon", `Wait ${RESEND_AFTER} seconds, then send a new code.`, { retryIn: RESEND_AFTER });
      case "tooMany":
        return fail(c, 429, "tooMany", "Too many codes sent. Try again tomorrow.");
      case "notOpen": // never, with the gate off
      case "paused":
        return fail(c, 503, "paused", "We can't send codes right now. Try again tomorrow.");
      case "notSent":
        if (sent.reason === "refused") return fail(c, 400, "notSent", "We couldn't send a WhatsApp message to that number. Check it's on WhatsApp.");
        return fail(c, 503, "tryLater", "We couldn't send the code just now. Try again in a minute.", { retryIn: 60 });
    }
  });

  // POST /public/interest: 204 for a new number and one already on the list alike, which keeps its first details.
  // Under 18 is refused before the code is checked, so nothing is kept and a mistyped year can be fixed with the same
  // code, as at sign-up.
  app.post("/public/interest", cap, async (c) => {
    const ip = ipOf(c);
    if ((await store.incr(`interest:${bucketOf(ip)}`, 60_000)) > PER_MINUTE) return fail(c, 429, "tooMany", "Too many tries. Wait a minute.");
    const b = await parse(c, Interest);
    if (!b) return invalid(c);
    const phone = phoneOf(c, b.phone);
    if (phone instanceof Response) return phone;
    if (ageOn(b.dob, now()) < ADULT) return fail(c, 403, "under18", "Orbit is for people 18 and over.");
    const check = await checkCode(store, secret, { kind: "phone", e164: phone }, b.code, ip, WAITLIST);
    if (!check.ok) {
      if (check.error === "tooMany") return fail(c, 429, "tooMany", "Too many tries. Wait 15 minutes, then send a new code.");
      if (check.error === "expired") return fail(c, 400, "codeExpired", "That code has expired. Send a new one.");
      return fail(c, 400, "wrongCode", "That code isn't right. Check the latest WhatsApp message.");
    }
    const [row] = await db
      .insert(interest)
      .values({ name: b.name, phone, email: b.email, dob: b.dob, features: b.features, ip: isIP(ip) ? ip : null, ...b.meta, createdAt: new Date(now()) })
      .onConflictDoNothing({ target: interest.phone })
      .returning({ id: interest.id });
    // The welcome email, once, for a new entry only. It never holds up or fails the join: a send that fails is logged.
    if (row && mail)
      void Promise.resolve()
        .then(() => mail(b.email, welcomeEmail({ name: b.name, features: b.features })))
        .catch((e) =>
        console.error(`[mail] waitlist welcome not sent: ${e instanceof Error ? e.message : String(e)}`),
      );
    return c.body(null, 204);
  });

  // GET /galaxy/prelaunch?page=: everyone who has asked, newest first, for holders of People. Each read is logged.
  app.get("/galaxy/prelaunch", signedIn(db, secret, now), requireFeature(db, now, "people"), async (c) => {
    const { page, limit, offset } = listPage(c);
    const rows = await db.select().from(interest).orderBy(desc(interest.createdAt), desc(interest.id)).limit(limit).offset(offset);
    await db.insert(auditLog).values({ actorId: c.var.actor.id, action: "prelaunch.list", data: { page, results: rows.map((r) => r.id) }, at: new Date(now()) });
    // A field the visit didn't give is left out, not null.
    const strip = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as InterestMeta;
    const body: InterestList = {
      people: rows.map(({ createdAt, ...r }) => ({
        ...strip(r),
        id: r.id,
        email: r.email,
        name: r.name,
        phone: r.phone,
        dob: r.dob,
        features: (r.features ?? []) as Feature[],
        ip: r.ip,
        createdAt: createdAt.toISOString(),
      })),
      total: await total(),
      page,
      pageSize: limit,
    };
    return c.json(body);
  });

  return app;
}
