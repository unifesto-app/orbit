import { test } from "node:test";
import assert from "node:assert/strict";
import type { Sender } from "./codes.ts";
import { NotSent } from "./senders.ts";
import { testApp } from "../testkit.ts";

const device = { name: "iPhone", client: "app" as const };
const withApp = async (opts: Parameters<typeof testApp>[0], run: (t: Awaited<ReturnType<typeof testApp>>) => Promise<void>) => {
  const t = await testApp(opts);
  try {
    await run(t);
  } finally {
    await t.close();
  }
};
const failing = (reason: "refused" | "throttled" | "unknown" | "notSetUp"): Sender => async (to) => {
  throw new NotSent(to.kind, reason, "test");
};

test("403 notOpen outside the gate", () =>
  withApp({ codes: { openTo: new Set(["+919000000001"]), dailyCap: Infinity } }, async (t) => {
    const r = await t.call("POST", "/auth/code", { to: "9000000002" });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "notOpen");
    assert.equal((await t.call("POST", "/auth/code", { to: "9000000001" })).status, 200);
  }));

test("at the daily cap WhatsApp codes stop with 503 paused, and email still goes", () =>
  withApp({ codes: { openTo: null, dailyCap: 1 } }, async (t) => {
    const logged: string[] = [];
    const orig = console.error;
    console.error = (m: string) => void logged.push(String(m));
    try {
      assert.equal((await t.call("POST", "/auth/code", { to: "9000000001" })).status, 200);
      const r = await t.call("POST", "/auth/code", { to: "9000000002" });
      assert.equal(r.status, 503);
      assert.equal(r.body.error, "paused");
      assert.match(r.body.message, /email/);
      assert.equal((await t.call("POST", "/auth/code", { to: "riya@example.com" })).status, 200);
      assert.equal((await t.call("POST", "/auth/code", { to: "asha@example.com" })).status, 200);
    } finally {
      console.error = orig;
    }
    assert.equal(logged.length, 2); // once per channel
  }));

test("503 tryLater when throttled", () =>
  withApp({ send: failing("throttled") }, async (t) => {
    const r = await t.call("POST", "/auth/code", { to: "9000000001" });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "tryLater");
    assert.equal(r.body.retryIn, 60);
  }));

test("400 notSent when refused, naming the channel", () =>
  withApp({ send: failing("refused") }, async (t) => {
    const p = await t.call("POST", "/auth/code", { to: "9000000001" });
    assert.equal(p.status, 400);
    assert.equal(p.body.error, "notSent");
    assert.match(p.body.message, /WhatsApp/);
    const e = await t.call("POST", "/auth/code", { to: "riya@example.com" });
    assert.equal(e.status, 400);
    assert.match(e.body.message, /email/i);
    assert.doesNotMatch(e.body.message, /WhatsApp/);
  }));

test("503 notSent when the channel isn't set up", () =>
  withApp({ send: failing("notSetUp") }, async (t) => {
    const r = await t.call("POST", "/auth/code", { to: "9000000001" });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "notSent");
  }));

test("an unsure send is 200 and the code works", () => {
  let code = "";
  const unsure: Sender = async (to, c) => {
    code = c;
    throw new NotSent(to.kind, "unknown", "timed out");
  };
  return withApp({ send: unsure }, async (t) => {
    const r = await t.call("POST", "/auth/code", { to: "9000000001" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { retryIn: 30 });
    const v = await t.call("POST", "/auth/code/verify", { to: "9000000001", code, device });
    assert.equal(v.status, 200);
  });
});

test("the per-IP limits follow X-Forwarded-For, not Cf-Connecting-Ip", () =>
  withApp({}, async (t) => {
    assert.equal((await t.call("POST", "/auth/code", { to: "9000000001" })).status, 200);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await t.app.request("/auth/code/verify", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", "cf-connecting-ip": `198.51.100.${i + 1}` },
        body: JSON.stringify({ to: "9000000001", code: "000000", device }),
      });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(5), [429]);
    assert.ok(statuses.slice(0, 5).every((s) => s === 400));
  }));
