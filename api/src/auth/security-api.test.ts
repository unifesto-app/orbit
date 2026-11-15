import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { testApp } from "../testkit.ts";
import { users } from "../db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const MIN = 60_000, DAY = 24 * 60 * MIN;
let n = 0;
const phone = () => `7${String(3_000_000 + ++n * 13).padStart(9, "0")}`;
const email = () => `s${++n}@example.com`;
const key = (to: string) => (to.includes("@") ? to : `+91${to}`);

const verify = async (to: string, extra: object = {}) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(key(to)), device, ...extra });
};
// A code sent to a phone or email, for the security routes.
const codeTo = async (to: string) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.lastCode(key(to))!;
};
type A = { p: string; access: string; device: string; me: { id: string } };
const join = async (withEmail = false) => {
  const p = phone();
  const v = await verify(p);
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  const a = { p, ...s.body } as A & { email?: string };
  if (withEmail) {
    a.email = email();
    await t.db.update(users).set({ email: a.email, emailVerifiedAt: new Date() }).where(eq(users.id, a.me.id));
  }
  return a;
};
const as = (access: string) => (m: string, path: string, body?: unknown) => t.call(m, path, body, access);
const security = async (access: string) => (await as(access)("GET", "/me/security")).body;
// "Is this you?" yes, on a new device.
const newDevice = async (a: A, id: string) => {
  const dev = { ...device, id };
  const v = await verify(a.p, { device: dev });
  assert.equal(v.body.step, "confirm");
  const c = await t.call("POST", "/auth/confirm", { ticket: v.body.ticket, me: true, device: dev });
  assert.equal(c.body.step, "signedIn");
  return c.body.access as string;
};
const userRow = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0]!;
const noticeTo = (kind: string, contact: string) => t.notices.filter((x) => x.kind === kind && (x.to as any).contact === contact);

test("devices: list, sign one out, sign out the others, not another account's", async () => {
  const a = await join();
  const b2 = await newDevice(a, "dev-2");
  const sec = await security(a.access);
  assert.equal(sec.devices.length, 2);
  assert.equal(sec.devices.filter((d: any) => d.current).length, 1);
  const other = sec.devices.find((d: any) => !d.current);
  assert.equal((await as(a.access)("DELETE", `/me/devices/${other.id}`)).status, 204);
  assert.equal((await as(b2)("GET", "/me")).status, 401);

  const b3 = await newDevice(a, "dev-3");
  const r = await as(a.access)("POST", "/me/devices/signout-others");
  assert.equal(r.body.signedOut, 1);
  assert.equal((await as(b3)("GET", "/me")).status, 401);
  assert.equal((await as(a.access)("GET", "/me")).status, 200);

  const stranger = await join();
  const theirs = (await security(stranger.access)).devices[0].id;
  assert.equal((await as(a.access)("DELETE", `/me/devices/${theirs}`)).status, 404);
  assert.equal((await as(stranger.access)("GET", "/me")).status, 200);
});

test("fresh check: fresh after sign-in, stale after 11 min, restored by a code", async () => {
  const a = await join();
  assert.equal((await security(a.access)).fresh, true);
  t.tick(11 * MIN);
  assert.equal((await security(a.access)).fresh, false);
  const np = phone();
  const stale = await as(a.access)("PUT", "/me/phone", { to: np, code: "123456" });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.error, "needsFresh");
  const f = await as(a.access)("POST", "/me/fresh", { via: "phone", code: await codeTo(a.p) });
  assert.equal(f.status, 200);
  assert.equal((await security(a.access)).fresh, true);
});

test("change phone: notice to old email, or old phone; taken; wrong code", async () => {
  const a = await join(true), b = await join(), taken = await join();
  const np = phone();
  const real = await codeTo(np);
  const wrong = await as(a.access)("PUT", "/me/phone", { to: np, code: real === "000000" ? "111111" : "000000" });
  assert.equal(wrong.body.error, "wrongCode");
  assert.equal((await userRow(a.me.id)).phone, `+91${a.p}`);
  // a number on another account: said only after a right code
  const takenCode = await codeTo(taken.p);
  const wrongTaken = await as(a.access)("PUT", "/me/phone", { to: taken.p, code: takenCode === "000000" ? "111111" : "000000" });
  assert.equal(wrongTaken.body.error, "wrongCode");
  const tk = await as(a.access)("PUT", "/me/phone", { to: taken.p, code: takenCode });
  assert.equal(tk.status, 409);
  assert.equal(tk.body.error, "phoneTaken");

  const ok = await as(a.access)("PUT", "/me/phone", { to: np, code: real });
  assert.equal(ok.status, 200);
  assert.equal((await userRow(a.me.id)).phone, `+91${np}`);
  assert.equal(noticeTo("signInMethodChanged", a.email!).length, 1);

  const np2 = phone();
  assert.equal((await as(b.access)("PUT", "/me/phone", { to: np2, code: await codeTo(np2) })).status, 200);
  assert.equal(noticeTo("signInMethodChanged", `+91${b.p}`).length, 1);
});

