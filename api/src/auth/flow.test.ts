import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { testApp } from "../testkit.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };

test("a new number signs up through About you and lands signed in", async () => {
  assert.equal((await t.call("POST", "/auth/code", { to: "98765 43210" })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: "9876543210", code: t.lastCode("+919876543210"), device });
  assert.equal(v.body.step, "aboutYou");

  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  assert.equal(s.body.me.phone, "+919876543210");

  const me = await t.call("GET", "/me", undefined, s.body.access);
  assert.equal(me.body.name, "Riya Kapoor");
});
