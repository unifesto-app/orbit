import { sql } from "drizzle-orm";
import type { Contact } from "@orbit/contract";
import { createApp } from "./app.ts";
import type { Sender, SendPolicy } from "./auth/codes.ts";
import type { ProofConfig } from "./auth/proof.ts";
import { memoryStore } from "./auth/store.ts";
import type { WaysConfig } from "./auth/ways.ts";
import { connect, migrateDb } from "./db/index.ts";
import type { Notice } from "./http.ts";
import { memoryFiles } from "./media.ts";

// A real Postgres for tests: TEST_DATABASE_URL, or the local orbit_test database (createdb orbit_test). Each call
// empties it and runs every migration, so a test file starts clean. Test files run one at a time (package.json).
// `send` replaces the sender that records codes, and `codes` sets the opening gate and daily cap (default: open).
// `ways` sets passkeys, Google and Apple (auth/ways.ts), with `fetch` answering for Google and Apple. `media: false`
// leaves uploads out, as on a server with no bucket. `proof` checks that requests come from Orbit (default: unchecked).
export async function testApp(opts: { send?: Sender; codes?: SendPolicy; ways?: WaysConfig; media?: false; proof?: ProofConfig } = {}) {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/orbit_test";
  if (!/_test(\?|$)/.test(url)) throw new Error("Tests empty their database, so its name must end in _test");
  const { db, close } = connect(url);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrateDb(db);

  let clock = Date.now();
  const sent: { to: Contact; code: string }[] = [];
  const notices: Notice[] = [];
  const store = memoryStore(() => clock);
  const media = { files: memoryFiles(), url: "https://api.test/media" };
  const app = createApp({
    db,
    store,
    secret: "test-secret-that-is-at-least-32-characters",
    now: () => clock,
    send: opts.send ?? (async (to, code) => void sent.push({ to, code })),
    codes: opts.codes,
    ways: opts.ways,
    proof: opts.proof,
    notify: async (n) => void notices.push(n),
    media: opts.media === false ? undefined : media,
  });

  const call = async (method: string, path: string, body?: unknown, access?: string) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...(access ? { authorization: `Bearer ${access}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as any) };
  };
  // The code last sent to a phone or email.
  const lastCode = (to: string) => sent.filter((s) => (s.to.kind === "phone" ? s.to.e164 : s.to.email) === to).at(-1)?.code;

  return { db, app, store, call, sent, notices, lastCode, media, close, tick: (ms: number) => void (clock += ms), now: () => clock };
}