test("email: add, change, taken, remove", async () => {
  const a = await join(), other = await join(true);
  const e1 = email();
  assert.equal((await as(a.access)("PUT", "/me/email", { to: e1, code: await codeTo(e1) })).status, 200);
  assert.equal(noticeTo("signInMethodChanged", `+91${a.p}`).length, 1); // no email before: told the phone
  const e2 = email();
  assert.equal((await as(a.access)("PUT", "/me/email", { to: e2, code: await codeTo(e2) })).status, 200);
  assert.equal(noticeTo("signInMethodChanged", e1).length, 1);
  const tk = await as(a.access)("PUT", "/me/email", { to: other.email, code: await codeTo(other.email!) });
  assert.equal(tk.status, 409);
  assert.equal(tk.body.error, "emailTaken");
  assert.equal((await as(a.access)("DELETE", "/me/email")).status, 204);
  assert.equal((await userRow(a.me.id)).email, null);
  assert.equal(noticeTo("signInMethodChanged", e2).length, 1);
});

test("the 7-day hold after Is this you?", async () => {
  const a = await join(true);
  const b = await newDevice(a, "dev-B");
  const set = (await userRow(a.me.id)).newDevicePhoneAt!;
  assert.ok(set);

  // changing the phone isn't held
  const np = phone();
  assert.equal((await as(b)("PUT", "/me/phone", { to: np, code: await codeTo(np) })).status, 200);

  const e1 = email();
  const held = await as(b)("PUT", "/me/email", { to: e1, code: "123456" });
  assert.equal(held.status, 403);
  assert.equal(held.body.error, "held");
  assert.equal(held.body.until, new Date(set.getTime() + 7 * DAY).toISOString());
  assert.equal(noticeTo("signInMethodChangeHeld", a.email!).length, 1);
  assert.equal((await as(b)("DELETE", "/me/email")).body.error, "held");

  // one of the other ways in lifts it
  const f = await as(b)("POST", "/me/fresh", { via: "email", code: await codeTo(a.email!) });
  assert.equal(f.status, 200);
  assert.equal((await as(b)("PUT", "/me/email", { to: e1, code: await codeTo(e1) })).status, 200);

  // or waiting it out, then a fresh phone code
  t.tick(7 * DAY + MIN);
  assert.equal((await as(b)("POST", "/me/fresh", { via: "phone", code: await codeTo(np) })).status, 200);
  assert.equal((await as(b)("DELETE", "/me/email")).status, 204);
});

test("the mark lives on the account, not the device", async () => {
  const a = await join(true);
  await newDevice(a, "dev-B");
  const c = await verify(a.email!, { device: { ...device, id: "dev-C" } });
  assert.equal(c.body.step, "signedIn");
  assert.equal((await security(c.body.access)).heldUntil, null);

  const known = await verify(a.p, { device: { ...device, id: a.device } });
  assert.equal(known.body.step, "signedIn");
  assert.ok((await security(known.body.access)).heldUntil);
});

test("the hold isn't shed by an email added after the mark", async () => {
  const a = await join();
  const b = await newDevice(a, "dev-B");
  const e = email();
  assert.equal((await as(b)("PUT", "/me/email", { to: e, code: await codeTo(e) })).status, 200);
  assert.equal(noticeTo("signInMethodChanged", `+91${a.p}`).length, 1); // "Add this email?" tells the phone
  assert.equal((await as(b)("POST", "/me/fresh", { via: "email", code: await codeTo(e) })).status, 200);
  assert.ok((await security(b)).heldUntil);
});

test("the hold covers deletion", async () => {
  const a = await join(true);
  const b = await newDevice(a, "dev-B");
  const r = await as(b)("POST", "/me/deletion");
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "held");
});

test("Not me, start fresh tells the old account's email", async () => {
  const a = await join(true);
  const v = await verify(a.p);
  const c = await t.call("POST", "/auth/confirm", { ticket: v.body.ticket, me: false, device });
  assert.equal(c.body.step, "aboutYou");
  const s = await t.call("POST", "/auth/signup", { signup: c.body.signup, name: "Someone Else", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  assert.equal(noticeTo("phoneMovedAway", a.email!).length, 1);
});

test("no phoneMovedAway when the number had already moved", async () => {
  const a = await join(true);
  const v = await verify(a.p);
  const c = await t.call("POST", "/auth/confirm", { ticket: v.body.ticket, me: false, device });
  const np = phone();
  assert.equal((await as(a.access)("PUT", "/me/phone", { to: np, code: await codeTo(np) })).status, 200);
  const s = await t.call("POST", "/auth/signup", { signup: c.body.signup, name: "Someone Else", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  assert.equal(noticeTo("phoneMovedAway", a.email!).length, 0);
});

test("no hold shown without an email", async () => {
  const a = await join();
  const b = await newDevice(a, "dev-B");
  assert.equal((await security(b)).heldUntil, null);
});

test("seven held attempts send one notice", async () => {
  const a = await join(true);
  const b = await newDevice(a, "dev-B");
  for (let i = 0; i < 7; i++) assert.equal((await as(b)("PUT", "/me/email", { to: email(), code: "123456" })).body.error, "held");
  assert.equal(noticeTo("signInMethodChangeHeld", a.email!).length, 1);
});
