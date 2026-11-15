import { test } from "node:test";
import assert from "node:assert/strict";
import type { Contact } from "@orbit/contract";
import { checkCode, sendCode } from "./codes.ts";
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
