import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { runDeletions } from "./auth/deletion.ts";
import type { Sender } from "./auth/codes.ts";
import { memoryStore, redisStore } from "./auth/store.ts";
import { connect, migrateDb } from "./db/index.ts";
import type { Notify } from "./http.ts";

const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const production = process.env.NODE_ENV === "production";

const secret = need("AUTH_SECRET");
if (secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
const { db } = connect(need("DATABASE_URL"));
await migrateDb(db);

// ponytail: WhatsApp and Resend senders aren't wired yet, so codes print to the log off production and fail on it.
const send: Sender = async (to, code) => {
  if (production) throw new Error("No code sender is set up yet");
  console.log(`[code] ${to.kind === "phone" ? to.e164 : to.email}: ${code}`);
};
const store = production || process.env.REDIS_URL ? redisStore(need("REDIS_URL")) : memoryStore();
// ponytail: messages to people come with the Notifications flow; until then they're only logged.
const notify: Notify = async (n) => console.log(`[notify] ${n.kind} → ${JSON.stringify(n.to)}`);

// Day-30 account deletions. ponytail: an hourly sweep until the job runner runs it nightly at 03:30 IST.
setInterval(() => runDeletions(db, notify, Date.now()).catch((e) => console.error("[deletions]", e)), 60 * 60 * 1000).unref();

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: createApp({ db, store, send, notify, secret }).fetch, port }, (info) => {
  console.log(`orbit-api listening on :${info.port}`);
});
