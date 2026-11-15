import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes the next SQL migration into ./drizzle from the schema. Read it before it ships.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
