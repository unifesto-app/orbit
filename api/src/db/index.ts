import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.ts";

export function connect(url: string) {
  const client = postgres(url, { onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
export type Db = ReturnType<typeof connect>["db"];

// Applies the SQL files in api/drizzle that haven't run yet. They are written by `pnpm db:generate` from schema.ts and
// read in review before they ship.
export const migrateDb = (db: Db) => migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
