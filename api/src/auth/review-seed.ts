import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { hosts, legalAcceptances, stations, users, venues } from "../db/schema.ts";
import { startHost } from "../roles/routes.ts";
import { isReview, type ReviewApp, type ReviewConfig, reviewPhone } from "./review.ts";
import { TERMS_VERSION } from "./routes.ts";

// The review accounts (auth/review.ts), made or put right at every API start while REVIEW_EMAILS is set, so the owner
// only sets the env and deploys. Each signs straight in: a phone, an adult date of birth and the terms on file. Event
// Partner's is the Admin of a private demo host; Play Partner's runs a private demo venue with one station. Private
// hosts have no public page, their events are link-only and their venues take no bookings from Orbit (hosts/routes.ts
// `visible`, slots/routes.ts), so nothing a reviewer does reaches real people.
// An account found by users.review, the mark only this sets, so changing REVIEW_EMAILS moves the account to the new email.
// An email already on a real person's account is left alone, and POST /auth/code then sends it a real code instead.
// Under a lock, so two API starts at once seed once.

const NAME: Record<ReviewApp, string> = { orbit: "App Review", launch: "App Review Events", station: "App Review Venue" };
const DOB = "1990-01-01";
const LOCK = 742020; // any fixed number: pg_advisory_xact_lock's key for this seed

export async function seedReview(db: Db, cfg: ReviewConfig, now = Date.now()) {
  const at = new Date(now);
  for (const { app, email } of cfg.accounts) {
    const done = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
      const [held] = await tx.select().from(users).where(eq(users.email, email));
      if (held && !isReview(held)) return false;
      const [mine] = await tx.select().from(users).where(eq(users.review, app));
      // Another review account had this email (the list was reordered): it gives it up.
      if (held && held.id !== mine?.id) await tx.update(users).set({ email: null, emailVerifiedAt: null, updatedAt: at }).where(eq(users.id, held.id));
      // A deletion asked for by a reviewer before deletions were refused to review accounts is dropped.
      const [user] = mine
        ? await tx
            .update(users)
            .set({ email, emailVerifiedAt: mine.emailVerifiedAt && mine.email === email ? mine.emailVerifiedAt : at, name: mine.name ?? NAME[app], dob: mine.dob ?? DOB, deletionRequestedAt: null, deletionDueAt: null, updatedAt: at })
            .where(eq(users.id, mine.id))
            .returning()
        : await tx.insert(users).values({ review: app, name: NAME[app], phone: reviewPhone(app), phoneVerifiedAt: at, email, emailVerifiedAt: at, dob: DOB, createdAt: at, updatedAt: at }).returning();
      const u = user!;
      await tx.insert(legalAcceptances).values({ userId: u.id, document: "terms", version: TERMS_VERSION, client: "app", acceptedAt: at }).onConflictDoNothing();
      if (app === "orbit") return true;

      const kind = app === "station" ? "venue" : "other";
      // One that isn't archived: an archived demo host is left as the reviewer left it, and a new one made.
      let [host] = await tx.select().from(hosts).where(and(eq(hosts.ownerId, u.id), eq(hosts.kind, kind), ne(hosts.status, "archived"))).limit(1);
      host ??= await startHost(tx, { name: NAME[app], kind, city: "Hyderabad", about: "A demo host for App Store and Play review. Not a real host." }, u, at);
      // Every host they own, also ones a reviewer started, stays private.
      await tx.update(hosts).set({ visibility: "private", updatedAt: at }).where(and(eq(hosts.ownerId, u.id), ne(hosts.visibility, "private")));
      if (app === "launch") return true;

      await tx
        .insert(venues)
        .values({ hostId: host.id, address: "Demo venue, not a real place", area: "Demo", lat: 17.385, lng: 78.4867, deskPhone: u.phone!, week: Array(7).fill([9, 23]), createdAt: at, updatedAt: at })
        .onConflictDoNothing();
      const [some] = await tx.select({ id: stations.id }).from(stations).where(eq(stations.hostId, host.id)).limit(1);
      if (!some)
        await tx.insert(stations).values({ hostId: host.id, name: "Gaming PC", unit: "PC", tile: "gaming", count: 4, whole: false, step: 30, pricePaise: 10000, createdAt: at, updatedAt: at });
      return true;
    });
    // The app's name only: the email stays out of the log.
    if (!done) console.error(`[review] the ${app} review email is on a real person's account; that account is left out`);
  }
}
