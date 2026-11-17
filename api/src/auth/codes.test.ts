import { test } from "node:test";
import assert from "node:assert/strict";
import type { Contact } from "@orbit/contract";
import { checkCode, sendCode } from "./codes.ts";
import { NotSent } from "./senders.ts";
import { memoryStore } from "./store.ts";

const secret = "test-secret-that-is-at-least-32-characters";
const phone = (i: number): Contact => ({ kind: "phone", e164: `+91900000${String(i).padStart(4, "0")}` });

test("right codes from one gate's Wi-Fi never add up to the per-IP limit", async () => {
  const store = memoryStore();
  let last = "";
  const send = async (_: Contact, code: string) => void (last = code);
  for (let i = 0; i < 80; i++) {
    await sendCode(store, send, secret, phone(i), "gate");
    assert.deepEqual(await checkCode(store, secret, phone(i), last, "gate"), { ok: true }, `person ${i}`);
  }
});

test("a failed send keeps the code sent before it good", async () => {
  const store = memoryStore(() => clock);
  let clock = 0;
  let last = "";
  await sendCode(store, async (_, code) => void (last = code), secret, phone(1), "ip");
  clock += 30_000;
  await assert.rejects(sendCode(store, async () => Promise.reject(new Error("WhatsApp down")), secret, phone(1), "ip"));
  assert.deepEqual(await checkCode(store, secret, phone(1), last, "ip"), { ok: true });
});

test("wrong codes from one IP stop at 50 across numbers", async () => {
  const store = memoryStore();
  let last = "";
  const send = async (_: Contact, code: string) => void (last = code);
  const errors = [];
  for (let i = 0; i < 60; i++) {
    await sendCode(store, send, secret, phone(i), "attacker");
    const r = await checkCode(store, secret, phone(i), last === "000000" ? "000001" : "000000", "attacker");
    errors.push(r.ok ? "ok" : r.error);
  }
  assert.deepEqual(errors, [...Array(50).fill("wrongCode"), ...Array(10).fill("tooMany")]);
});

// ---------- gate, daily cap and real senders' outcomes ----------

const policy = (openTo: string[] | null, dailyCap = Infinity) => ({ openTo: openTo && new Set(openTo), dailyCap });
const nobody = async () => {};

test("the gate refuses outside openTo before counting anything", async () => {
  const store = memoryStore();
  const ok = phone(1), out = phone(2);
  const p = policy([(ok as any).e164]);
  assert.deepEqual(await sendCode(store, nobody, secret, out, "ip", p), { ok: false, error: "notOpen" });
  assert.deepEqual(await sendCode(store, nobody, secret, out, "ip", p), { ok: false, error: "notOpen" }); // not tooSoon
  assert.deepEqual(await sendCode(store, nobody, secret, ok, "ip", p), { ok: true }); // nothing was used up
});

const email = (i: number): Contact => ({ kind: "email", email: `person${i}@example.com` });
const logging = async (run: () => Promise<void>) => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (m: string) => void logged.push(String(m));
  try {
    await run();
  } finally {
    console.error = orig;
  }
  return logged;
};

test("at the daily cap, email codes go on with one logged line", async () => {
  const store = memoryStore();
  const p = policy(null, 2);
  const logged = await logging(async () => {
    for (let i = 1; i <= 4; i++) assert.deepEqual(await sendCode(store, nobody, secret, email(i), "ip", p), { ok: true });
  });
  assert.equal(logged.length, 1);
});

