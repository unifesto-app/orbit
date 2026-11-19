import { type Client } from "@orbit/contract";
import { sql } from "drizzle-orm";
import type { Db } from "./db/index.ts";

// Who used Orbit on which day (contract/src/analytics.ts; owner, 19 Nov 2026: "user analytics, mau, dau etc", kept
// "90 days"). markActive runs on every signed-in request (http.ts, signedIn) and writes at most one row per person, day
// and platform: a set in memory remembers today's, and the table's key catches the rest. It never waits on the database
// and never fails a request. Galaxy's own requests are staff at work, not people using Orbit, and aren't counted.
// ponytail: the set lives in this process, so a restart or a second API process writes today's rows again, harmlessly;
// each person's first request of the day is one unawaited insert, so midnight IST and a deploy bring a short burst.

export const istDay = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10); // IST is a fixed UTC+5:30

const seen = new Set<string>();
let seenDay = "";

export function markActive(db: Db, userId: string, client: Client, now: number) {
  if (client.platform === "galaxy") return;
  const day = istDay(now);
  if (day !== seenDay) {
    seen.clear(); // a new day: yesterday's people are counted again on their first request
    seenDay = day;
  }
  const key = `${userId}|${client.platform}`;
  if (seen.has(key)) return;
  seen.add(key);
  const retry = (e: unknown) => {
    seen.delete(key); // the next request tries again
    console.error(`[activity] not recorded: ${e instanceof Error ? e.message : String(e)}`);
  };
  try {
    // Only while the account stands: a request racing the account's deletion never leaves a row behind it (the user row
    // stays, scrubbed, so no foreign key would stop it).
    void db
      .execute(
        sql`insert into activity (user_id, day, platform, version)
            select ${userId}, ${day}::date, ${client.platform}, ${client.version}
            where exists (select 1 from users where id = ${userId} and deleted_at is null)
            on conflict do nothing`,
      )
      .catch(retry);
  } catch (e) {
    retry(e); // anything thrown while the query is put together, never out into the request
  }
}