test("at the daily cap, WhatsApp codes stop until midnight in India, using up nobody's limits", async () => {
  const store = memoryStore();
  const p = policy(null, 2);
  const evening = Date.UTC(2026, 10, 17, 18, 0); // 23:30 IST
  const logged = await logging(async () => {
    for (let i = 1; i <= 2; i++) assert.deepEqual(await sendCode(store, nobody, secret, phone(i), "ip", p, evening), { ok: true });
    for (let i = 0; i < 12; i++) assert.deepEqual(await sendCode(store, nobody, secret, phone(3), "ip", p, evening), { ok: false, error: "paused" });
    assert.deepEqual(await sendCode(store, nobody, secret, email(1), "ip", p, evening), { ok: true });
  });
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /WhatsApp codes stop until midnight/);
  // 00:00 IST: a new day, and the 12 paused tries never counted toward that number's 10 a day.
  assert.deepEqual(await sendCode(store, nobody, secret, phone(3), "ip", p, evening + 30 * 60 * 1000), { ok: true });
});

test("a throttled send keeps no code, like a refused one", async () => {
  const store = memoryStore();
  const throttled = async () => Promise.reject(new NotSent("phone", "throttled", "429"));
  assert.deepEqual(await sendCode(store, throttled, secret, phone(1), "ip"), { ok: false, error: "notSent", reason: "throttled" });
  assert.deepEqual(await checkCode(store, secret, phone(1), "123456", "ip"), { ok: false, error: "expired" });
  assert.deepEqual(await sendCode(store, throttled, secret, phone(1), "ip"), { ok: false, error: "notSent", reason: "throttled" }); // no wait
});

test("the logged line never holds the code", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (m: string) => void logged.push(String(m));
  try {
    const echo = async (_: Contact, code: string) => Promise.reject(new NotSent("phone", "refused", `bad request for code ${code}`));
    await sendCode(memoryStore(), echo, secret, phone(1), "ip");
    let seen = "";
    await sendCode(memoryStore(), async (_, c) => ((seen = c), Promise.reject(new NotSent("phone", "refused", `echo ${c}`))), secret, phone(2), "ip");
    assert.ok(logged.length >= 2);
    assert.ok(logged.every((l) => l.includes("••••••")));
    assert.ok(!logged[1]!.includes(seen));
  } finally {
    console.error = orig;
  }
});

test("a refused send keeps no code and no wait", async () => {
  const store = memoryStore();
  const refused = async () => Promise.reject(new NotSent("phone", "refused", "not on WhatsApp"));
  assert.deepEqual(await sendCode(store, refused, secret, phone(1), "ip"), { ok: false, error: "notSent", reason: "refused" });
  assert.deepEqual(await checkCode(store, secret, phone(1), "123456", "ip"), { ok: false, error: "expired" });
  assert.deepEqual(await sendCode(store, refused, secret, phone(1), "ip"), { ok: false, error: "notSent", reason: "refused" }); // not tooSoon
});

test("an unsure send keeps the code and the wait", async () => {
  const store = memoryStore();
  let last = "";
  const unsure = async (_: Contact, code: string) => {
    last = code;
    throw new NotSent("phone", "unknown", "timed out");
  };
  assert.deepEqual(await sendCode(store, unsure, secret, phone(1), "ip"), { ok: true, unsure: true });
  assert.deepEqual(await sendCode(store, unsure, secret, phone(1), "ip"), { ok: false, error: "tooSoon" });
  assert.deepEqual(await checkCode(store, secret, phone(1), last, "ip"), { ok: true });
});

test("tooMany leaves no 30 s wait: the next try is tooMany again, not tooSoon", async () => {
  let clock = 0;
  const store = memoryStore(() => clock);
  const send = async () => {};
  for (let i = 0; i < 10; i++, clock += 30_000) assert.deepEqual(await sendCode(store, send, secret, phone(1), "ip"), { ok: true });
  assert.deepEqual(await sendCode(store, send, secret, phone(1), "ip"), { ok: false, error: "tooMany" });
  assert.deepEqual(await sendCode(store, send, secret, phone(1), "ip"), { ok: false, error: "tooMany" });
});

test("a plain Error from the sender still throws", async () => {
  await assert.rejects(sendCode(memoryStore(), async () => Promise.reject(new Error("bug")), secret, phone(1), "ip"), /bug/);
});
